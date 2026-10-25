import pytest

from arenix.engine import bots, physics
from arenix.engine.map import GameMap
from arenix.engine.match import (
    CARRY_CAPACITY,
    INTERACT_COOLDOWN_TICKS,
    INTERACT_RANGE,
    MISSION_BONUS,
    POINTS_PER_UNIT,
    Match,
)


def make_match(emerald: GameMap, bots_n: int = 0, seed: int = 7, **kw: int) -> Match:
    kw.setdefault("meetings", False)  # type: ignore[arg-type]
    m = Match("test", emerald, seed, **kw)  # type: ignore[arg-type]
    m.add_contestant("p1", "Hero", "knight", is_bot=False)
    for i in range(bots_n):
        m.add_contestant(f"b{i}", f"Bot{i}", "wizard", is_bot=True)
    m.start()
    return m


def place_next_to(m: Match, cid: str, obj_id: str) -> None:
    o = m.map.objects_by_id[obj_id]
    for ty in range(o.y - 1, o.y + o.h + 1):
        for tx in range(o.x - 1, o.x + o.w + 1):
            if not m.map.is_solid(tx, ty):
                c = m.contestants[cid]
                c.x, c.y = tx + 0.5, ty + 0.5
                return
    raise AssertionError("no free tile")


def skip_cooldown(m: Match) -> None:
    for _ in range(INTERACT_COOLDOWN_TICKS):
        m.step()


def test_constants_in_sync() -> None:
    assert bots.INTERACT_RANGE == INTERACT_RANGE
    assert bots.GATHER_PAUSE_TICKS > INTERACT_COOLDOWN_TICKS


def test_gather_requires_range(emerald: GameMap) -> None:
    m = make_match(emerald)
    assert m.interact("p1", "wood_0").reason == "out_of_range"
    place_next_to(m, "p1", "wood_0")
    r = m.interact("p1", "wood_0")
    assert r.ok
    assert m.contestants["p1"].carrying["wood"] == 1
    assert r.events[0].type == "resource_gathered"


def test_cooldown_blocks_spam(emerald: GameMap) -> None:
    m = make_match(emerald)
    place_next_to(m, "p1", "wood_0")
    assert m.interact("p1", "wood_0").ok
    assert m.interact("p1", "wood_0").reason == "cooldown"


def test_capacity_and_depletion(emerald: GameMap) -> None:
    m = make_match(emerald)
    place_next_to(m, "p1", "wood_0")
    for _ in range(3):
        assert m.interact("p1", "wood_0").ok
        skip_cooldown(m)
    assert m.interact("p1", "wood_0").reason in ("depleted", "inventory_full")
    assert m.contestants["p1"].carry_total() == CARRY_CAPACITY
    m.contestants["p1"].carrying["wood"] = 0
    assert m.interact("p1", "wood_0").reason == "depleted"


def test_nodes_regenerate(emerald: GameMap) -> None:
    m = make_match(emerald)
    place_next_to(m, "p1", "wood_0")
    m.interact("p1", "wood_0")
    regen = m.nodes["wood_0"].regen_ticks
    for _ in range(regen):
        m.step()
    assert m.nodes["wood_0"].charges == 3


def test_unknown_or_decorative_targets_rejected(emerald: GameMap) -> None:
    m = make_match(emerald)
    assert m.interact("p1", "nope").reason == "not_interactable"
    place_next_to(m, "p1", "well")
    assert m.interact("p1", "well").reason == "not_interactable"
    assert m.interact("ghost", "wood_0").reason == "unknown_contestant"


def test_delivery_accepts_only_what_is_needed(emerald: GameMap) -> None:
    m = make_match(emerald)
    m.mission.delivered["wood"] = m.mission.required["wood"] - 1
    m.contestants["p1"].carrying = {"wood": 2, "stone": 1}
    place_next_to(m, "p1", "watchtower")
    r = m.interact("p1", "watchtower")
    assert r.ok
    data = r.events[0].data
    assert data["accepted"] == {"wood": 1, "stone": 1}
    assert data["surplus"] == {"wood": 1}
    assert m.contestants["p1"].carry_total() == 0
    assert m.contestants["p1"].score == 2 * POINTS_PER_UNIT


