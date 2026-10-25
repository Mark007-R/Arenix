"""Meetings, voting, eliminations, alliances, chat, shrine ritual, objectives and visibility."""

import pytest

from arenix.engine import physics
from arenix.engine.map import GameMap
from arenix.engine.match import (
    ALLY_DIVIDEND,
    DISCUSS_SECONDS,
    EXPLORE_SECONDS,
    INTERACT_COOLDOWN_TICKS,
    POINTS_PER_UNIT,
    REVEAL_SECONDS,
    SHRINE_BONUS,
    SHRINE_WINDOW_TICKS,
    SURVIVAL_BONUS,
    VIEW_RADIUS,
    VOTE_SECONDS,
    Match,
)
from arenix.engine.social import CHAT_COOLDOWN_TICKS, OBJECTIVE_BONUS, QUICK_CHAT, Objective, sanitize_chat


def humans(emerald: GameMap, n: int = 4, **kw: int) -> Match:
    m = Match("council", emerald, 11, **kw)  # type: ignore[arg-type]
    for i in range(n):
        m.add_contestant(f"p{i}", f"P{i}", "knight", is_bot=False)
    m.start()
    return m


def run(m: Match, seconds: float) -> None:
    for _ in range(int(seconds * physics.TICK_RATE)):
        m.step()


def place(m: Match, cid: str, obj_id: str) -> None:
    o = m.map.objects_by_id[obj_id]
    for ty in range(o.y - 1, o.y + o.h + 1):
        for tx in range(o.x - 1, o.x + o.w + 1):
            if not m.map.is_solid(tx, ty):
                m.contestants[cid].x, m.contestants[cid].y = tx + 0.5, ty + 0.5
                return


def to_vote(m: Match) -> None:
    run(m, EXPLORE_SECONDS)
    assert m.phase == "discuss"
    run(m, DISCUSS_SECONDS)
    assert m.phase == "vote"


# ------------------------------------------------------------------ meetings & votes
def test_scheduled_meeting_cycle(emerald: GameMap) -> None:
    m = humans(emerald)
    run(m, EXPLORE_SECONDS - 1)
    assert m.phase == "explore"
    run(m, 1)
    assert m.phase == "discuss"
    run(m, DISCUSS_SECONDS)
    assert m.phase == "vote"
    run(m, VOTE_SECONDS)
    assert m.phase == "reveal"
    run(m, REVEAL_SECONDS)
    assert m.phase == "explore"
    types = [e.type for e in m.events]
    for t in ("meeting_called", "vote_started", "vote_resolved", "meeting_ended"):
        assert t in types


def test_movement_paused_during_meetings_but_inputs_acked(emerald: GameMap) -> None:
    m = humans(emerald)
    run(m, EXPLORE_SECONDS)
    c = m.contestants["p0"]
    x0 = c.x
    m.queue_input("p0", 1, 1.0, 0.0)
    m.step()
    assert c.x == x0 and c.last_ack_seq == 1


def test_bell_calls_meeting_once_per_contestant(emerald: GameMap) -> None:
    m = humans(emerald)
    place(m, "p0", "bell")
    r = m.interact("p0", "bell")
    assert r.ok and m.phase == "discuss"
    assert r.events[0].data == {"cause": "bell", "caller": "p0", "meeting": 1}
    assert m.interact("p0", "bell").reason == "meeting_in_progress"
    run(m, DISCUSS_SECONDS + VOTE_SECONDS + REVEAL_SECONDS)
    for _ in range(INTERACT_COOLDOWN_TICKS):
        m.step()
    assert m.interact("p0", "bell").reason == "bell_used"


def test_plurality_eliminates_and_votes_are_revealed(emerald: GameMap) -> None:
    m = humans(emerald)
    to_vote(m)
    assert m.vote("p0", "p3").ok
    assert m.vote("p1", "p3").ok
    assert m.vote("p2", None).ok
    assert m.vote("p0", "p1").reason == "already_voted"
    assert m.vote("p3", "p3").reason == "invalid_target"
    assert m.vote("p3", "p0").ok  # everyone voted → resolves on next tick
    m.step()
    resolved = [e for e in m.events if e.type == "vote_resolved"][-1]
    assert resolved.data["votes"] == {"p0": "p3", "p1": "p3", "p2": "skip", "p3": "p0"}
    assert resolved.data["eliminated"] == "p3"
    assert not m.contestants["p3"].alive
    # Eliminated contestants can no longer act.
    assert m.chat("p3", quick="gg").reason == "eliminated"
    assert m.interact("p3", "wood_0").reason == "eliminated"


