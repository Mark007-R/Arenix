"""Moonfall Isle — the large impostor-mode map (96x72, about 2.25x Emerald Isle).

Painted procedurally but deterministically. A squarish island with a central village plaza
(Council Bell), a north-western forest and Moon Lake, the Watchtower in the north, a river
splitting the east, a walled mine, a misty marsh, Lighthouse Point, a castle arena, a quarry,
fishing docks, an apple orchard, shrine ruins and a hidden glade. Five beacons are spread to
the far corners so tasks pull islanders apart — which is when impostors strike.
"""

from __future__ import annotations

import math

from ..map import GameMap, MapObject, Region
from ..tiles import Tile
from .emerald_isle import _hash

MAP_ID = "moonfall_isle"
W, H = 96, 72


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
        """Axis-aligned polyline of the given width. Water becomes bridge."""
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


WOOD = [(14, 10), (20, 7), (26, 9), (12, 16), (18, 14), (25, 15), (30, 21), (10, 22), (24, 44), (30, 47), (26, 50)]
STONE = [(72, 9), (78, 11), (85, 9), (74, 16), (82, 17), (87, 14), (79, 21), (53, 53), (56, 56)]
BEACONS = {
    "beacon_glade": (7, 36, "Glade Beacon"),
    "beacon_marsh": (73, 30, "Marsh Beacon"),
    "beacon_lighthouse": (90, 35, "Lighthouse Beacon"),
    "beacon_docks": (45, 67, "Docks Beacon"),
    "beacon_castle": (84, 52, "Castle Beacon"),
}