def test_delivery_with_empty_hands(emerald: GameMap) -> None:
    m = make_match(emerald)
    place_next_to(m, "p1", "watchtower")
    assert m.interact("p1", "watchtower").reason == "nothing_to_deliver"


def test_mission_completion_awards_bonus_and_closes_tower(emerald: GameMap) -> None:
    m = make_match(emerald)
    m.mission.delivered = {"wood": m.mission.required["wood"] - 1, "stone": m.mission.required["stone"]}
    m.contestants["p1"].carrying = {"wood": 1, "stone": 0}
    place_next_to(m, "p1", "watchtower")
    r = m.interact("p1", "watchtower")
    types = [e.type for e in r.events]
    assert types == ["resources_delivered", "mission_completed"]
    assert m.status == "running"  # the match continues: survival decides the winner
    assert m.contestants["p1"].score == POINTS_PER_UNIT + MISSION_BONUS
    skip_cooldown(m)
    m.contestants["p1"].carrying = {"wood": 1, "stone": 0}
    assert m.interact("p1", "watchtower").reason == "mission_closed"


def test_time_limit_ends_match_with_surviving_winner(emerald: GameMap) -> None:
    m = make_match(emerald, time_limit_seconds=1)
    for _ in range(physics.TICK_RATE):
        m.step()
    assert m.status == "finished"
    assert m.result is not None and m.result["reason"] == "time_up" and m.result["winner"] == "p1"
    assert m.result["standings"][0]["bonuses"]["survival"] > 0
    assert m.step() == []


def test_input_moves_player_and_acks(emerald: GameMap) -> None:
    m = make_match(emerald)
    c = m.contestants["p1"]
    x0 = c.x
    assert m.queue_input("p1", 1, 1.0, 0.0)
    m.step()
    assert c.x > x0
    assert c.last_ack_seq == 1
    assert c.facing == "right"


def test_replayed_and_invalid_inputs_rejected(emerald: GameMap) -> None:
    m = make_match(emerald)
    assert m.queue_input("p1", 5, 1.0, 0.0)
    assert not m.queue_input("p1", 5, 1.0, 0.0)
    assert not m.queue_input("p1", 4, 1.0, 0.0)
    assert not m.queue_input("p1", 6, float("nan"), 0.0)
    assert not m.queue_input("b0", 7, 1.0, 0.0)


def test_input_flood_cannot_exceed_speed(emerald: GameMap) -> None:
    """A speed-hacking client sending 5 inputs per tick still moves at most ~1 step per tick."""
    m = make_match(emerald)
    c = m.contestants["p1"]
    c.x, c.y = 25.5, 25.5  # plaza is open
    x0 = c.x
    seq = 0
    ticks = 10
    for _ in range(ticks):
        for _ in range(5):
            seq += 1
            m.queue_input("p1", seq, -1.0, 0.0)
        m.step()
    max_steps = ticks + 3  # token bucket burst allowance
    assert x0 - c.x <= max_steps * physics.SPEED * physics.DT + 1e-9


def test_event_sequence_numbers_are_contiguous(emerald: GameMap) -> None:
    m = make_match(emerald, bots_n=3)
    for _ in range(400):
        m.step()
    seqs = [e.seq for e in m.events]
    assert seqs == list(range(1, len(seqs) + 1))
    assert m.events.since(0)[0].type == "match_started"


def test_simulation_is_deterministic(emerald: GameMap) -> None:
    def run() -> list[tuple[int, str, str]]:
        m = make_match(emerald, bots_n=3, seed=99)
        for _ in range(600):
            m.step()
        return [(e.tick, e.type, str(sorted(e.data.items()))) for e in m.events]

    assert run() == run()


def test_duplicate_contestant_and_bad_archetype(emerald: GameMap) -> None:
    m = Match("x", emerald, 1)
    m.add_contestant("a", "A", "knight", False)
    with pytest.raises(ValueError):
        m.add_contestant("a", "A", "knight", False)
    with pytest.raises(ValueError):
        m.add_contestant("b", "B", "dragon", False)