@pytest.mark.parametrize(
    "votes",
    [
        {"p0": "p1", "p1": "p0"},  # tie → nobody
        {"p0": "p1", "p1": None, "p2": None},  # skip beats the leader
    ],
)
def test_ties_and_skips_eliminate_nobody(emerald: GameMap, votes: dict[str, str | None]) -> None:
    m = humans(emerald)
    to_vote(m)
    for voter, target in votes.items():
        assert m.vote(voter, target).ok
    run(m, VOTE_SECONDS)
    resolved = [e for e in m.events if e.type == "vote_resolved"][-1]
    assert resolved.data["eliminated"] is None
    assert all(c.alive for c in m.contestants.values())


def test_vote_only_in_vote_phase(emerald: GameMap) -> None:
    m = humans(emerald)
    assert m.vote("p0", "p1").reason == "wrong_phase"


def test_final_two_ends_match_and_survivor_wins(emerald: GameMap) -> None:
    m = humans(emerald, n=3)
    m.contestants["p2"].score = 999  # eliminated players cannot win, whatever their score
    to_vote(m)
    m.vote("p0", "p2")
    m.vote("p1", "p2")
    run(m, VOTE_SECONDS + REVEAL_SECONDS + 1)
    assert m.status == "finished" and m.result is not None
    assert m.result["reason"] == "final_two"
    assert m.result["winner"] in ("p0", "p1")
    loser = next(s for s in m.result["standings"] if s["id"] == "p2")
    assert not loser["alive"] and "survival" not in loser["bonuses"]
    assert m.result["standings"][-1]["id"] == "p2"


# ------------------------------------------------------------------ alliances
def test_alliance_lifecycle_and_privacy(emerald: GameMap) -> None:
    m = humans(emerald)
    r = m.propose_alliance("p0", "p1")
    assert r.ok and r.events[0].visible_to == frozenset({"p0", "p1"})
    assert m.propose_alliance("p0", "p1").reason == "already_proposed"
    assert m.respond_alliance("p2", "p0", True).reason == "no_proposal"
    formed = m.respond_alliance("p1", "p0", True)
    assert formed.ok and m.alliances.allied("p0", "p1")
    assert formed.events[0].visible_to == frozenset({"p0", "p1"})
    assert m.propose_alliance("p2", "p0").reason == "already_allied"
    # Private events are invisible to outsiders.
    assert all(not e.visible("p2") for e in m.events if e.type.startswith("alliance_"))
    broken = m.break_alliance("p1")
    assert broken.ok and broken.events[0].visible_to is None  # betrayal is public
    assert not m.alliances.allied("p0", "p1")


def test_proposals_expire(emerald: GameMap) -> None:
    m = humans(emerald, meetings=False)
    m.propose_alliance("p0", "p1")
    run(m, 16)
    assert m.respond_alliance("p1", "p0", True).reason == "no_proposal"
    assert any(e.type == "alliance_expired" for e in m.events)


def test_rejection(emerald: GameMap) -> None:
    m = humans(emerald)
    m.propose_alliance("p0", "p1")
    assert m.respond_alliance("p1", "p0", False).ok
    assert not m.alliances.allied("p0", "p1")


def test_ally_dividend_on_delivery(emerald: GameMap) -> None:
    m = humans(emerald)
    m.propose_alliance("p0", "p1")
    m.respond_alliance("p1", "p0", True)
    m.contestants["p0"].carrying = {"wood": 2, "stone": 0}
    place(m, "p0", "watchtower")
    r = m.interact("p0", "watchtower")
    assert r.ok
    assert m.contestants["p0"].score == 2 * POINTS_PER_UNIT
    assert m.contestants["p1"].score == 2 * ALLY_DIVIDEND
    assert [e for e in r.events if e.type == "ally_dividend"][0].visible_to == frozenset({"p0", "p1"})


def test_voting_against_ally_is_a_public_betrayal(emerald: GameMap) -> None:
    m = humans(emerald)
    m.propose_alliance("p0", "p1")
    m.respond_alliance("p1", "p0", True)
    to_vote(m)
    m.vote("p0", "p1")
    run(m, VOTE_SECONDS)
    broken = [e for e in m.events if e.type == "alliance_broken"]
    assert broken and broken[-1].data == {"by": "p0", "partner": "p1", "reason": "betrayal"}
    assert broken[-1].visible_to is None


