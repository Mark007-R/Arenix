import asyncio
import json

from arenix.agents.coordinator import AgentCoordinator
from arenix.agents.gateway import LLMGateway
from arenix.agents.heuristic import HeuristicProvider
from arenix.engine.map import GameMap
from arenix.engine.match import Match
from arenix.lab import build_graph, payload_from_live

from .test_economy import fresh_schema  # noqa: F401  (migrated + seeded schema for the DB test)


def heuristic_match(emerald: GameMap, finish: bool) -> tuple[Match, AgentCoordinator]:
    m = Match("lab-1", emerald, 2)
    for i in range(6):
        m.add_contestant(f"b{i}", f"Bot{i}", "rogue", is_bot=True)
    m.start()
    co = AgentCoordinator(m, LLMGateway(HeuristicProvider()), list(m.bots))

    async def scenario() -> None:
        steps = 0
        while m.status == "running" and (finish or steps < 3000):
            m.step()
            co.tick()
            steps += 1
            await asyncio.sleep(0)
        await co.drain()

    asyncio.run(scenario())
    return m, co


def test_live_match_shows_only_public_information(emerald: GameMap) -> None:
    m, co = heuristic_match(emerald, finish=False)
    p = payload_from_live(m, co, "ROOM")
    assert p["status"] == "running" and not p["full_record"] and p["visibility_note"]
    assert p["decisions"] == []
    assert all("private" not in e for e in p["events"])
    assert all(e["type"] not in ("objective_assigned", "position_sample") for e in p["events"])
    assert all(c["objective"] is None for c in p["contestants"])


def test_finished_match_reveals_full_record(emerald: GameMap) -> None:
    m, co = heuristic_match(emerald, finish=True)
    p = payload_from_live(m, co, "ROOM")
    assert p["full_record"] and p["decisions"]
    assert any(e.get("private") for e in p["events"])
    assert len(p["events"]) == len(m.events)
    assert all(c["objective"] for c in p["contestants"])
    d = p["decisions"][0]
    assert {"context", "decision", "actions", "engine_results", "latency_ms", "provider"} <= set(d)
    json.dumps(p)  # serialisable for the API
    assert p["agent_summary"]["decisions"] == len(co.records)


def test_graph_aggregates_interactions() -> None:
    events = [
        {"seq": 1, "type": "alliance_proposed", "data": {"proposer": "a", "target": "b"}},
        {"seq": 2, "type": "alliance_formed", "data": {"members": ["a", "b"]}},
        {"seq": 3, "type": "chat", "data": {"sender": "a", "to": "b", "text": "hi"}},
        {"seq": 4, "type": "chat", "data": {"sender": "a", "to": "b", "text": "again"}},
        {"seq": 5, "type": "chat", "data": {"sender": "c", "to": None, "text": "public"}},
        {"seq": 6, "type": "vote_resolved", "data": {"votes": {"a": "c", "b": "skip", "c": "a"}}},
        {"seq": 7, "type": "alliance_broken", "data": {"by": "b", "partner": "a", "reason": "broken"}},
    ]
    edges = {(e["type"], e["source"], e["target"]): e["count"] for e in build_graph(events)["edges"]}
    assert edges == {
        ("alliance_proposed", "a", "b"): 1,
        ("alliance_formed", "a", "b"): 1,
        ("message", "a", "b"): 2,
        ("vote", "a", "c"): 1,
        ("vote", "c", "a"): 1,
        ("alliance_broken", "b", "a"): 1,
    }


def test_persisted_match_lab_payload(emerald: GameMap) -> None:
    import pytest

    from arenix.db.session import Database
    from arenix.economy.records import persist_match
    from arenix.lab_db import payload_from_db

    from .test_economy import URL

    m, co = heuristic_match(emerald, finish=True)

    async def scenario() -> dict:  # type: ignore[type-arg]
        db = Database(URL)
        try:
            async with db.sessions.begin() as s:
                await persist_match(s, m, co, "ROOM", {})
            async with db.sessions() as s:
                return await payload_from_db(s, m.id)  # type: ignore[return-value]
        finally:
            await db.dispose()

    try:
        p = asyncio.run(scenario())
    except OSError:
        pytest.skip("PostgreSQL unavailable")
    live = payload_from_live(m, co, "ROOM")
    assert p["full_record"] and len(p["events"]) == len(live["events"])
    assert len(p["decisions"]) == len(live["decisions"])
    assert p["graph"]["edges"] == live["graph"]["edges"]
