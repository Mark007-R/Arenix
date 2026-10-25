"""Deterministic movement and tile collision.

Positions are in tile units (one tile = 1.0). A contestant is an axis-aligned "feet box"
centred on (x, y). The client runs an exact port of this module (frontend/src/shared/physics.ts)
for prediction; shared/test-vectors/movement.json keeps the two implementations in lockstep.
Only + - * / sqrt and floor are used so both languages produce identical IEEE-754 results.
"""

from __future__ import annotations

import math
from collections.abc import Callable

TICK_RATE = 20
DT = 1.0 / TICK_RATE
SPEED = 4.5  # tiles per second
HALF_W = 0.3
HALF_H = 0.2
EPS = 1e-4

SolidFn = Callable[[int, int], bool]


def _box_hits(solid: SolidFn, left: float, top: float, right: float, bottom: float) -> bool:
    tx0 = math.floor(left)
    tx1 = math.floor(right)
    ty0 = math.floor(top)
    ty1 = math.floor(bottom)
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            if solid(tx, ty):
                return True
    return False


def box_blocked(solid: SolidFn, x: float, y: float) -> bool:
    return _box_hits(solid, x - HALF_W, y - HALF_H, x + HALF_W, y + HALF_H)


def normalize_input(dx: float, dy: float) -> tuple[float, float]:
    length = math.sqrt(dx * dx + dy * dy)
    if length > 1.0:
        return dx / length, dy / length
    return dx, dy


def step(solid: SolidFn, x: float, y: float, dx: float, dy: float) -> tuple[float, float]:
    """Advance one fixed tick. Movement is resolved per axis so contestants slide along walls."""
    dx, dy = normalize_input(dx, dy)
    mx = dx * SPEED * DT
    my = dy * SPEED * DT

    if mx != 0.0:
        nx = x + mx
        if _box_hits(solid, nx - HALF_W, y - HALF_H, nx + HALF_W, y + HALF_H):
            nx = math.floor(nx + HALF_W) - HALF_W - EPS if mx > 0 else math.floor(nx - HALF_W) + 1 + HALF_W + EPS
            if _box_hits(solid, nx - HALF_W, y - HALF_H, nx + HALF_W, y + HALF_H):
                nx = x
        x = nx

    if my != 0.0:
        ny = y + my
        if _box_hits(solid, x - HALF_W, ny - HALF_H, x + HALF_W, ny + HALF_H):
            ny = math.floor(ny + HALF_H) - HALF_H - EPS if my > 0 else math.floor(ny - HALF_H) + 1 + HALF_H + EPS
            if _box_hits(solid, x - HALF_W, ny - HALF_H, x + HALF_W, ny + HALF_H):
                ny = y
        y = ny

    return x, y