# ------------------------------------------------------------------ chat
def test_public_chat_and_quick_chat(emerald: GameMap) -> None:
    m = humans(emerald, meetings=False)
    r = m.chat("p0", text="  hello   island  ")
    assert r.ok and r.events[0].data["text"] == "hello island" and r.events[0].visible_to is None
    assert m.chat("p0", text="again").reason == "chat_cooldown"
    run(m, CHAT_COOLDOWN_TICKS / physics.TICK_RATE)
    r = m.chat("p0", quick="gg")
    assert r.ok and r.events[0].data["text"] == QUICK_CHAT["gg"]
    run(m, CHAT_COOLDOWN_TICKS / physics.TICK_RATE)
    assert m.chat("p0", quick="buy_diamonds").reason == "unknown_phrase"


def test_whispers_only_between_allies(emerald: GameMap) -> None:
    m = humans(emerald, meetings=False)
    assert m.chat("p0", text="psst", to="p1").reason == "not_allied"
    m.propose_alliance("p0", "p1")
    m.respond_alliance("p1", "p0", True)
    r = m.chat("p0", text="psst", to="p1")
    assert r.ok and r.events[0].visible_to == frozenset({"p0", "p1"})
    assert not r.events[0].visible("p2")


@pytest.mark.parametrize("bad", ["", "   ", "x" * 141, "you shit", "f​u​c​k you"])
def test_chat_filter_rejects(bad: str) -> None:
    assert sanitize_chat(bad) is None


def test_chat_strips_control_characters() -> None:
    assert sanitize_chat("hi‮there\x07") == "hithere"


# ------------------------------------------------------------------ shrine
def test_shrine_needs_three_within_window(emerald: GameMap) -> None:
    m = humans(emerald, meetings=False)
    for cid in ("p0", "p1", "p2"):
        place(m, cid, "shrine")
    assert m.interact("p0", "shrine").ok
    assert m.interact("p0", "shrine").reason in ("already_channeling", "cooldown")
    assert m.interact("p1", "shrine").ok
    assert m.shrine.status == "channeling"
    r = m.interact("p2", "shrine")
    assert r.ok and m.shrine.status == "activated"
    assert all(m.contestants[c].score == SHRINE_BONUS for c in ("p0", "p1", "p2"))
    assert r.events[-1].type == "shrine_activated"


def test_shrine_fizzles_after_window(emerald: GameMap) -> None:
    m = humans(emerald, meetings=False)
    place(m, "p0", "shrine")
    m.interact("p0", "shrine")
    for _ in range(SHRINE_WINDOW_TICKS):
        m.step()
    assert m.shrine.status == "dormant"
    assert any(e.type == "shrine_fizzled" for e in m.events)


# ------------------------------------------------------------------ objectives & visibility
def test_objectives_are_private_and_scored(emerald: GameMap) -> None:
    m = humans(emerald, time_limit_seconds=1, meetings=False)
    assigned = [e for e in m.events if e.type == "objective_assigned"]
    assert len(assigned) == 4
    for e in assigned:
        assert e.visible_to == frozenset({e.data["contestant"]})
    m.contestants["p0"].objective = Objective("survive")
    run(m, 1)
    s0 = next(s for s in m.result["standings"] if s["id"] == "p0")  # type: ignore[index]
    assert s0["objective_achieved"] and s0["bonuses"] == {"survival": SURVIVAL_BONUS, "objective": OBJECTIVE_BONUS}


def test_snapshot_hides_distant_contestants_and_others_objectives(emerald: GameMap) -> None:
    m = humans(emerald, meetings=False)
    far = m.contestants["p1"]
    far.x, far.y = 50.5, 8.5  # the mine, far from the plaza
    snap = m.snapshot("p0")
    ids = {c["id"] for c in snap["contestants"]}
    assert "p1" not in ids and "p2" in ids
    assert {r["id"] for r in snap["roster"]} == {"p0", "p1", "p2", "p3"}  # names/scores are public
    assert snap["me"]["objective"]["kind"] == m.contestants["p0"].objective.kind  # type: ignore[union-attr]
    assert "objective" not in str(snap["roster"])
    # Allies always see each other.
    m.propose_alliance("p0", "p1")
    m.respond_alliance("p1", "p0", True)
    assert "p1" in {c["id"] for c in m.snapshot("p0")["contestants"]}
    assert VIEW_RADIUS < 40


def test_everyone_visible_during_meetings(emerald: GameMap) -> None:
    m = humans(emerald)
    m.contestants["p1"].x, m.contestants["p1"].y = 50.5, 8.5
    run(m, EXPLORE_SECONDS)
    assert {c["id"] for c in m.snapshot("p0")["contestants"]} == {"p0", "p1", "p2", "p3"}
