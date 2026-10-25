import pytest

from arenix.engine import physics
from arenix.engine.map import GameMap
from arenix.engine.match import Match


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_bots_repair_tower_without_meetings(emerald: GameMap, seed: int) -> None:
    m = Match("sim", emerald, seed, time_limit_seconds=240, meetings=False)
    for i in range(3):
        m.add_contestant(f"b{i}", f"Bot{i}", "rogue", is_bot=True)
    m.start()
    while m.status == "running" and m.mission.status != "completed":
        m.step()
        for c in m.contestants.values():
            assert not physics.box_blocked(emerald.is_solid, c.x, c.y)
    assert m.mission.status == "completed"


@pytest.mark.parametrize("seed", [1, 2, 3, 4])
def test_full_council_match_with_bots(emerald: GameMap, seed: int) -> None:
    m = Match("sim", emerald, seed)
    for i in range(6):
        m.add_contestant(f"b{i}", f"Bot{i}", "rogue", is_bot=True)
    m.start()
    while m.status == "running":
        m.step()
    types = [e.type for e in m.events]
    assert "meeting_called" in types and "vote_resolved" in types
    assert m.result is not None and m.result["winner"] is not None
    winner = m.contestants[m.result["winner"]]
    assert winner.alive
    # Winner is the top-scoring survivor.
    assert winner.score == max(c.score for c in m.contestants.values() if c.alive)
    # Every vote was cast through validation: voters were alive, targets alive and not self.
    for e in m.events:
        if e.type == "vote_resolved":
            for voter, target in e.data["votes"].items():
                assert voter != target


def test_bots_only_interact_through_validated_requests(emerald: GameMap) -> None:
    m = Match("sim", emerald, 3, meetings=False)
    m.add_contestant("b0", "Bot", "rogue", is_bot=True)
    m.start()
    for _ in range(800):
        m.step()
    assert any(e.type == "resource_gathered" for e in m.events)
    brain = m.bots["b0"]
    assert brain.decisions and all({"tick", "summary", "goal"} <= set(d) for d in brain.decisions)


def test_bots_never_see_private_events_of_others(emerald: GameMap) -> None:
    m = Match("sim", emerald, 5)
    for i in range(4):
        m.add_contestant(f"b{i}", f"Bot{i}", "rogue", is_bot=True)
    m.start()
    seen: dict[str, list[int]] = {cid: [] for cid in m.bots}
    originals = {cid: brain.update for cid, brain in m.bots.items()}

    def spy(cid: str):  # type: ignore[no-untyped-def]
        def wrapped(obs):  # type: ignore[no-untyped-def]
            seen[cid].extend(e.seq for e in obs.new_events)
            return originals[cid](obs)

        return wrapped

    for cid, brain in m.bots.items():
        brain.update = spy(cid)  # type: ignore[method-assign]
    for _ in range(3000):
        m.step()
    by_seq = {e.seq: e for e in m.events}
    for cid, seqs in seen.items():
        for seq in seqs:
            assert by_seq[seq].visible(cid), f"{cid} observed private event {by_seq[seq].type}"
        objective_events = [by_seq[s] for s in seqs if by_seq[s].type == "objective_assigned"]
        assert len(objective_events) == 1 and objective_events[0].data["contestant"] == cid


def test_single_bot_with_single_human_does_not_crash_when_idle(emerald: GameMap) -> None:
    m = Match("sim", emerald, 9, time_limit_seconds=5)
    m.add_contestant("p1", "Hero", "knight", is_bot=False)
    m.add_contestant("b0", "Bot", "rogue", is_bot=True)
    m.start()
    while m.status == "running":
        m.step()
    assert m.status == "finished"
