"""A* navigation over the collision grid (4-connected, uniform cost)."""

from __future__ import annotations

import heapq
from collections.abc import Callable

from .map import GameMap

Tile2 = tuple[int, int]


def astar(
    game_map: GameMap,
    start: Tile2,
    is_goal: Callable[[int, int], bool],
    heuristic: Callable[[int, int], float],
    max_nodes: int = 20_000,
) -> list[Tile2] | None:
    """Return the tile path from start (inclusive) to the first goal tile, or None.

    The start tile is allowed even if solid so that a contestant nudged against a wall can
    still plan its way out.
    """
    if is_goal(*start):
        return [start]
    open_heap: list[tuple[float, int, Tile2]] = [(heuristic(*start), 0, start)]
    came_from: dict[Tile2, Tile2] = {}
    g_score: dict[Tile2, int] = {start: 0}
    counter = 0
    expanded = 0
    while open_heap:
        _, _, current = heapq.heappop(open_heap)
        expanded += 1
        if expanded > max_nodes:
            return None
        if is_goal(*current):
            path = [current]
            while current in came_from:
                current = came_from[current]
                path.append(current)
            path.reverse()
            return path
        cx, cy = current
        for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
            if game_map.is_solid(nx, ny):
                continue
            tentative = g_score[current] + 1
            if tentative < g_score.get((nx, ny), 1 << 30):
                g_score[(nx, ny)] = tentative
                came_from[(nx, ny)] = current
                counter += 1
                heapq.heappush(open_heap, (tentative + heuristic(nx, ny), counter, (nx, ny)))
    return None


def path_to_point(game_map: GameMap, start: Tile2, goal: Tile2) -> list[Tile2] | None:
    gx, gy = goal
    return astar(
        game_map,
        start,
        lambda x, y: (x, y) == goal,
        lambda x, y: abs(x - gx) + abs(y - gy),
    )


def path_into_range(game_map: GameMap, start: Tile2, target_id: str, interact_range: float) -> list[Tile2] | None:
    """Path to any walkable tile whose centre is within interaction range of an object."""
    obj = game_map.objects_by_id[target_id]
    # Shrink slightly so the contestant is comfortably in range on arrival.
    reach = interact_range - 0.15

    def is_goal(x: int, y: int) -> bool:
        return not game_map.is_solid(x, y) and obj.distance_to(x + 0.5, y + 0.5) <= reach

    return astar(game_map, start, is_goal, lambda x, y: max(0.0, obj.distance_to(x + 0.5, y + 0.5) - reach))
