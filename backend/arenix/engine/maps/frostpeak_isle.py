"""Frostpeak Isle — the winter map (88x64).

A snowy island around a mountain spine. The village and the Council Bell sit in the south; the
Watchtower stands on a pass through the mountains; a frozen lake fills the west; ice caves
(stone) are cut into the north-east peaks; a pine forest (wood) covers the south-west; Frost
Keep guards the west coast and the Aurora Shrine glows in the east. Five beacons ring the coast.
Rendered with the "winter" palette (grass is snow, water is icy).
"""

from __future__ import annotations

import math

from ..map import GameMap, MapObject, Region
from ..tiles import Tile
from .emerald_isle import _hash

MAP_ID = "frostpeak_isle"
W, H = 88, 64


class _Painter:
    def __init__(self) -> None:
        self.t = [[Tile.WATER] * W for _ in range(H)]
        self.protected = [[False] * W for _ in range(H)]

    def get(self, x: int, y: int) -> Tile:
        return self.t[y][x]

    def set(self, x: int, y: int, tile: Tile, protect: bool = False) -> None:
        if 0 <= x < W and 0 <= y < H:
            self.t[y][x] = tile
            if protect:
                self.protected[y][x] = True

    def rect(self, x: int, y: int, w: int, h: int, tile: Tile, protect: bool = False) -> None:
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.set(xx, yy, tile, protect)

    def circle(self, cx: float, cy: float, r: float, tile: Tile, protect: bool = False) -> None:
        for yy in range(int(cy - r) - 1, int(cy + r) + 2):
            for xx in range(int(cx - r) - 1, int(cx + r) + 2):
                if (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r:
                    self.set(xx, yy, tile, protect)

    def path(self, points: list[tuple[int, int]], width: int = 2, tile: Tile = Tile.PATH) -> None:
        for (x0, y0), (x1, y1) in zip(points, points[1:], strict=False):
            for yy in range(min(y0, y1), max(y0, y1) + 1):
                for xx in range(min(x0, x1), max(x0, x1) + 1):
                    for oy in range(width):
                        for ox in range(width):
                            px, py = xx + ox, yy + oy
                            if not (0 <= px < W and 0 <= py < H):
                                continue
                            if self.t[py][px] == Tile.WATER:
                                self.set(px, py, Tile.BRIDGE, True)
                            elif self.t[py][px] not in (Tile.BRIDGE, Tile.FLOOR):
                                self.set(px, py, tile, True)


WOOD = [(12, 40), (18, 44), (24, 40), (14, 50), (22, 52), (28, 47), (32, 54)]
STONE = [(60, 9), (66, 7), (72, 10), (63, 15), (70, 16), (76, 13)]
BEACONS = {
    "beacon_north": (42, 4, "North Cape Beacon"),
    "beacon_keep": (6, 26, "Frost Keep Beacon"),
    "beacon_aurora": (80, 34, "Aurora Beacon"),
    "beacon_pines": (16, 57, "Pinewood Beacon"),
    "beacon_harbor": (60, 57, "Harbor Beacon"),
}


def build() -> GameMap:
    p = _Painter()

    cx, cy, rx, ry = 43.5, 31.5, 41.0, 29.0
    for y in range(H):
        for x in range(W):
            d = ((x - cx) / rx) ** 4 + ((y - cy) / ry) ** 4
            d += (_hash(x // 3, y // 3, 53) - 0.5) * 0.12
            if d < 0.84:
                p.set(x, y, Tile.GRASS)
            elif d < 1.0:
                p.set(x, y, Tile.SAND)

    # --- Mountain spine across the north, with a pass for the Watchtower road ---------------
    for x in range(14, 80):
        top = 10 + round(3 * math.sin(x / 5.0))
        for y in range(top, top + 6):
            if p.get(x, y) in (Tile.GRASS, Tile.SAND):
                p.set(x, y, Tile.ROCK)

    # --- Frozen lake (west) --------------------------------------------------------------------
    p.circle(20, 26, 6.5, Tile.WATER)
    p.circle(26, 29, 3.5, Tile.WATER)

    # --- Ice caves (north-east, stone) -------------------------------------------------------
    p.rect(56, 3, 24, 17, Tile.ROCK)
    p.rect(57, 5, 22, 14, Tile.DIRT, protect=True)

    # --- Pinewood (south-west, wood) ---------------------------------------------------------
    for y in range(36, 60):
        for x in range(6, 36):
            if p.get(x, y) in (Tile.GRASS, Tile.SAND):
                p.set(x, y, Tile.TREE if _hash(x, y, 59) < 0.5 else Tile.FOREST_FLOOR)
    for nx, ny in WOOD:
        p.circle(nx, ny, 2.3, Tile.FOREST_FLOOR)
    ff = Tile.FOREST_FLOOR
    for trail in (
        [(36, 46), (28, 46), (28, 47)],
        [(28, 46), (24, 46), (24, 40)],
        [(24, 44), (18, 44)],
        [(18, 44), (12, 44), (12, 40)],
        [(14, 44), (14, 50)],
        [(14, 50), (22, 50), (22, 52)],
        [(22, 50), (32, 50), (32, 54)],
        [(16, 50), (16, 56)],
    ):
        p.path(trail, width=1, tile=ff)

    # --- Frost Keep (west coast castle) ------------------------------------------------------
    p.rect(4, 32, 12, 3, Tile.WALL, protect=True)  # northern wall stub leaving the keep open
    p.rect(3, 18, 12, 13, Tile.WALL, protect=True)
    p.rect(4, 19, 10, 11, Tile.FLOOR, protect=True)
    p.rect(14, 23, 1, 3, Tile.FLOOR, protect=True)  # east gate

    # --- Aurora Shrine (east) ----------------------------------------------------------------
    p.circle(74, 38, 5.0, Tile.GRASS)
    p.rect(71, 35, 7, 7, Tile.FLOOR, protect=True)
    for rxp, ryp in ((71, 35), (77, 35), (71, 41), (77, 41)):
        p.set(rxp, ryp, Tile.RUIN, protect=True)

    # --- Harbor (south-east) -----------------------------------------------------------------
    p.rect(57, 55, 6, 7, Tile.BRIDGE, protect=True)

    # --- Village (south-centre) ----------------------------------------------------------------
    p.rect(38, 38, 14, 10, Tile.PATH, protect=True)

    # --- Roads -------------------------------------------------------------------------------
    p.path([(44, 38), (44, 6), (42, 6)])  # north through the pass to the Watchtower and the cape
    p.path([(38, 42), (16, 42), (16, 24), (14, 24)])  # west around the lake to Frost Keep
    p.path([(38, 46), (36, 46)])  # into Pinewood
    p.path([(51, 42), (70, 42), (70, 38)])  # east to the shrine
    p.path([(60, 42), (60, 19)])  # north-east up to the ice caves
    p.path([(46, 47), (46, 54), (58, 54), (58, 55)])  # south to the harbor
    p.path([(70, 42), (80, 42), (80, 36)], width=1, tile=Tile.DIRT)  # spur to the Aurora beacon
    p.path([(16, 42), (6, 42), (6, 28)], width=1, tile=Tile.DIRT)  # coast path to the keep beacon
    p.path([(16, 50), (16, 56)], width=1, tile=ff)

    # --- Decoration --------------------------------------------------------------------------
    for y in range(H):
        for x in range(W):
            if p.get(x, y) != Tile.GRASS or p.protected[y][x]:
                continue
            near_road = any(
                0 <= x + ox < W and 0 <= y + oy < H and p.protected[y + oy][x + ox]
                for oy in (-2, -1, 0, 1, 2)
                for ox in (-2, -1, 0, 1, 2)
            )
            h = _hash(x, y, 61)
            if not near_road and h < 0.06:
                p.set(x, y, Tile.TREE)
            elif h > 0.95:
                p.set(x, y, Tile.FLOWERS)

    objects: list[MapObject] = []

    def add(obj: MapObject) -> None:
        for ty in range(obj.y - 1, obj.y + obj.h + 1):
            for tx in range(obj.x - 1, obj.x + obj.w + 1):
                t = p.get(tx, ty)
                if t in (Tile.TREE, Tile.WATER, Tile.ROCK, Tile.WALL, Tile.RUIN):
                    inside = obj.x <= tx < obj.x + obj.w and obj.y <= ty < obj.y + obj.h
                    if inside or t == Tile.TREE:
                        p.set(tx, ty, Tile.FOREST_FLOOR if t == Tile.TREE else Tile.GRASS)
        objects.append(obj)

    add(MapObject("watchtower", "watchtower", 46, 7, 2, 2, interactable=True, props={"label": "Watchtower"}))
    add(MapObject("bell", "bell", 44, 42, 2, 1, interactable=True, props={"label": "Council Bell"}))
    add(MapObject("well", "well", 40, 46, 2, 1, props={"label": "Village Well"}))
    add(MapObject("shrine", "shrine", 74, 38, 2, 2, interactable=True, props={"label": "Aurora Shrine"}))
    add(MapObject("mine_entrance", "mine_entrance", 66, 5, 3, 1, props={"label": "Ice Caves"}))
    for i, (hx, hy) in enumerate(((33, 37), (33, 45), (38, 34), (48, 34), (53, 37), (53, 45), (38, 49), (48, 49))):
        add(MapObject(f"house_{i}", "house", hx, hy, 3, 2, props={"variant": i % 3}))
    for bid, (bx, by, label) in BEACONS.items():
        add(MapObject(bid, "beacon", bx, by, interactable=True, props={"label": label}))
    for i, (nx, ny) in enumerate(WOOD):
        add(
            MapObject(
                f"wood_{i}", "resource_node", nx, ny, interactable=True,
                props={"resource": "wood", "charges": 3, "regen_seconds": 12},
            )
        )  # fmt: skip
    for i, (nx, ny) in enumerate(STONE):
        add(
            MapObject(
                f"stone_{i}", "resource_node", nx, ny, interactable=True,
                props={"resource": "stone", "charges": 3, "regen_seconds": 12},
            )
        )  # fmt: skip

    spawns = [
        (41.5, 40.5), (48.5, 40.5), (41.5, 44.5), (48.5, 44.5), (44.5, 39.5),
        (44.5, 45.5), (39.5, 42.5), (50.5, 42.5), (42.5, 42.5), (47.5, 42.5),
    ]  # fmt: skip
    regions = [
        Region("Village Square", 37, 37, 16, 12),
        Region("Watchtower Pass", 40, 3, 10, 10),
        Region("North Cape", 30, 0, 26, 8),
        Region("Ice Caves", 56, 3, 24, 17),
        Region("Frozen Lake", 12, 18, 20, 16),
        Region("Frost Keep", 2, 17, 13, 15),
        Region("Pinewood", 5, 36, 32, 24),
        Region("Aurora Shrine", 66, 31, 16, 14),
        Region("Harbor", 52, 50, 14, 14),
        Region("Village", 30, 30, 30, 22),
        Region("Mountain Spine", 12, 6, 70, 13),
        Region("Western Shore", 0, 30, 30, 34),
        Region("Eastern Shore", 56, 20, 32, 44),
        Region("Southern Fields", 30, 50, 30, 14),
        Region("Northern Wastes", 0, 0, 88, 20),
        Region("Central Snowfield", 30, 18, 30, 14),
    ]
    tiles = [int(p.t[y][x]) for y in range(H) for x in range(W)]
    return GameMap(MAP_ID, "Frostpeak Isle", W, H, tiles, objects, spawns, regions, theme="winter")
