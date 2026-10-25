"""Generate golden movement vectors consumed by the frontend prediction tests.

Run from backend/:  uv run python scripts/gen_movement_vectors.py
The test tests/test_vectors.py fails if the committed file is stale.
"""

from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any

from arenix.engine import physics
from arenix.engine.maps import get_map

OUT = Path(__file__).resolve().parents[2] / "shared" / "test-vectors" / "movement.json"


def build() -> dict[str, Any]:
    game_map = get_map("emerald_isle")
    rng = random.Random(2024)
    directions = [(-1.0, 0.0), (1.0, 0.0), (0.0, -1.0), (0.0, 1.0), (1.0, 1.0), (-1.0, 1.0), (0.0, 0.0),
                  (0.37, -0.81)]
    cases = []
    starts = [*game_map.spawns, (31.5, 12.5), (12.5, 16.5), (45.5, 14.5), (40.5, 31.5)]
    for i, (sx, sy) in enumerate(starts):
        x, y = sx, sy
        inputs = []
        positions = []
        for _ in range(120):
            if rng.random() < 0.15 or not inputs:
                d = rng.choice(directions)
            else:
                d = inputs[-1]
            inputs.append(d)
            x, y = physics.step(game_map.is_solid, x, y, d[0], d[1])
            positions.append([x, y])
        cases.append({"name": f"case_{i}", "start": [sx, sy], "inputs": [list(d) for d in inputs],
                      "positions": positions})
    return {
        "map_id": game_map.id,
        "width": game_map.width,
        "height": game_map.height,
        "collision": game_map.to_dict()["collision"],
        "constants": {"dt": physics.DT, "speed": physics.SPEED, "half_w": physics.HALF_W,
                      "half_h": physics.HALF_H, "eps": physics.EPS},
        "cases": cases,
    }


def render() -> str:
    return json.dumps(build(), separators=(",", ":")) + "\n"


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(render())
    print(f"wrote {OUT}")
