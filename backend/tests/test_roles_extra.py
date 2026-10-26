"""Sheriff, jester and sabotage."""

from __future__ import annotations

import random

import pytest

from arenix.engine import roles as R
from arenix.engine.map import GameMap
from arenix.engine.maps import get_map
from arenix.engine.match import Match


@pytest.fixture(scope="module")
def moonfall() -> GameMap:
    return get_map("moonfall_isle")


def field(game_map: GameMap, roles: dict[str, str], n: int = 6) -> Match:
    m = Match("x", game_map, 3, mode="impostor")
    for i in range(1, n + 1):
        m.add_contestant(f"p{i}", f"P{i}", "knight", is_bot=False)
    m.start()
    spots = [
        (41.5, 33.5),
        (44.5, 20.5),
        (44.5, 55.5),
        (30.5, 40.5),
        (75.5, 35.5),
        (66.5, 25.5),
        (64.5, 50.5),
        (20.5, 46.5),
    ]
    for c, (x, y) in zip(m.contestants.values(), spots, strict=False):
        c.role = roles.get(c.id, R.ISLANDER)
        c.skill = None
        c.kill_ready_tick = 0
        c.x, c.y = x, y
    m.sabotage_ready_tick = 0
    return m


def test_special_roles_appear_with_enough_players() -> None:
    for n, sheriff, jester in ((5, 0, 0), (6, 1, 0), (8, 1, 1), (10, 1, 1)):
        roles = R.assign_roles([f"p{i}" for i in range(n)], random.Random(n))
        assert list(roles.values()).count(R.SHERIFF) == sheriff
        assert list(roles.values()).count(R.JESTER) == jester
        assert list(roles.values()).count(R.IMPOSTOR) == R.impostor_count(n)
    assert R.team(R.SHERIFF) == R.ISLANDER and R.team(R.JESTER) == R.JESTER


def test_sheriff_hit_kills_the_impostor(moonfall: GameMap) -> None:
    m = field(moonfall, {"p1": R.IMPOSTOR, "p2": R.SHERIFF})
    m.contestants["p2"].x, m.contestants["p2"].y = 42.5, 33.5
    assert m.shoot("p3", "p1").reason == "not_sheriff"
    r = m.shoot("p2", "p1")
    assert r.ok and r.reason == "hit"
    assert not m.contestants["p1"].alive and m.contestants["p2"].alive
    assert m.status == "finished" and m.result is not None and m.result["reason"] == "impostors_caught"


def test_sheriff_misfire_kills_the_sheriff(moonfall: GameMap) -> None:
    m = field(moonfall, {"p1": R.IMPOSTOR, "p2": R.SHERIFF})
    m.contestants["p2"].x, m.contestants["p2"].y = 44.5, 55.5 + 1.0  # next to p3, an islander
    r = m.shoot("p2", "p3")
    assert r.ok and r.reason == "misfire"
    assert not m.contestants["p2"].alive and m.contestants["p3"].alive
    assert "p2" in m.bodies
    assert m.shoot("p2", "p1").reason == "eliminated"


def test_sheriff_has_one_bullet_and_needs_range(moonfall: GameMap) -> None:
    m = field(moonfall, {"p1": R.IMPOSTOR, "p2": R.SHERIFF, "p6": R.IMPOSTOR}, n=8)
    assert m.shoot("p2", "p1").reason == "out_of_range"
    m.contestants["p2"].x, m.contestants["p2"].y = 42.5, 33.5
    assert m.shoot("p2", "p1").ok
    m.contestants["p2"].x, m.contestants["p2"].y = 66.5, 26.5
    assert m.shoot("p2", "p6").reason == "bullet_used"


def test_fog_shrinks_islander_view_but_not_impostors(moonfall: GameMap) -> None:
    m = field(moonfall, {"p1": R.IMPOSTOR})
    p3 = m.contestants["p3"]
    p3.x, p3.y = 41.5 + 9.0, 33.5
    assert m.can_see("p1", p3)
    m.contestants["p4"].x, m.contestants["p4"].y = 41.5, 33.5 + 1.0
    assert m.can_see("p4", p3)
    r = m.sabotage("p1", "fog")
    assert r.ok and r.events[0].visible_to is None and "p1" not in str(r.events[0].data)  # anonymous
    assert not m.can_see("p4", p3) and m.can_see("p1", p3)
    assert m.sabotage("p1", "fog").reason == "sabotage_cooldown"
    assert m.sabotage("p2", "fog").reason == "not_impostor"
    m.tick = m.fog_until
    assert m.can_see("p4", p3)


def test_douse_puts_out_a_lit_beacon(moonfall: GameMap) -> None:
    m = field(moonfall, {"p1": R.IMPOSTOR})
    assert m.sabotage("p1", "douse").reason == "nothing_to_douse"
    m.beacons["beacon_docks"] = True
    r = m.sabotage("p1", "douse")
    assert r.ok and r.events[0].data["beacon"] == "beacon_docks" and m.beacons["beacon_docks"] is False


def test_jester_wins_alone_when_voted_out(moonfall: GameMap) -> None:
    m = field(moonfall, {"p1": R.IMPOSTOR, "p5": R.JESTER}, n=8)
    m._start_meeting("bell", "p2")
    m.tick = m.phase_end_tick
    m.step()
    for v in m.contestants:
        if v != "p5":
            assert m.vote(v, "p5").ok
    assert m.vote("p5", None).ok
    m.step()
    res = [e for e in m.events if e.type == "vote_resolved"][-1]
    assert res.data["was_jester"] is True and res.data["was_impostor"] is False
    while m.status == "running":
        m.step()
    assert m.result is not None and m.result["reason"] == "jester_ejected"
    assert m.result["winners"] == ["p5"] and m.result["winning_team"] == R.JESTER


def test_jester_tasks_are_fake(moonfall: GameMap) -> None:
    m = field(moonfall, {"p1": R.IMPOSTOR, "p5": R.JESTER}, n=8)
    tower = moonfall.objects_by_id["watchtower"]
    j = m.contestants["p5"]
    j.x, j.y = tower.x + 1.0, tower.y + 2.6
    j.carrying = {"wood": 2, "stone": 0}
    r = m.interact("p5", "watchtower")
    assert r.ok and r.events[0].type == "delivery_faked"


@pytest.mark.parametrize("seed", [2, 7])
def test_bots_with_special_roles_play_full_matches(moonfall: GameMap, seed: int) -> None:
    m = Match("bots", moonfall, seed, mode="impostor")
    for i in range(9):
        m.add_contestant(f"bot{i + 1}", f"Bot{i + 1}", "knight", is_bot=True)
    m.start()
    assert {c.role for c in m.contestants.values()} >= {R.SHERIFF, R.JESTER, R.IMPOSTOR}
    while m.status == "running":
        m.step()
    assert m.result is not None
    refused = [r for r in m.action_results if not r[3] and r[2][0] in ("shoot", "sabotage")]
    assert all(r[4] in ("sabotage_cooldown", "nothing_to_douse", "out_of_range") for r in refused), refused