def build() -> GameMap:
    p = _Painter()

    # --- Squarish island (superellipse) with a sandy beach -------------------------------
    cx, cy, rx, ry = 47.5, 35.5, 45.0, 33.0
    for y in range(H):
        for x in range(W):
            d = ((x - cx) / rx) ** 4 + ((y - cy) / ry) ** 4
            d += (_hash(x // 3, y // 3, 23) - 0.5) * 0.12
            if d < 0.84:
                p.set(x, y, Tile.GRASS)
            elif d < 1.0:
                p.set(x, y, Tile.SAND)

    # --- River through the east, north to south ------------------------------------------
    for y in range(H):
        rxc = 60 + round(2 * math.sin(y / 7.0))
        for x in (rxc, rxc + 1):
            p.set(x, y, Tile.WATER)

    # --- Whispering Forest (north-west) and Moon Lake --------------------------------------
    for y in range(4, 28):
        for x in range(5, 35):
            if p.get(x, y) in (Tile.GRASS, Tile.SAND):
                p.set(x, y, Tile.TREE if _hash(x, y, 29) < 0.55 else Tile.FOREST_FLOOR)
    for nx, ny in WOOD[:8]:
        p.circle(nx, ny, 2.3, Tile.FOREST_FLOOR)
    ff = Tile.FOREST_FLOOR
    trails = [
        [(26, 27), (26, 19), (30, 19), (30, 21)],
        [(26, 19), (25, 19), (25, 12), (20, 12), (20, 7)],
        [(25, 12), (26, 12), (26, 9)],
        [(20, 12), (18, 12), (18, 14)],
        [(18, 12), (14, 12), (14, 10)],
        [(14, 12), (12, 12), (12, 16)],
        [(12, 16), (12, 22), (10, 22)],
        [(10, 22), (8, 22), (8, 34), (7, 34)],  # hidden trail to the glade
    ]
    for t in trails:
        p.path(t, width=1, tile=ff)
    p.circle(37, 20, 3.4, Tile.WATER)

    # --- Hidden Glade (west) --------------------------------------------------------------
    p.circle(7, 36, 2.2, Tile.FLOWERS, protect=True)

    # --- Shrine Ruins (south-west) ---------------------------------------------------------
    for y in range(47, 63):
        for x in range(7, 25):
            if p.get(x, y) == Tile.GRASS and _hash(x, y, 31) < 0.45:
                p.set(x, y, Tile.TREE)
    p.circle(14.5, 53.5, 4.6, Tile.GRASS)
    p.rect(11, 50, 8, 7, Tile.FLOOR, protect=True)
    for rxp, ryp in ((11, 50), (18, 50), (11, 56), (18, 56)):
        p.set(rxp, ryp, Tile.RUIN, protect=True)

    # --- Apple Orchard (south-west of the village): tidy rows of trees ----------------------
    for y in range(40, 53):
        for x in range(20, 35):
            if p.get(x, y) == Tile.GRASS and x % 3 == 0 and y % 3 == 1:
                p.set(x, y, Tile.TREE)

    # --- Old Mine (north-east) -------------------------------------------------------------
    p.rect(68, 5, 23, 20, Tile.ROCK)
    p.rect(69, 7, 21, 17, Tile.DIRT, protect=True)

    # --- Misty Marsh (east of the river) -----------------------------------------------------
    for y in range(26, 45):
        for x in range(63, 82):
            if p.get(x, y) not in (Tile.GRASS, Tile.SAND):
                continue
            h = _hash(x, y, 37)
            p.set(x, y, Tile.TREE if h < 0.16 else Tile.FLOWERS if h > 0.8 else Tile.DIRT)

    # --- Lighthouse Point (east coast) -------------------------------------------------------
    p.rect(87, 32, 5, 7, Tile.FLOOR, protect=True)

    # --- Castle Arena (south-east) -----------------------------------------------------------
    p.rect(70, 48, 19, 17, Tile.WALL, protect=True)
    p.rect(71, 49, 17, 15, Tile.FLOOR, protect=True)
    p.rect(70, 54, 1, 3, Tile.FLOOR, protect=True)  # west gate

    # --- Old Quarry (south, west of the river) ---------------------------------------------
    p.rect(50, 49, 9, 10, Tile.ROCK)
    p.rect(51, 50, 7, 8, Tile.DIRT, protect=True)

    # --- Fishing Docks (south coast) ---------------------------------------------------------
    p.rect(43, 63, 6, 7, Tile.BRIDGE, protect=True)

    # --- Village Plaza ------------------------------------------------------------------------
    p.rect(38, 31, 14, 10, Tile.PATH, protect=True)

    # --- Roads ---------------------------------------------------------------------------------
    p.path([(44, 31), (44, 12), (46, 12)])  # north to the Watchtower
    p.path([(38, 35), (26, 35), (26, 27)])  # west into the forest
    p.path([(30, 35), (30, 46), (15, 46), (15, 49)])  # south-west to the shrine
    p.path([(44, 40), (44, 63)])  # south to the docks
    p.path([(44, 46), (54, 46), (54, 49)])  # to the quarry
    p.path([(51, 35), (88, 35)])  # east over the river to Lighthouse Point
    p.path([(66, 35), (66, 19), (69, 19)])  # north to the mine
    p.path([(64, 35), (64, 55), (70, 55)])  # south to the castle gate
    p.path([(73, 35), (73, 32)], width=1, tile=Tile.DIRT)  # marsh spur to its beacon

    # --- Decoration: scattered trees and flowers on open grass ---------------------------------
    for y in range(H):
        for x in range(W):
            if p.get(x, y) != Tile.GRASS or p.protected[y][x]:
                continue
            near_road = any(
                0 <= x + ox < W and 0 <= y + oy < H and p.protected[y + oy][x + ox]
                for oy in (-2, -1, 0, 1, 2)
                for ox in (-2, -1, 0, 1, 2)
            )
            h = _hash(x, y, 41)
            if not near_road and h < 0.05:
                p.set(x, y, Tile.TREE)
            elif h > 0.94:
                p.set(x, y, Tile.FLOWERS)

    objects: list[MapObject] = []

    def add(obj: MapObject) -> None:
        # Every object sits on open ground with a walkable ring around it.
        for ty in range(obj.y - 1, obj.y + obj.h + 1):
            for tx in range(obj.x - 1, obj.x + obj.w + 1):
                t = p.get(tx, ty)
                if t in (Tile.TREE, Tile.WATER, Tile.ROCK, Tile.WALL, Tile.RUIN):
                    inside = obj.x <= tx < obj.x + obj.w and obj.y <= ty < obj.y + obj.h
                    if inside or t == Tile.TREE:
                        p.set(tx, ty, Tile.FOREST_FLOOR if t == Tile.TREE else Tile.GRASS)
        objects.append(obj)

    add(MapObject("watchtower", "watchtower", 46, 9, 2, 2, interactable=True, props={"label": "Watchtower"}))
    add(MapObject("bell", "bell", 44, 35, 2, 1, interactable=True, props={"label": "Council Bell"}))
    add(MapObject("well", "well", 39, 39, 2, 1, props={"label": "Village Well"}))
    add(MapObject("shrine", "shrine", 14, 53, 2, 2, interactable=True, props={"label": "Ancient Shrine"}))
    add(MapObject("mine_entrance", "mine_entrance", 78, 7, 3, 1, props={"label": "Mine Entrance"}))
    houses = ((33, 30), (33, 38), (37, 27), (48, 27), (53, 30), (53, 38), (37, 42), (48, 42))
    for i, (hx, hy) in enumerate(houses):
        add(MapObject(f"house_{i}", "house", hx, hy, 3, 2, props={"variant": i % 3}))
    for bid, (bx, by, label) in BEACONS.items():
        add(MapObject(bid, "beacon", bx, by, interactable=True, props={"label": label}))
    for i, (nx, ny) in enumerate(WOOD):
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
    for i, (nx, ny) in enumerate(STONE):
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
        (41.5, 33.5),
        (48.5, 33.5),
        (41.5, 37.5),
        (48.5, 37.5),
        (44.5, 32.5),
        (44.5, 38.5),
        (39.5, 35.5),
        (50.5, 35.5),
        (42.5, 35.5),
        (47.5, 35.5),
    ]
    regions = [
        Region("Village Plaza", 37, 30, 16, 12),
        Region("Watchtower", 41, 5, 10, 9),
        Region("Moon Lake", 32, 15, 10, 10),
        Region("Whispering Forest", 5, 4, 30, 24),
        Region("Hidden Glade", 3, 32, 8, 9),
        Region("Old Mine", 68, 5, 23, 20),
        Region("Lighthouse Point", 84, 30, 10, 12),
        Region("Misty Marsh", 63, 26, 19, 19),
        Region("Castle Arena", 70, 48, 19, 17),
        Region("Old Quarry", 50, 48, 9, 11),
        Region("Fishing Docks", 39, 60, 12, 11),
        Region("Apple Orchard", 19, 39, 16, 14),
        Region("Shrine Ruins", 7, 47, 18, 16),
        Region("Village", 30, 24, 28, 24),
        # Broad fallbacks so every spot on the island has a name.
        Region("Riverbank", 55, 0, 10, 72),
        Region("Northern Meadows", 30, 0, 38, 24),
        Region("Western Fields", 0, 24, 30, 24),
        Region("Southern Fields", 0, 48, 70, 24),
        Region("Eastern Shore", 65, 24, 31, 48),
        Region("Northern Cliffs", 65, 0, 31, 24),
        Region("Old Woods", 0, 0, 30, 24),
    ]

    tiles = [int(p.t[y][x]) for y in range(H) for x in range(W)]
    return GameMap(MAP_ID, "Moonfall Isle", W, H, tiles, objects, spawns, regions)
