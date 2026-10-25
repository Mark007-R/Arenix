"""Impostor mode: hidden roles, kills, bodies, reports, ghosts, skills and team win conditions."""

from __future__ import annotations

import math

import pytest

from arenix.engine import physics
from arenix.engine import roles as R
from arenix.engine.map import GameMap
from arenix.engine.maps import get_map
from arenix.engine.match import Match


@pytest.fixture(scope="module")
def moonfall() -> GameMap:
    return get_map("moonfall_isle")


def humans(game_map: GameMap, n: int = 5, impostors: tuple[str, ...] = ("p1",), **kw: object) -> Match:
    m = Match("imp", game_map, 3, mode="impostor", **kw)  # type: ignore[arg-type]
    for i in range(1, n + 1):
        m.add_contestant(f"p{i}", f"P{i}", "knight", is_bot=False)
    m.start()
    # Deterministic roles and no skills unless a test grants one.
    for c in m.contestants.values():
        c.role = R.IMPOSTOR if c.id in impostors else R.ISLANDER
        c.skill = None
        c.kill_ready_tick = 0
    return m


def put(m: Match, cid: str, x: float, y: float) -> None:
    c = m.contestants[cid]
    c.x, c.y = x, y


def spread(m: Match) -> None:
    """Move everyone far apart (in the open plaza and on roads) so nobody witnesses anything."""
    spots = [(41.5, 33.5), (44.5, 20.5), (44.5, 55.5), (30.5, 40.5), (75.5, 35.5), (66.5, 25.5), (64.5, 50.5)]
    for c, (x, y) in zip(m.contestants.values(), spots, strict=False):
        put(m, c.id, x, y)


def test_roles_and_skills_are_private(moonfall: GameMap) -> None:
    m = Match("r", moonfall, 11, mode="impostor")
    for i in range(1, 9):
        m.add_contestant(f"p{i}", f"P{i}", "knight", is_bot=False)
    m.start()
    imps = [c.id for c in m.contestants.values() if c.role == R.IMPOSTOR]
    assert len(imps) == R.impostor_count(8) == 2
    assert all(c.skill is not None for c in m.contestants.values())
    for cid in m.contestants:
        seen = [e for e in m.events.visible_since(0, cid) if e.type in ("role_assigned", "skill_assigned")]
        assert {e.data["contestant"] for e in seen} == {cid}  # only your own role and skill
        me = m.snapshot(cid)["me"]
        assert me["role"] == m.contestants[cid].role
        assert me["kill_cooldown"] is None or m.contestants[cid].role == R.IMPOSTOR
    # Nobody's role is in public data.
    snap = m.snapshot("p1")
    assert all("role" not in c for c in snap["roster"] + snap["contestants"])


def test_two_impostors_know_each_other(moonfall: GameMap) -> None:
    m = Match("r2", moonfall, 5, mode="impostor")
    for i in range(1, 11):
        m.add_contestant(f"p{i}", f"P{i}", "knight", is_bot=False)
    m.start()
    imps = sorted(c.id for c in m.contestants.values() if c.role == R.IMPOSTOR)
    assert len(imps) == 2
    assert m.snapshot(imps[0])["me"]["fellow_impostors"] == [imps[1]]


def test_kill_rules(moonfall: GameMap) -> None:
    m = humans(moonfall)
    spread(m)
    assert m.kill("p2", "p3").reason == "not_impostor"
    assert m.kill("p1", "p2").reason == "out_of_range"
    put(m, "p2", 41.5 + 1.0, 33.5)
    m.contestants["p1"].kill_ready_tick = m.tick + 100
    assert m.kill("p1", "p2").reason == "kill_cooldown"
    m.contestants["p1"].kill_ready_tick = 0
    assert m.kill("p1", "p1").reason == "invalid_target"
    r = m.kill("p1", "p2")
    assert r.ok
    assert not m.contestants["p2"].alive
    assert m.contestants["p1"].kill_ready_tick == m.tick + m.kill_cooldown
    assert m.kill("p1", "p2").reason in ("invalid_target", "kill_cooldown")


def test_impostors_cannot_kill_each_other_or_during_meetings(moonfall: GameMap) -> None:
    m = humans(moonfall, impostors=("p1", "p2"), n=7)
    spread(m)
    put(m, "p2", 41.5 + 1.0, 33.5)
    assert m.kill("p1", "p2").reason == "invalid_target"
    m._start_meeting("bell", "p3")
    put(m, "p3", 41.5 - 1.0, 33.5)
    assert m.kill("p1", "p3").reason == "meeting_in_progress"


