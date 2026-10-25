"""Impostor-mode balance: all-bot matches across field sizes (rule-based bots, no LLM).

    uv run python -m arenix.sim.impostor_balance [--sizes 5,6,7,8,9,10] [--seeds 20]

Prints, per field size: how each match ended, the impostor win rate, average length, kills,
meetings, and how often the council ejected an impostor vs an innocent. These are the numbers
the kill-cooldown formula in engine/roles.py was tuned against (docs/benchmarks/README.md).
"""

from __future__ import annotations

import argparse
import statistics
from collections import Counter
from typing import Any

from ..engine import roles
from ..engine.maps import get_map
from ..engine.match import ARCHETYPES, Match

NAMES = ["Brakka", "Lyra", "Fennick", "Morwen", "Tobble", "Sir Aldric", "Quill", "Nessa", "Grub", "Pip"]
TIME_LIMIT_S = 540  # same as rooms


def play(n: int, seed: int) -> Match:
    m = Match(f"balance-{n}-{seed}", get_map("moonfall_isle"), seed, time_limit_seconds=TIME_LIMIT_S, mode="impostor")
    for i in range(n):
        m.add_contestant(f"bot{i + 1}", NAMES[i], ARCHETYPES[i % len(ARCHETYPES)], is_bot=True)
    m.start()
    while m.status == "running":
        m.step()
    return m


def summarize(n: int, seeds: int) -> dict[str, Any]:
    reasons: Counter[str] = Counter()
    lengths, kills, meetings = [], [], []
    caught = wrong = 0
    for seed in range(1, seeds + 1):
        m = play(n, seed)
        assert m.result is not None
        reasons[m.result["reason"]] += 1
        lengths.append(m.tick / 20)
        kills.append(sum(1 for e in m.events if e.type == "contestant_killed"))
        meetings.append(m.meeting_count)
        for e in m.events:
            if e.type == "vote_resolved" and e.data.get("eliminated"):
                caught += bool(e.data["was_impostor"])
                wrong += not e.data["was_impostor"]
    impostor_wins = reasons["impostors_outnumber"] + reasons["time_up"]
    return {
        "contestants": n,
        "impostors": roles.impostor_count(n),
        "kill_cooldown_s": roles.kill_cooldown_ticks(n) / 20,
        "matches": seeds,
        "impostor_win_rate": round(impostor_wins / seeds, 2),
        "endings": dict(reasons),
        "avg_length_s": round(statistics.mean(lengths)),
        "avg_kills": round(statistics.mean(kills), 1),
        "avg_meetings": round(statistics.mean(meetings), 1),
        "ejected_impostors": caught,
        "ejected_innocents": wrong,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sizes", default="5,6,7,8,9,10")
    ap.add_argument("--seeds", type=int, default=20)
    args = ap.parse_args()
    print(
        "| players | impostors | kill cooldown | impostor wins | avg length | kills | meetings "
        "| ejected (impostor / innocent) |"
    )
    print("|---|---|---|---|---|---|---|---|")
    for n in (int(x) for x in args.sizes.split(",")):
        r = summarize(n, args.seeds)
        print(
            f"| {n} | {r['impostors']} | {r['kill_cooldown_s']:.0f} s | {r['impostor_win_rate']:.0%} | "
            f"{r['avg_length_s']} s | {r['avg_kills']} | {r['avg_meetings']} | "
            f"{r['ejected_impostors']} / {r['ejected_innocents']} |"
        )


if __name__ == "__main__":
    main()
