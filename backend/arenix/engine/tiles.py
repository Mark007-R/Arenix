"""Tile vocabulary shared by the engine and (via the map payload) the client renderer."""

from enum import IntEnum


class Tile(IntEnum):
    WATER = 0
    SAND = 1
    GRASS = 2
    PATH = 3
    BRIDGE = 4
    TREE = 5
    WALL = 6
    ROCK = 7
    FLOOR = 8
    FLOWERS = 9
    FOREST_FLOOR = 10
    DIRT = 11
    RUIN = 12


SOLID_TILES: frozenset[Tile] = frozenset({Tile.WATER, Tile.TREE, Tile.WALL, Tile.ROCK, Tile.RUIN})