def test_unfound_death_is_secret_until_body_reported(moonfall: GameMap) -> None:
    m = humans(moonfall)
    spread(m)
    put(m, "p2", 42.5, 33.5)
    m.kill("p1", "p2")
    killed = [e for e in m.events if e.type == "contestant_killed"]
    assert killed and killed[-1].visible_to == frozenset({"p1", "p2"})

    # Islanders still believe p2 is alive; the impostor and the ghost know.
    def roster_alive(viewer: str) -> bool:
        return next(r for r in m.snapshot(viewer)["roster"] if r["id"] == "p2")["alive"]

    assert roster_alive("p3") is True
    assert roster_alive("p1") is False
    assert roster_alive("p2") is False
    assert "p2" in m.observe("p3").alive_ids and "p2" not in m.observe("p1").alive_ids
    # A body is seen only within view range.
    assert m.snapshot("p4")["bodies"] == []
    put(m, "p4", 42.5 + 1.5, 33.5)
    assert [b["victim"] for b in m.snapshot("p4")["bodies"]] == ["p2"]
    assert m.interact("p4", "body_p2").ok
    assert m.phase == "discuss"
    called = [e for e in m.events if e.type == "meeting_called"][-1]
    assert called.data["cause"] == "body" and called.data["victim"] == "p2" and called.data["caller"] == "p4"
    assert [e for e in m.events if e.type == "deaths_revealed"][-1].data["dead"] == ["p2"]
    assert roster_alive("p3") is False
    assert m.bodies == {}


def test_report_needs_range(moonfall: GameMap) -> None:
    m = humans(moonfall)
    spread(m)
    put(m, "p2", 42.5, 33.5)
    m.kill("p1", "p2")
    put(m, "p3", 42.5 + R.REPORT_RANGE + 0.5, 33.5)
    assert m.interact("p3", "body_p2").reason == "out_of_range"
    assert m.interact("p3", "body_p9").reason == "not_interactable"


def test_witnesses_and_lookout(moonfall: GameMap) -> None:
    m = humans(moonfall)
    spread(m)
    put(m, "p2", 42.5, 33.5)
    put(m, "p3", 42.5 + 3.0, 33.5)  # within witness radius
    m.contestants["p4"].skill = R.SKILLS["lookout"]
    put(m, "p4", 42.5, 33.5 + 15.0)  # too far to see, close enough to sense
    m.kill("p1", "p2")
    witnessed = [e for e in m.events if e.type == "kill_witnessed"]
    assert witnessed and witnessed[-1].visible_to == frozenset({"p3"}) and witnessed[-1].data["killer"] == "p1"
    alert = [e for e in m.events if e.type == "lookout_alert"]
    assert alert and alert[-1].visible_to == frozenset({"p4"}) and "killer" not in alert[-1].data


def test_ghosts_roam_unseen_and_chat_only_with_the_dead(moonfall: GameMap) -> None:
    m = humans(moonfall)
    spread(m)
    put(m, "p2", 42.5, 33.5)
    put(m, "p3", 44.5, 33.5)
    m.kill("p1", "p2")
    assert "p2" not in {c["id"] for c in m.snapshot("p3")["contestants"]}
    assert "p3" in {c["id"] for c in m.snapshot("p2")["contestants"]}  # ghosts see everyone
    x0 = m.contestants["p2"].x
    for seq in range(1, 6):
        m.queue_input("p2", seq, 1.0, 0.0)
        m.step()
    assert m.contestants["p2"].x > x0  # ghosts can move
    r = m.chat("p2", text="boo")
    assert r.ok and r.events[0].visible_to == frozenset({"p2"})
    assert r.events[0].data["ghost"] is True
    assert m.chat("p3", text="hello").events[0].visible_to is None


