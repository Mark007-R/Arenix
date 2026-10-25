import math

from arenix.engine import physics
from arenix.engine.map import GameMap
from arenix.engine.match import INTERACT_RANGE
from arenix.engine.pathfinding import path_into_range, path_to_point
from arenix.engine.tiles import Tile


def test_dimensions_and_payload(emerald: GameMap) -> None:
    d = emerald.to_dict()
    assert len(d["tiles"]) == emerald.width * emerald.height
    assert len(d["collision"]) == emerald.width * emerald.height
    assert set(d["collision"]) <= {"0", "1"}


def test_out_of_bounds_is_solid(emerald: GameMap) -> None:
    assert emerald.is_solid(-1, 0)
    assert emerald.is_solid(0, emerald.height)


def test_map_border_is_water(emerald: GameMap) -> None:
    for x in range(emerald.width):
        assert emerald.tile(x, 0) == Tile.WATER
        assert emerald.tile(x, emerald.height - 1) == Tile.WATER


def test_spawns_are_walkable(emerald: GameMap) -> None:
    assert len(emerald.spawns) >= 10
    for sx, sy in emerald.spawns:
        assert not physics.box_blocked(emerald.is_solid, sx, sy)


def test_object_footprints_are_solid(emerald: GameMap) -> None:
    for o in emerald.objects:
        if o.solid:
            assert all(emerald.is_solid(x, y) for y in range(o.y, o.y + o.h) for x in range(o.x, o.x + o.w))


def test_every_interactable_reachable_from_every_spawn(emerald: GameMap) -> None:
    targets = [o for o in emerald.objects if o.interactable]
    assert any(o.id == "watchtower" for o in targets)
    for sx, sy in emerald.spawns:
        for o in targets:
            path = path_into_range(emerald, (math.floor(sx), math.floor(sy)), o.id, INTERACT_RANGE)
            assert path is not None, f"{o.id} unreachable from {sx, sy}"
            end = path[-1]
            assert o.distance_to(end[0] + 0.5, end[1] + 0.5) <= INTERACT_RANGE


def test_paths_are_contiguous_and_walkable(emerald: GameMap) -> None:
    path = path_to_point(emerald, (22, 21), (50, 10))
    assert path is not None
    for (ax, ay), (bx, by) in zip(path, path[1:], strict=False):
        assert abs(ax - bx) + abs(ay - by) == 1
        assert not emerald.is_solid(bx, by)


def test_unreachable_goal_returns_none(emerald: GameMap) -> None:
    assert path_to_point(emerald, (22, 21), (0, 0)) is None


def test_regions(emerald: GameMap) -> None:
    assert emerald.region_at(25.5, 23.5) == "Village Plaza"
    assert emerald.region_at(50, 8) == "Old Mine"
