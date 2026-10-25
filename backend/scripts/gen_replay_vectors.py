"""Golden replay checkpoints for the TypeScript reducer (frontend/src/lib/replay.ts).

Run from backend/:  uv run python scripts/gen_replay_vectors.py
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from arenix.engine.maps import get_map
from arenix.engine.match import Match
from arenix.engine.replay import replay

OUT = Path(__file__).resolve().parents[2] / "shared" / "test-vectors" / "replay.json"


def _match_vectors(mode: str, map_id: str, seed: int, n: int) -> dict[str, Any]:
    m = Match("vectors", get_map(map_id), seed, time_limit_seconds=200, mode=mode)
    for i in range(n):
        m.add_contestant(f"b{i}", f"Bot{i}", "rogue", is_bot=True)
    m.start()
    while m.status == "running":
        m.step()
    events = [e.to_dict() for e in m.events]
    total = len(events)
    checkpoints = sorted({max(1, total * k // 10) for k in range(1, 11)} | {total})
    expected = []
    for seq in checkpoints:
        st = replay(m.events, upto_seq=seq).to_dict()
        expected.append({"seq": seq, "state": st})
    return {"mode": mode, "events": events, "checkpoints": expected}


def build() -> dict[str, Any]:
    return {
        "matches": [
            _match_vectors("classic", "emerald_isle", 17, 5),
            _match_vectors("impostor", "moonfall_isle", 4, 7),
        ]
    }


def render() -> str:
    return json.dumps(build(), separators=(",", ":"), sort_keys=True) + "\n"


if __name__ == "__main__":
    OUT.write_text(render())
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")