def test_impostor_tasks_are_fake_and_beacons_need_wood(moonfall: GameMap) -> None:
    m = humans(moonfall)
    spread(m)
    beacon = moonfall.objects_by_id["beacon_docks"]
    put(m, "p2", beacon.x + 0.5, beacon.y - 0.8)
    assert m.interact("p2", "beacon_docks").reason == "need_wood"
    m.contestants["p2"].carrying["wood"] = 1
    m.contestants["p2"].last_interact_tick = -100
    assert m.interact("p2", "beacon_docks").ok
    assert m.beacons["beacon_docks"] and m.contestants["p2"].carrying["wood"] == 0
    assert m.interact("p2", "beacon_docks").reason in ("already_lit", "cooldown")
    # The impostor "lights" a beacon: only they are told; nothing changes.
    other = moonfall.objects_by_id["beacon_marsh"]
    put(m, "p1", other.x + 0.5, other.y + 1.6)
    r = m.interact("p1", "beacon_marsh")
    assert r.ok and r.events[0].type == "beacon_faked" and r.events[0].visible_to == frozenset({"p1"})
    assert m.beacons["beacon_marsh"] is False
    # Faked delivery: cargo vanishes, the tower does not change.
    tower = moonfall.objects_by_id["watchtower"]
    put(m, "p1", tower.x + 1.0, tower.y + 2.6)
    m.contestants["p1"].carrying = {"wood": 2, "stone": 0}
    m.contestants["p1"].last_interact_tick = -100
    before = dict(m.mission.delivered)
    r = m.interact("p1", "watchtower")
    assert r.ok and r.events[0].type == "delivery_faked"
    assert m.mission.delivered == before and m.contestants["p1"].carrying["wood"] == 0


def test_tasks_are_only_seen_by_those_nearby(moonfall: GameMap) -> None:
    m = humans(moonfall)
    spread(m)
    tower = moonfall.objects_by_id["watchtower"]
    put(m, "p2", tower.x + 1.0, tower.y + 2.6)
    put(m, "p3", tower.x + 4.0, tower.y + 3.0)
    m.contestants["p2"].carrying = {"wood": 2, "stone": 0}
    ev = m.interact("p2", "watchtower").events[0]
    assert ev.type == "resources_delivered"
    assert "p3" in (ev.visible_to or set()) and "p5" not in (ev.visible_to or set())


def test_confirmed_ejection_and_islander_win(moonfall: GameMap) -> None:
    m = humans(moonfall)
    m._start_meeting("bell", "p2")
    m.tick = m.phase_end_tick
    m.step()
    assert m.phase == "vote"
    for v in ("p2", "p3", "p4", "p5"):
        assert m.vote(v, "p1").ok
    assert m.vote("p1", None).ok
    m.step()  # everyone voted -> resolved
    res = [e for e in m.events if e.type == "vote_resolved"][-1]
    assert res.data["eliminated"] == "p1" and res.data["was_impostor"] is True and res.data["impostors_left"] == 0
    assert m.status == "running"  # the reveal plays out first
    while m.status == "running":
        m.step()
    assert m.result is not None
    assert m.result["reason"] == "impostors_caught" and m.result["winning_team"] == R.ISLANDER
    assert set(m.result["winners"]) == {"p2", "p3", "p4", "p5"}
    p1 = next(s for s in m.result["standings"] if s["id"] == "p1")
    assert p1["role"] == R.IMPOSTOR and not p1["won"]


def test_impostors_win_at_parity(moonfall: GameMap) -> None:
    m = humans(moonfall)
    spread(m)
    for victim in ("p2", "p3", "p4"):
        put(m, victim, m.contestants["p1"].x + 1.0, m.contestants["p1"].y)
        m.contestants["p1"].kill_ready_tick = 0
        assert m.kill("p1", victim).ok
    assert m.status == "finished"
    assert m.result is not None and m.result["reason"] == "impostors_outnumber"
    assert m.result["winners"] == ["p1"]


def test_islanders_win_by_finishing_tasks(moonfall: GameMap) -> None:
    m = humans(moonfall)
    for b in m.beacons:
        m.beacons[b] = True
    m.mission.delivered = {r: n - 1 for r, n in m.mission.required.items()}
    m.mission.delivered["stone"] = m.mission.required["stone"]
    tower = moonfall.objects_by_id["watchtower"]
    put(m, "p2", tower.x + 1.0, tower.y + 2.6)
    m.contestants["p2"].carrying = {"wood": 1, "stone": 0}
    assert m.interact("p2", "watchtower").ok
    assert m.status == "finished" and m.result is not None and m.result["reason"] == "tasks_done"


def test_time_up_goes_to_impostors(moonfall: GameMap) -> None:
    m = humans(moonfall, time_limit_seconds=1)
    m.meetings_enabled = False
    while m.status == "running":
        m.step()
    assert m.result is not None and m.result["reason"] == "time_up" and m.result["winning_team"] == R.IMPOSTOR


