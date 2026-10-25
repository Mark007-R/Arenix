import pytest

from arenix.engine import physics
from arenix.engine.map import GameMap
from arenix.engine.match import Match


@pytest.mark.parametrize("seed", [1, 2, 3, 4, 5])
def test_bots_alone_complete_the_mission(emerald: GameMap, seed: int) -> None:
    m = Match("sim", emerald, seed, time_limit_seconds=240)
    for i in range(3):
        m.add_contestant(f"b{i}", f"Bot{i}", "rogue", is_bot=True)
    m.start()
    while m.status == "running":
        m.step()
        for c in m.contestants.values():
            assert not physics.box_blocked(emerald.is_solid, c.x, c.y)
    assert m.mission.status == "completed", m.result
    assert m.result is not None and m.result["winner"] is not None


def test_bots_only_interact_through_validated_requests(emerald: GameMap) -> None:
    m = Match("sim", emerald, 3)
    m.add_contestant("b0", "Bot", "rogue", is_bot=True)
    m.start()
    for _ in range(800):
        m.step()
    gathered = [e for e in m.events if e.type == "resource_gathered"]
    assert gathered, "bot should have gathered something"
    # The bot's internal log holds structured summaries only.
    brain = m.bots["b0"]
    assert brain.decisions and all(set(d) == {"tick", "summary", "goal"} for d in brain.decisions)


def test_single_bot_with_single_human_does_not_crash_when_idle(emerald: GameMap) -> None:
    m = Match("sim", emerald, 9, time_limit_seconds=5)
    m.add_contestant("p1", "Hero", "knight", is_bot=False)
    m.add_contestant("b0", "Bot", "rogue", is_bot=True)
    m.start()
    while m.status == "running":
        m.step()
    assert m.status == "finished"
