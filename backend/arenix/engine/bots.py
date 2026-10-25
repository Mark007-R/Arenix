"""Rule-based contestant controller (the deterministic fallback policy).

This is ordinary game AI: it picks a goal from its authorised Observation, plans a route with
A*, and steers along it with the same physics as human players. In Milestone 4 an LLM-backed
strategic layer will choose goals (alliances, negotiation, voting); navigation and
moment-to-moment actions stay here, and this policy remains the fallback whenever the model
is slow, unavailable or returns an invalid decision.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import TYPE_CHECKING

from . import physics
from .map import GameMap
from .pathfinding import path_into_range

if TYPE_CHECKING:
    from .match import Observation

WAYPOINT_TOLERANCE = 0.12
STUCK_TICKS = 30
MAX_DECISION_LOG = 50
# Duplicated from match.py to avoid an import cycle; asserted equal in tests.
INTERACT_RANGE = 1.3
GATHER_PAUSE_TICKS = 9


@dataclass(frozen=True)
class BotIntent:
    dx: float = 0.0
    dy: float = 0.0
    interact_target: str | None = None


@dataclass(frozen=True)
class Goal:
    kind: str  # gather | deliver
    target_id: str


class BotBrain:
    def __init__(self, cid: str, game_map: GameMap, rng: random.Random) -> None:
        self.cid = cid
        self.map = game_map
        self.rng = rng
        # Personality: small seeded differences so bots don't move as one blob.
        self.preferred = rng.choice(("wood", "stone"))
        self.reaction = (rng.randint(4, 8), rng.randint(10, 22))
        self.goal: Goal | None = None
        self.path: list[tuple[int, int]] = []
        self.path_index = 0
        self.wait_until = rng.randint(5, 25)
        self.last_pos: tuple[float, float] = (0.0, 0.0)
        self.last_progress_tick = 0
        self.awaiting_result = False
        # Structured decision summaries (not free-form reasoning) for the future Agent Lab.
        self.decisions: list[dict[str, object]] = []

    # ------------------------------------------------------------- decisions
    def _record(self, obs: Observation, summary: str, goal: Goal | None) -> None:
        self.decisions.append(
            {
                "tick": obs.tick,
                "summary": summary,
                "goal": None if goal is None else {"kind": goal.kind, "target": goal.target_id},
            }
        )
        del self.decisions[:-MAX_DECISION_LOG]

    def choose_goal(self, obs: Observation) -> Goal | None:
        if obs.mission_status != "active":
            return None
        remaining = obs.mission_remaining
        carrying = obs.carrying
        useful = sum(min(carrying.get(r, 0), n) for r, n in remaining.items())
        total = sum(carrying.values())
        still_needed = sum(remaining.values()) - useful

        if total >= obs.carry_capacity or (useful > 0 and still_needed == 0):
            return Goal("deliver", obs.mission_target)

        wanted = {r: n - carrying.get(r, 0) for r, n in remaining.items() if n - carrying.get(r, 0) > 0}
        options: list[tuple[float, str]] = []
        for node_id, charges in obs.node_charges.items():
            obj = self.map.objects_by_id[node_id]
            resource = str(obj.props["resource"])
            if charges <= 0 or resource not in wanted:
                continue
            dist = obj.distance_to(obs.x, obs.y)
            weight = 0.75 if resource == self.preferred else 1.0
            options.append((dist * weight + self.rng.random() * 3.0, node_id))
        if options:
            return Goal("gather", min(options)[1])
        if useful > 0:
            return Goal("deliver", obs.mission_target)
        return None

    # ------------------------------------------------------------- navigation
    def _plan(self, obs: Observation) -> bool:
        assert self.goal is not None
        start = (math.floor(obs.x), math.floor(obs.y))
        path = path_into_range(self.map, start, self.goal.target_id, INTERACT_RANGE)
        if path is None:
            return False
        self.path = path
        self.path_index = 0
        self.last_progress_tick = obs.tick
        self.last_pos = (obs.x, obs.y)
        return True

    def _rest(self, obs: Observation, long: bool = False) -> None:
        lo, hi = self.reaction
        self.wait_until = obs.tick + (self.rng.randint(hi, hi * 2) if long else self.rng.randint(lo, hi))

    def update(self, obs: Observation) -> BotIntent:
        if not obs.match_running or obs.tick < self.wait_until or self.awaiting_result:
            return BotIntent()

        if self.goal is not None and self.goal.kind == "gather" and obs.node_charges.get(self.goal.target_id, 0) <= 0:
            self._record(obs, f"{self.goal.target_id} was depleted before arrival; re-planning", None)
            self.goal = None

        if self.goal is None:
            goal = self.choose_goal(obs)
            if goal is None:
                self._rest(obs, long=True)
                return BotIntent()
            self.goal = goal
            if not self._plan(obs):
                self._record(obs, f"no route to {goal.target_id}", None)
                self.goal = None
                self._rest(obs, long=True)
                return BotIntent()
            self._record(obs, f"{goal.kind} at {goal.target_id}", goal)

        target = self.map.objects_by_id[self.goal.target_id]
        if target.distance_to(obs.x, obs.y) <= INTERACT_RANGE - 0.05 and self.path_index >= len(self.path) - 1:
            self.awaiting_result = True
            return BotIntent(interact_target=self.goal.target_id)

        # Stuck detection: if we haven't moved for a while, re-plan from where we are.
        if abs(obs.x - self.last_pos[0]) + abs(obs.y - self.last_pos[1]) > 0.05:
            self.last_pos = (obs.x, obs.y)
            self.last_progress_tick = obs.tick
        elif obs.tick - self.last_progress_tick > STUCK_TICKS:
            if not self._plan(obs):
                self.goal = None
            return BotIntent()

        while self.path_index < len(self.path):
            tx, ty = self.path[self.path_index]
            wx, wy = tx + 0.5, ty + 0.5
            ddx, ddy = wx - obs.x, wy - obs.y
            dist = math.sqrt(ddx * ddx + ddy * ddy)
            if dist <= WAYPOINT_TOLERANCE:
                self.path_index += 1
                continue
            step_len = physics.SPEED * physics.DT
            scale = 1.0 / dist if dist > step_len else 1.0 / step_len
            return BotIntent(ddx * scale, ddy * scale)

        # Path exhausted but not in range (target moved out of reach): re-plan.
        if not self._plan(obs):
            self.goal = None
        return BotIntent()

    def on_interact_result(self, ok: bool, reason: str, tick: int) -> None:
        self.awaiting_result = False
        goal = self.goal
        self.goal = None
        self.path = []
        lo, hi = self.reaction
        if ok and goal is not None and goal.kind == "gather":
            # Brief pause matching the server's interaction cooldown, then gather again.
            self.wait_until = tick + GATHER_PAUSE_TICKS + self.rng.randint(0, lo)
        else:
            self.wait_until = tick + self.rng.randint(lo, hi)
