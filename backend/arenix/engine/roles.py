"""Impostor mode: hidden roles, per-match skills and their tuning.

Roles are secret. Each contestant learns only their own role (impostors also learn who the other
impostors are). Skills are re-rolled every match, kept private and revealed when the match ends.
All effects are enforced by the Match; the client is only told what it may know.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

from . import physics

ISLANDER = "islander"
IMPOSTOR = "impostor"

KILL_RANGE = 1.5
FIRST_KILL_TICKS = 20 * physics.TICK_RATE  # at least this long before the first kill
KILL_COOLDOWN_AFTER_MEETING_TICKS = 20 * physics.TICK_RATE
WITNESS_RADIUS = 6.0
REPORT_RANGE = 2.0
LOOKOUT_RADIUS = 22.0
SCOUT_VIEW_RADIUS = 20.0
SWIFT_SPEED = 1.25
STRONGBACK_CAPACITY = 5

KILL_POINTS = 30
BEACON_POINTS = 20
VICTORY_BONUS = 100

EXPLORE_SECONDS = 90
DISCUSS_SECONDS = 45
VOTE_SECONDS = 25
REVEAL_SECONDS = 6
MIN_CONTESTANTS = 5


@dataclass(frozen=True)
class Skill:
    id: str
    name: str
    text: str

    def to_dict(self) -> dict[str, str]:
        return {"id": self.id, "name": self.name, "text": self.text}


SKILLS: dict[str, Skill] = {
    s.id: s
    for s in (
        Skill("swift", "Swift", "You move 25% faster than everyone else."),
        Skill("scout", "Scout", "You see much further across the island."),
        Skill("strongback", "Strongback", "You can carry 5 materials instead of 3."),
        Skill("detective", "Detective", "When you report a body, you learn two names — one of them is the killer."),
        Skill("medic", "Medic", "Once per match, shield someone. The shield blocks one attack."),
        Skill("lookout", "Lookout", "You sense when someone is killed nearby, and where."),
    )
}


# Kill cooldown (seconds) per field size, set from all-bot simulations
# (python -m arenix.sim.impostor_balance; results in docs/benchmarks/README.md).
KILL_COOLDOWN_S_BY_FIELD = {5: 38, 6: 20, 7: 80, 8: 46, 9: 28, 10: 24}


def kill_cooldown_ticks(n: int) -> int:
    """Kill cooldown for an n-contestant match.

    Fewer islanders means each kill matters more, so small games wait longer; at 7 players a
    second impostor joins, so the cooldown jumps and then shrinks again as the field grows.
    Sizes outside the table (tests, tiny matches) use a formula with the same shape.
    """
    if n in KILL_COOLDOWN_S_BY_FIELD:
        return KILL_COOLDOWN_S_BY_FIELD[n] * physics.TICK_RATE
    impostors = impostor_count(n)
    crew = max(1, n - impostors)
    seconds = (5 + 100 / crew) * (1.6 if impostors > 1 else 1.0)
    return round(seconds * physics.TICK_RATE)


def impostor_count(n: int) -> int:
    return 2 if n >= 7 else 1


def assign_roles(ids: list[str], rng: random.Random) -> dict[str, str]:
    impostors = set(rng.sample(sorted(ids), impostor_count(len(ids))))
    return {cid: IMPOSTOR if cid in impostors else ISLANDER for cid in ids}


def assign_skills(ids: list[str], rng: random.Random) -> dict[str, Skill]:
    """Every contestant gets a skill; all six appear before any repeats."""
    pool: list[str] = []
    out: dict[str, Skill] = {}
    for cid in sorted(ids):
        if not pool:
            pool = sorted(SKILLS)
            rng.shuffle(pool)
        out[cid] = SKILLS[pool.pop()]
    return out
