"""Emerald Isle — the first ARENIX map.

Painted procedurally but deterministically (no randomness at runtime): an island with a
central village plaza, a north-western forest, a river with two bridges, a mine in the
north-east, a walled castle arena in the south-east and shrine ruins in the south-west.
"""

from __future__ import annotations

import math

from ..map import GameMap, MapObject, Region
from ..tiles import Tile

MAP_ID = "emerald_isle"
W, H = 64, 48


def _hash(x: int, y: int, salt: int) -> float:
    n = (x * 374761393 + y * 668265263 + salt * 1442695041) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    n ^= n >> 16
    return (n & 0xFFFFFF) / float(0x1000000)


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

    def circle(self, cx: int, cy: int, r: float, tile: Tile, protect: bool = False) -> None:
        for yy in range(int(cy - r) - 1, int(cy + r) + 2):
            for xx in range(int(cx - r) - 1, int(cx + r) + 2):
                if (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r:
                    self.set(xx, yy, tile, protect)

    def path(self, points: list[tuple[int, int]], width: int = 2, tile: Tile = Tile.PATH) -> None:
        """Axis-aligned polyline of the given width. Water becomes bridge."""
        for (x0, y0), (x1, y1) in zip(points, points[1:], strict=False):
            xs = range(min(x0, x1), max(x0, x1) + 1)
            ys = range(min(y0, y1), max(y0, y1) + 1)
            for yy in ys:
                for xx in xs:
                    for oy in range(width):
                        for ox in range(width):
                            px, py = xx + ox, yy + oy
                            if not (0 <= px < W and 0 <= py < H):
                                continue
                            if self.t[py][px] == Tile.WATER:
                                self.set(px, py, Tile.BRIDGE, True)
                            elif self.t[py][px] not in (Tile.BRIDGE, Tile.FLOOR):
                                self.set(px, py, tile, True)


def build() -> GameMap:
    p = _Painter()

    # --- Island silhouette with a sandy beach -------------------------------------------
    cx, cy, rx, ry = 31.5, 23.5, 30.0, 22.0
    for y in range(H):
        for x in range(W):
            d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
            d += (_hash(x // 3, y // 3, 7) - 0.5) * 0.12
            if d < 0.84:
                p.set(x, y, Tile.GRASS)
            elif d < 1.0:
                p.set(x, y, Tile.SAND)

    # --- River running north to south, splitting west from east --------------------------
    for y in range(H):
        rxc = 38 + round(2 * math.sin(y / 6.0))
        for x in (rxc, rxc + 1):
            p.set(x, y, Tile.WATER)

    # --- North-western forest -------------------------------------------------------------
    for y in range(3, 19):
        for x in range(3, 21):
            if p.get(x, y) in (Tile.GRASS, Tile.SAND):
                p.set(x, y, Tile.TREE if _hash(x, y, 11) < 0.55 else Tile.FOREST_FLOOR)
    for fx, fy, fr in ((9, 8, 2.6), (15, 6, 2.2), (11, 13, 2.4), (17, 12, 2.0), (6, 15, 2.0)):
        p.circle(fx, fy, fr, Tile.FOREST_FLOOR)
    ff = Tile.FOREST_FLOOR
    p.path([(12, 16), (12, 13), (17, 13), (17, 12)], width=1, tile=ff)  # forest trails
    p.path([(11, 13), (9, 13), (9, 8), (15, 8), (15, 6)], width=1, tile=ff)
    p.path([(9, 13), (6, 13), (6, 16), (4, 16)], width=1, tile=ff)

    # --- South-western shrine ruins ------------------------------------------------------
    for y in range(30, 44):
        for x in range(3, 18):
            if p.get(x, y) == Tile.GRASS and _hash(x, y, 13) < 0.45:
                p.set(x, y, Tile.TREE)
    p.circle(10, 37, 4.2, Tile.GRASS)
    p.rect(7, 34, 7, 6, Tile.FLOOR, protect=True)
    for rxp, ryp in ((7, 34), (13, 34), (7, 39), (13, 39)):
        p.set(rxp, ryp, Tile.RUIN, protect=True)

    # --- Secluded clearing reached by a hidden 1-tile path --------------------------------
    p.circle(5, 25, 1.8, Tile.FLOWERS, protect=True)

    # --- North-eastern mine ---------------------------------------------------------------
    p.rect(44, 3, 15, 14, Tile.ROCK)
    p.rect(45, 5, 13, 11, Tile.DIRT, protect=True)
    p.rect(44, 13, 1, 3, Tile.DIRT, protect=True)  # west opening

    # --- South-eastern castle arena -------------------------------------------------------
    p.rect(45, 29, 14, 13, Tile.WALL, protect=True)
    p.rect(46, 30, 12, 11, Tile.FLOOR, protect=True)
    p.rect(45, 34, 1, 3, Tile.FLOOR, protect=True)  # west gate

    # --- Village plaza ----------------------------------------------------------------------
    p.rect(21, 20, 10, 8, Tile.PATH, protect=True)

    # --- Roads ---------------------------------------------------------------------------
    p.path([(25, 20), (25, 14), (42, 14), (42, 13), (44, 13)])  # north road over bridge 1 to mine
    p.path([(25, 26), (25, 31), (43, 31), (43, 34), (45, 34)])  # south road over bridge 2 to castle
    p.path([(21, 23), (12, 23), (12, 16)])  # west road into the forest
    p.path([(12, 23), (12, 33)])  # road to the shrine
    p.path([(31, 13), (31, 11)], width=1)  # spur to the watchtower
    p.path([(4, 16), (4, 25)], width=1, tile=Tile.FOREST_FLOOR)  # hidden trail to clearing
    p.path([(5, 25), (11, 25)], width=1, tile=Tile.FOREST_FLOOR)

    # --- Decoration: scattered trees and flowers on open grass -----------------------------
    for y in range(H):
        for x in range(W):
            if p.get(x, y) != Tile.GRASS or p.protected[y][x]:
                continue
            near_road = any(
                0 <= x + ox < W and 0 <= y + oy < H and p.protected[y + oy][x + ox]
                for oy in (-2, -1, 0, 1, 2)
                for ox in (-2, -1, 0, 1, 2)
            )
            h = _hash(x, y, 17)
            if not near_road and h < 0.06:
                p.set(x, y, Tile.TREE)
            elif h > 0.93:
                p.set(x, y, Tile.FLOWERS)

    objects: list[MapObject] = []

    def add(obj: MapObject) -> None:
        # Guarantee every object sits on open ground with a walkable ring around it.
        for ty in range(obj.y - 1, obj.y + obj.h + 1):
            for tx in range(obj.x - 1, obj.x + obj.w + 1):
                if p.get(tx, ty) in (Tile.TREE, Tile.WATER, Tile.ROCK, Tile.WALL, Tile.RUIN):
                    inside = obj.x <= tx < obj.x + obj.w and obj.y <= ty < obj.y + obj.h
                    if inside or p.get(tx, ty) == Tile.TREE:
                        p.set(tx, ty, Tile.FOREST_FLOOR if p.get(tx, ty) == Tile.TREE else Tile.GRASS)
        objects.append(obj)

    # Landmarks
    add(
        MapObject(
            "watchtower",
            "watchtower",
            30,
            9,
            2,
            2,
            interactable=True,
            props={"label": "Watchtower", "region": "Watchtower"},
        )
    )
    add(MapObject("well", "well", 25, 23, 2, 1, props={"label": "Village Well"}))
    add(MapObject("shrine", "shrine", 10, 36, 2, 2, props={"label": "Ancient Shrine"}))
    add(MapObject("mine_entrance", "mine_entrance", 50, 4, 3, 1, props={"label": "Mine Entrance"}))
    add(MapObject("bell", "bell", 51, 31, 2, 1, props={"label": "Council Bell"}))
    for i, (hx, hy) in enumerate(((17, 19), (17, 25), (22, 16), (28, 16), (32, 22), (21, 29), (28, 29))):
        add(MapObject(f"house_{i}", "house", hx, hy, 3, 2, props={"variant": i % 3}))

    # Resource nodes
    wood = [(9, 8), (15, 6), (11, 13), (17, 12), (6, 15), (15, 33)]
    stone = [(47, 7), (51, 8), (55, 7), (48, 11), (54, 12)]
    for i, (nx, ny) in enumerate(wood):
        add(
            MapObject(
                f"wood_{i}",
                "resource_node",
                nx,
                ny,
                interactable=True,
                props={"resource": "wood", "charges": 3, "regen_seconds": 12},
            )
        )
    for i, (nx, ny) in enumerate(stone):
        add(
            MapObject(
                f"stone_{i}",
                "resource_node",
                nx,
                ny,
                interactable=True,
                props={"resource": "stone", "charges": 3, "regen_seconds": 12},
            )
        )

    spawns = [
        (22.5, 21.5),
        (29.5, 21.5),
        (22.5, 26.5),
        (29.5, 26.5),
        (24.5, 21.5),
        (27.5, 26.5),
        (23.5, 24.5),
        (28.5, 24.5),
        (21.5, 23.5),
        (30.5, 23.5),
    ]
    regions = [
        Region("Village Plaza", 20, 19, 12, 10),
        Region("Village", 15, 15, 21, 18),
        Region("Whispering Forest", 3, 3, 18, 16),
        Region("Watchtower", 28, 7, 6, 6),
        Region("Old Mine", 44, 3, 15, 14),
        Region("Castle Arena", 45, 29, 14, 13),
        Region("Shrine Ruins", 5, 32, 11, 10),
        Region("Hidden Glade", 2, 22, 7, 6),
    ]

    tiles = [int(p.t[y][x]) for y in range(H) for x in range(W)]
    return GameMap(MAP_ID, "Emerald Isle", W, H, tiles, objects, spawns, regions)