def test_skill_swift_scout_strongback(moonfall: GameMap) -> None:
    m = humans(moonfall)
    spread(m)
    m.contestants["p2"].skill = R.SKILLS["swift"]
    x0 = m.contestants["p2"].x
    m.queue_input("p2", 1, 1.0, 0.0)
    m.step()
    assert m.contestants["p2"].x - x0 == pytest.approx(physics.SPEED * R.SWIFT_SPEED * physics.DT)
    assert m.snapshot("p2")["me"]["speed"] == R.SWIFT_SPEED
    m.contestants["p3"].skill = R.SKILLS["scout"]
    put(m, "p3", 41.5, 33.5 + 1.0)
    put(m, "p4", 41.5 + 17.0, 33.5)
    put(m, "p5", 41.5, 33.5 + 3.0)
    assert m.can_see("p3", m.contestants["p4"]) and not m.can_see("p5", m.contestants["p4"])
    m.contestants["p5"].skill = R.SKILLS["strongback"]
    assert m.capacity(m.contestants["p5"]) == R.STRONGBACK_CAPACITY and m.snapshot("p5")["me"]["capacity"] == 5


def test_medic_shield_blocks_one_attack(moonfall: GameMap) -> None:
    m = humans(moonfall)
    spread(m)
    m.contestants["p3"].skill = R.SKILLS["medic"]
    assert m.use_ability("p2", "p4").reason == "no_active_skill"
    assert m.use_ability("p3", "p3").reason == "invalid_target"
    assert m.use_ability("p3", "p2").ok
    assert m.use_ability("p3", "p4").reason == "ability_used"
    put(m, "p2", 42.5, 33.5)
    r = m.kill("p1", "p2")
    assert r.ok and r.reason == "shielded" and m.contestants["p2"].alive
    blocked = [e for e in m.events if e.type == "shield_blocked"][-1]
    assert blocked.visible_to == frozenset({"p1", "p2", "p3"})
    m.contestants["p1"].kill_ready_tick = 0
    assert m.kill("p1", "p2").ok and not m.contestants["p2"].alive  # one attack only


def test_detective_clue_names_the_killer(moonfall: GameMap) -> None:
    m = humans(moonfall, n=6)
    spread(m)
    m.contestants["p4"].skill = R.SKILLS["detective"]
    put(m, "p2", 42.5, 33.5)
    m.kill("p1", "p2")
    put(m, "p4", 42.5 + 1.0, 33.5)
    m.interact("p4", "body_p2")
    clue = [e for e in m.events if e.type == "detective_clue"][-1]
    assert clue.visible_to == frozenset({"p4"})
    assert "p1" in clue.data["suspects"] and len(set(clue.data["suspects"])) == 2
    assert "p4" not in clue.data["suspects"] and "p2" not in clue.data["suspects"]


def test_shrine_vision_reveals_an_innocent(moonfall: GameMap) -> None:
    m = humans(moonfall, n=6)
    m.meetings_enabled = False
    shrine = moonfall.objects_by_id["shrine"]
    for cid in ("p2", "p3", "p4"):
        put(m, cid, shrine.x + 1.0, shrine.y + shrine.h + 0.6)
        assert m.interact(cid, "shrine").ok
    visions = [e for e in m.events if e.type == "shrine_vision"]
    assert len(visions) == 3
    for e in visions:
        assert m.contestants[e.data["innocent"]].role == R.ISLANDER
        assert e.data["innocent"] not in e.visible_to  # type: ignore[operator]


def test_kill_cooldown_follows_the_tuned_table() -> None:
    assert R.impostor_count(6) == 1 and R.impostor_count(7) == 2
    for n, seconds in R.KILL_COOLDOWN_S_BY_FIELD.items():
        assert R.kill_cooldown_ticks(n) == seconds * physics.TICK_RATE
    # Within each impostor count, bigger fields get shorter cooldowns.
    assert R.kill_cooldown_ticks(5) > R.kill_cooldown_ticks(6)
    assert R.kill_cooldown_ticks(7) > R.kill_cooldown_ticks(8) > R.kill_cooldown_ticks(9) > R.kill_cooldown_ticks(10)
    assert R.kill_cooldown_ticks(3) > 0


def test_impostor_mode_needs_three(moonfall: GameMap) -> None:
    m = Match("tiny", moonfall, 1, mode="impostor")
    m.add_contestant("p1", "P1", "knight", is_bot=False)
    m.add_contestant("p2", "P2", "knight", is_bot=False)
    with pytest.raises(ValueError):
        m.start()


