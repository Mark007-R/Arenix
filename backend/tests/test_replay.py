import pytest

from arenix.engine.map import GameMap
from arenix.engine.match import Match
from arenix.engine.replay import replay


@pytest.mark.parametrize("seed", [1, 2, 3, 4, 5, 6])
def test_replay_reconstructs_final_state_exactly(emerald: GameMap, seed: int) -> None:
    m = Match("replay", emerald, seed)
    for i in range(6):
        m.add_contestant(f"b{i}", f"Bot{i}", "rogue", is_bot=True)
    m.start()
    while m.status == "running":
        m.step()
    state = replay(m.events)
    assert state.finished and state.winner == m.result["winner"]  # type: ignore[index]
    assert state.scores == {c.id: c.score for c in m.contestants.values()}
    assert state.alive == {c.id: c.alive for c in m.contestants.values()}
    assert state.delivered == m.mission.delivered
    assert state.tower_repaired == (m.mission.status == "completed")
    assert state.shrine == ("activated" if m.shrine.status == "activated" else state.shrine)
    assert state.alliances == m.alliances.partner


def test_replay_can_stop_midway_and_is_deterministic(emerald: GameMap) -> None:
    m = Match("replay", emerald, 3)
    for i in range(4):
        m.add_contestant(f"b{i}", f"Bot{i}", "rogue", is_bot=True)
    m.start()
    for _ in range(2000):
        m.step()
    mid = m.events.since(0)[len(m.events) // 2].seq
    a, b = replay(m.events, upto_seq=mid), replay(m.events, upto_seq=mid)
    assert a == b and a.seq == mid and not a.finished


def test_position_samples_are_visible_to_no_player(emerald: GameMap) -> None:
    m = Match("replay", emerald, 3)
    m.add_contestant("p1", "P", "knight", is_bot=False)
    m.start()
    for _ in range(100):
        m.step()
    samples = [e for e in m.events if e.type == "position_sample"]
    assert samples and all(not e.visible("p1") and e.visible(None) for e in samples)
    assert "position_sample" not in str(m.events.visible_since(0, "p1"))
