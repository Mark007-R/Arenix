"""Map model: a tile grid plus placed objects with solid footprints."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from .tiles import SOLID_TILES, Tile


@dataclass(frozen=True)
class MapObject:
    id: str
    kind: str
    x: int
    y: int
    w: int = 1
    h: int = 1
    solid: bool = True
    interactable: bool = False
    props: dict[str, Any] = field(default_factory=dict)

    def distance_to(self, px: float, py: float) -> float:
        """Euclidean distance from a point to the object's footprint rectangle."""
        cx = min(max(px, self.x), self.x + self.w)
        cy = min(max(py, self.y), self.y + self.h)
        return math.sqrt((px - cx) ** 2 + (py - cy) ** 2)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "x": self.x,
            "y": self.y,
            "w": self.w,
            "h": self.h,
            "solid": self.solid,
            "interactable": self.interactable,
            "props": self.props,
        }


@dataclass
class Region:
    """Named area used for location-aware UI ("Mine", "Village") and, later, agent observations."""

    name: str
    x: int
    y: int
    w: int
    h: int

    def contains(self, px: float, py: float) -> bool:
        return self.x <= px < self.x + self.w and self.y <= py < self.y + self.h


class GameMap:
    def __init__(
        self,
        map_id: str,
        name: str,
        width: int,
        height: int,
        tiles: list[int],
        objects: list[MapObject],
        spawns: list[tuple[float, float]],
        regions: list[Region],
    ) -> None:
        if len(tiles) != width * height:
            raise ValueError("tile array does not match map dimensions")
        self.id = map_id
        self.name = name
        self.width = width
        self.height = height
        self.tiles = tiles
        self.objects = objects
        self.objects_by_id = {o.id: o for o in objects}
        self.spawns = spawns
        self.regions = regions
        self.collision = bytearray(width * height)
        for i, t in enumerate(tiles):
            if Tile(t) in SOLID_TILES:
                self.collision[i] = 1
        for o in objects:
            if o.solid:
                for ty in range(o.y, o.y + o.h):
                    for tx in range(o.x, o.x + o.w):
                        self.collision[ty * width + tx] = 1

    def tile(self, tx: int, ty: int) -> Tile:
        return Tile(self.tiles[ty * self.width + tx])

    def in_bounds(self, tx: int, ty: int) -> bool:
        return 0 <= tx < self.width and 0 <= ty < self.height

    def is_solid(self, tx: int, ty: int) -> bool:
        if not self.in_bounds(tx, ty):
            return True
        return self.collision[ty * self.width + tx] == 1

    def region_at(self, px: float, py: float) -> str | None:
        for r in self.regions:
            if r.contains(px, py):
                return r.name
        return None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "width": self.width,
            "height": self.height,
            "tiles": self.tiles,
            "collision": "".join("1" if c else "0" for c in self.collision),
            "objects": [o.to_dict() for o in self.objects],
            "spawns": [list(s) for s in self.spawns],
            "regions": [r.__dict__ for r in self.regions],
        }

    def ascii(self) -> str:
        glyph = {
            Tile.WATER: "~",
            Tile.SAND: ":",
            Tile.GRASS: ".",
            Tile.PATH: "=",
            Tile.BRIDGE: "H",
            Tile.TREE: "T",
            Tile.WALL: "#",
            Tile.ROCK: "^",
            Tile.FLOOR: "_",
            Tile.FLOWERS: ",",
            Tile.FOREST_FLOOR: ";",
            Tile.DIRT: "-",
            Tile.RUIN: "I",
        }
        rows = [[glyph[self.tile(x, y)] for x in range(self.width)] for y in range(self.height)]
        for o in self.objects:
            ch = {"resource_node": "W" if o.props.get("resource") == "wood" else "S"}.get(o.kind, o.kind[0].upper())
            for ty in range(o.y, o.y + o.h):
                for tx in range(o.x, o.x + o.w):
                    rows[ty][tx] = ch
        return "\n".join("".join(r) for r in rows)