@pytest.mark.parametrize("seed", [1, 4, 9])
def test_bots_play_full_impostor_matches(moonfall: GameMap, seed: int) -> None:
    m = Match("bots", moonfall, seed, mode="impostor")
    for i in range(7):
        m.add_contestant(f"bot{i + 1}", f"Bot{i + 1}", "knight", is_bot=True)
    m.start()
    while m.status == "running":
        m.step()
        for c in m.contestants.values():
            if c.alive:
                assert not physics.box_blocked(moonfall.is_solid, c.x, c.y)
    assert m.result is not None and m.result["winning_team"] in (R.ISLANDER, R.IMPOSTOR)
    chats = [e for e in m.events if e.type == "chat"]
    assert chats, "bots should talk"
    texts = [e.data["text"] for e in chats]
    assert len(set(texts)) >= 0.6 * len(texts), "chat should not be repetitive"
    # Every bot action was legal or refused by the engine; kills only by impostors.
    for e in m.events:
        if e.type == "contestant_killed":
            assert m.contestants[e.data["killer"]].role == R.IMPOSTOR
    # Bots never claim things only the omniscient view could know (e.g. naming an unwitnessed killer).
    for e in chats:
        claim = e.data.get("claim") or {}
        if claim.get("about") == "saw" and m.contestants[e.data["sender"]].role == R.ISLANDER:
            target = claim["target"]
            witnessed = any(
                w.type in ("kill_witnessed", "shield_blocked")
                and e.data["sender"] in (w.visible_to or ())
                and (w.data.get("killer") == target or w.data.get("attacker") == target)
                for w in m.events
                if w.seq < e.seq
            )
            assert witnessed


def test_impostor_matches_are_deterministic(moonfall: GameMap) -> None:
    def play() -> list[tuple[int, str]]:
        m = Match("det", moonfall, 21, mode="impostor", time_limit_seconds=120)
        for i in range(6):
            m.add_contestant(f"bot{i + 1}", f"Bot{i + 1}", "knight", is_bot=True)
        m.start()
        while m.status == "running":
            m.step()
        return [(e.seq, e.type) for e in m.events]

    assert play() == play()


def test_bot_impostors_only_strike_unwatched(moonfall: GameMap) -> None:
    for seed in (2, 6):
        m = Match("w", moonfall, seed, mode="impostor")
        for i in range(7):
            m.add_contestant(f"bot{i + 1}", f"Bot{i + 1}", "knight", is_bot=True)
        m.start()
        while m.status == "running":
            m.step()
        for e in m.events:
            if e.type == "contestant_killed":
                assert e.data["witnesses"] == []
                assert math.isfinite(e.data["x"])


@pytest.mark.parametrize("seed", [3, 8])
def test_replay_reconstructs_impostor_matches(moonfall: GameMap, seed: int) -> None:
    from arenix.engine.replay import replay

    m = Match("rep", moonfall, seed, mode="impostor")
    for i in range(7):
        m.add_contestant(f"b{i}", f"Bot{i}", "rogue", is_bot=True)
    m.start()
    while m.status == "running":
        m.step()
    state = replay(m.events)
    assert m.result is not None
    assert state.finished and state.winning_team == m.result["winning_team"]
    assert state.scores == {c.id: c.score for c in m.contestants.values()}
    assert state.alive == {c.id: c.alive for c in m.contestants.values()}
    assert state.beacons == m.beacons
    assert state.delivered == m.mission.delivered


def test_scores_and_contributions_stay_private_until_the_end(moonfall: GameMap) -> None:
    m = humans(moonfall)
    spread(m)
    put(m, "p2", 42.5, 33.5)
    m.kill("p1", "p2")  # +30 for the impostor
    m.mission.contributions = {"p3": 4, "p4": 2}
    snap = m.snapshot("p3")
    assert {r["id"]: r["score"] for r in snap["roster"]} == {"p1": None, "p2": None, "p3": 0, "p4": None, "p5": None}
    assert snap["mission"]["contributions"] == {"p3": 4}
    assert m.contestants["p1"].score == 30 and m.mission.contributions == {"p3": 4, "p4": 2}  # not mutated
    m._finish("time_up")
    assert all(r["score"] is not None for r in m.snapshot("p3")["roster"])
