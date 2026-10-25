"""Rule-based contestant controller (the deterministic fallback policy).

Ordinary game AI that decides only from its authorised Observation:
* navigation: A* routes + steering with the same physics as humans;
* missions: gather what the tower still needs, deliver, join shrine rituals;
* social: a small belief model (trust per contestant, updated from observed events) that
  drives alliance offers/answers, votes and reactive quick-chat lines.

Every social act is returned as an action and validated by the Match like a human's. In
Milestone 4 an LLM strategic layer replaces the social choices; this policy remains the fallback
whenever the model is slow, unavailable or invalid.
"""

from __future__ import annotations

import math
import random
from collections import deque
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from . import physics
from .map import GameMap
from .pathfinding import path_into_range

if TYPE_CHECKING:
    from .events import GameEvent
    from .match import Observation

WAYPOINT_TOLERANCE = 0.12
STUCK_TICKS = 30
MAX_DECISION_LOG = 60
# Duplicated from match.py to avoid an import cycle; asserted equal in tests.
INTERACT_RANGE = 1.3
GATHER_PAUSE_TICKS = 9
SHRINE_JOIN_RADIUS = 22.0


@dataclass(frozen=True)
class BotIntent:
    dx: float = 0.0
    dy: float = 0.0
    interact_target: str | None = None
    actions: tuple[tuple[Any, ...], ...] = ()


@dataclass(frozen=True)
class Goal:
    kind: str  # gather | deliver | shrine
    target_id: str


@dataclass
class Personality:
    preferred: str
    reaction: tuple[int, int]
    agreeable: float  # chance to accept / propose alliances
    chatty: float  # chance to react with a quick-chat line
    vindictive: float  # how strongly betrayals lower trust
    decisive: float  # chance to vote instead of skipping when unsure


@dataclass
class Beliefs:
    """Uncertain opinions about other contestants, built only from observed events."""

    trust: dict[str, float] = field(default_factory=dict)
    voted_against_me: set[str] = field(default_factory=set)

    def adjust(self, cid: str, delta: float) -> None:
        self.trust[cid] = max(-1.0, min(1.0, self.trust.get(cid, 0.0) + delta))


class BotBrain:
    def __init__(self, cid: str, game_map: GameMap, rng: random.Random) -> None:
        self.cid = cid
        self.map = game_map
        self.rng = rng
        self.personality = Personality(
            preferred=rng.choice(("wood", "stone")),
            reaction=(rng.randint(8, 14), rng.randint(16, 30)),
            agreeable=rng.uniform(0.3, 0.9),
            chatty=rng.uniform(0.15, 0.5),
            vindictive=rng.uniform(0.3, 0.9),
            decisive=rng.uniform(0.4, 0.9),
        )
        self.preferred = self.personality.preferred
        self.reaction = self.personality.reaction
        self.beliefs = Beliefs()
        self.goal: Goal | None = None
        self.path: list[tuple[int, int]] = []
        self.path_index = 0
        self.wait_until = rng.randint(5, 25)
        self.last_pos: tuple[float, float] = (0.0, 0.0)
        self.last_progress_tick = 0
        self.awaiting_result = False
        self.vote_at: int | None = None
        self.social_at = rng.randint(200, 600)
        self.answer_at: dict[str, int] = {}
        self.pending_chat: list[tuple[int, str]] = []
        # Structured decision summaries (not free-form reasoning) for the future Agent Lab.
        self.decisions: list[dict[str, object]] = []
        # Hooks for an external strategist (the LLM agent layer). The engine never sees an LLM:
        # it only receives the queued actions and validates them like any other.
        self.social_mode = "fallback"  # fallback: own social policy | external: strategist decides
        self.external_actions: deque[tuple[Any, ...]] = deque()
        self.goal_hint: str | None = None  # gather_wood | gather_stone | deliver | shrine | idle
        self.goal_hint_until = 0
        self.shrine_hold_until = 0  # agreed ritual start: wait at the shrine until then

    # ------------------------------------------------------------- bookkeeping
    def _record(self, obs: Observation, summary: str, goal: Goal | None = None, **extra: object) -> None:
        entry: dict[str, object] = {
            "tick": obs.tick,
            "summary": summary,
            "goal": None if goal is None else {"kind": goal.kind, "target": goal.target_id},
        }
        entry.update(extra)
        self.decisions.append(entry)
        del self.decisions[:-MAX_DECISION_LOG]

    def _maybe_say(self, obs: Observation, phrase: str, chance: float | None = None) -> None:
        if self.rng.random() < (self.personality.chatty if chance is None else chance):
            self.pending_chat.append((obs.tick + self.rng.randint(4, 30), phrase))

    def _learn(self, obs: Observation, ev: GameEvent) -> None:
        d = ev.data
        me = self.cid
        if ev.type == "vote_resolved":
            for voter, target in d["votes"].items():
                if target == me and voter != me:
                    self.beliefs.voted_against_me.add(voter)
                    self.beliefs.adjust(voter, -0.5 * (0.5 + self.personality.vindictive))
                elif obs.ally is not None and target == obs.ally:
                    self.beliefs.adjust(voter, -0.25)
            if d.get("eliminated") and d["eliminated"] != me:
                self._maybe_say(obs, "vote_wisely", 0.2)
        elif ev.type == "alliance_broken":
            if d["partner"] == me:
                self.beliefs.adjust(d["by"], -0.8 * (0.5 + self.personality.vindictive))
                self._maybe_say(obs, "promised" if d["reason"] == "betrayal" else "never_friends", 0.7)
            elif d["reason"] == "betrayal":
                self.beliefs.adjust(d["by"], -0.15)  # everyone notices a betrayer
                self._maybe_say(obs, "betrayal", 0.25)
        elif ev.type == "alliance_formed" and me in d["members"]:
            other = next(m for m in d["members"] if m != me)
            self.beliefs.adjust(other, 0.4)
            self._maybe_say(obs, "trust_me", 0.4)
        elif ev.type == "alliance_rejected" and d["proposer"] == me:
            self.beliefs.adjust(d["target"], -0.15)
        elif ev.type == "resources_delivered" and d["contestant"] != me and sum(d["accepted"].values()) > 0:
            self.beliefs.adjust(d["contestant"], 0.03)  # useful teammates earn a little trust
        elif ev.type == "shrine_activated" and me in d["participants"]:
            for p in d["participants"]:
                if p != me:
                    self.beliefs.adjust(p, 0.2)
        elif ev.type == "meeting_called":
            self._maybe_say(obs, "who_trust", 0.25)
        elif ev.type == "shrine_channel" and d["contestant"] != me and d["count"] == 1:
            self._maybe_say(obs, "shrine_help", 0.1)

    # ------------------------------------------------------------- social policy
    def _social(self, obs: Observation) -> list[tuple[Any, ...]]:
        if self.social_mode == "external":
            return self._external_social(obs)
        actions: list[tuple[Any, ...]] = []
        p = self.personality
        others = [o for o in obs.alive_ids if o != self.cid]

        for proposer in obs.incoming_proposals:
            due = self.answer_at.setdefault(proposer, obs.tick + self.rng.randint(*p.reaction) * 2)
            if obs.tick >= due:
                trust = self.beliefs.trust.get(proposer, 0.0)
                accept = obs.ally is None and trust > -0.2 and self.rng.random() < p.agreeable + trust * 0.5
                actions.append(("respond", proposer, accept))
                self._record(
                    obs, f"{'accepted' if accept else 'rejected'} alliance offer from {proposer}", trust=round(trust, 2)
                )
                self.answer_at.pop(proposer, None)

        if obs.phase == "explore" and obs.ally is None and others and obs.tick >= self.social_at:
            self.social_at = obs.tick + self.rng.randint(500, 1100)
            if self.rng.random() < p.agreeable:
                candidates = sorted(others, key=lambda o: (-self.beliefs.trust.get(o, 0.0), self.rng.random()))
                target = candidates[0]
                if self.beliefs.trust.get(target, 0.0) > -0.3:
                    actions.append(("propose", target))
                    self._maybe_say(obs, "alliance", 0.5)
                    self._record(obs, f"proposed an alliance to {target}")

        if obs.ally is not None and self.beliefs.trust.get(obs.ally, 0.0) < -0.4:
            actions.append(("break",))
            self._record(obs, f"broke alliance with {obs.ally} (trust fell)")

        if obs.phase == "vote" and not obs.has_voted:
            if self.vote_at is None:
                self.vote_at = obs.tick + self.rng.randint(40, min(300, max(41, obs.phase_ticks_left - 20)))
            if obs.tick >= self.vote_at:
                actions.append(("vote", self._choose_vote(obs, others)))
                self.vote_at = None
        elif obs.phase != "vote":
            self.vote_at = None

        ready_lines = [c for c in self.pending_chat if c[0] <= obs.tick]
        if ready_lines:
            self.pending_chat = [c for c in self.pending_chat if c[0] > obs.tick]
            actions.append(("chat", ready_lines[0][1]))
        return actions

    def _external_social(self, obs: Observation) -> list[tuple[Any, ...]]:
        """Strategist-driven mode: emit queued actions, but never miss a deadline.

        If the strategist hasn't voted with 3 s left, or leaves an alliance offer unanswered for
        10 s, the deterministic policy answers instead (recorded as a fallback).
        """
        actions = list(self.external_actions)
        self.external_actions.clear()
        others = [o for o in obs.alive_ids if o != self.cid]
        voting = any(a[0] == "vote" for a in actions)
        if obs.phase == "vote" and not obs.has_voted and not voting and obs.phase_ticks_left <= 3 * physics.TICK_RATE:
            actions.append(("vote", self._choose_vote(obs, others)))
            self._record(obs, "fallback vote: strategist missed the deadline", fallback=True)
        answered = {a[1] for a in actions if a[0] == "respond"}
        for proposer in obs.incoming_proposals:
            first_seen = self.answer_at.setdefault(proposer, obs.tick)
            if proposer not in answered and obs.tick - first_seen > 10 * physics.TICK_RATE:
                trust = self.beliefs.trust.get(proposer, 0.0)
                accept = obs.ally is None and trust > 0
                actions.append(("respond", proposer, accept))
                self._record(obs, f"fallback answer to {proposer}: strategist silent", fallback=True)
                self.answer_at.pop(proposer, None)
        return actions

    def _choose_vote(self, obs: Observation, others: list[str]) -> str | None:
        o = obs.objective
        if o is not None and o.kind == "eliminate" and o.target in others:
            self._record(obs, f"voted for {o.target} (secret objective)")
            return o.target
        candidates = [c for c in others if c != obs.ally]
        if not candidates:
            self._record(obs, "skipped vote (no candidates)")
            return None
        worst = min(candidates, key=lambda c: (self.beliefs.trust.get(c, 0.0), self.rng.random()))
        trust = self.beliefs.trust.get(worst, 0.0)
        if trust < -0.2 or self.rng.random() < self.personality.decisive:
            self._record(obs, f"voted for {worst}", trust=round(trust, 2))
            return worst
        self._record(obs, "skipped vote (unsure)")
        return None

    # ------------------------------------------------------------- mission goals
    def choose_goal(self, obs: Observation) -> Goal | None:
        hint = self.goal_hint if obs.tick < self.goal_hint_until else None
        if hint == "shrine" and obs.shrine_status != "activated" and self.cid not in obs.shrine_participants:
            return Goal("shrine", "shrine")
        if hint == "idle":
            return None
        if hint == "deliver" and sum(obs.carrying.values()) > 0:
            return Goal("deliver", obs.mission_target)
        if (
            obs.shrine_status == "channeling"
            and self.cid not in obs.shrine_participants
            and self._can_reach_shrine(obs)
        ):
            return Goal("shrine", "shrine")
        if (
            obs.objective is not None
            and obs.objective.kind == "shrine"
            and obs.shrine_status == "dormant"
            and sum(obs.carrying.values()) == 0
            and self.rng.random() < (0.15 if obs.ally is not None else 0.02)
        ):
            if obs.ally is not None:
                self.pending_chat.append((obs.tick + 2, "shrine_help"))
            return Goal("shrine", "shrine")

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
        preferred = self.preferred
        if obs.objective is not None and obs.objective.kind in ("deliver_wood", "deliver_stone"):
            preferred = obs.objective.kind.removeprefix("deliver_")
        if hint in ("gather_wood", "gather_stone"):
            preferred = hint.removeprefix("gather_")
        options: list[tuple[float, str]] = []
        for node_id, charges in obs.node_charges.items():
            obj = self.map.objects_by_id[node_id]
            resource = str(obj.props["resource"])
            if charges <= 0 or resource not in wanted:
                continue
            dist = obj.distance_to(obs.x, obs.y)
            weight = 0.6 if resource == preferred else 1.0
            options.append((dist * weight + self.rng.random() * 3.0, node_id))
        if options:
            return Goal("gather", min(options)[1])
        if useful > 0:
            return Goal("deliver", obs.mission_target)
        return None

    def _can_reach_shrine(self, obs: Observation) -> bool:
        dist = self.map.objects_by_id["shrine"].distance_to(obs.x, obs.y)
        # Paths wind, so budget 1.5x the straight-line time.
        eta_ticks = dist * 1.5 / physics.SPEED * physics.TICK_RATE
        # Allies answer each other's ritual from anywhere they can reach in time.
        radius = math.inf if obs.ally is not None and obs.ally in obs.shrine_participants else SHRINE_JOIN_RADIUS
        return dist < radius and eta_ticks < obs.shrine_window_left - 10

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
        for ev in obs.new_events:
            self._learn(obs, ev)
        if not obs.match_running or not obs.alive:
            return BotIntent()
        actions = tuple(self._social(obs))
        if obs.phase != "explore":
            self.goal = None
            self.path = []
            self.awaiting_result = False
            return BotIntent(actions=actions)
        move = self._navigate(obs)
        return BotIntent(move.dx, move.dy, move.interact_target, actions)

    def _navigate(self, obs: Observation) -> BotIntent:
        if obs.tick < self.wait_until or self.awaiting_result:
            return BotIntent()

        if self.goal is not None and self.goal.kind == "gather" and obs.node_charges.get(self.goal.target_id, 0) <= 0:
            self._record(obs, f"{self.goal.target_id} was depleted before arrival; re-planning")
            self.goal = None
        if self.goal is not None and self.goal.kind == "shrine" and obs.shrine_status == "activated":
            self.goal = None
        # A ritual just started nearby: drop the current errand and go help (if reachable in time).
        if (
            self.goal is not None
            and self.goal.kind != "shrine"
            and obs.shrine_status == "channeling"
            and self.cid not in obs.shrine_participants
            and self._can_reach_shrine(obs)
        ):
            self._record(obs, "interrupting errand to join the shrine ritual")
            self.goal = None

        if self.goal is None:
            goal = self.choose_goal(obs)
            if goal is None:
                self._rest(obs, long=True)
                return BotIntent()
            self.goal = goal
            if not self._plan(obs):
                self._record(obs, f"no route to {goal.target_id}")
                self.goal = None
                self._rest(obs, long=True)
                return BotIntent()
            self._record(obs, f"{goal.kind} at {goal.target_id}", goal)

        target = self.map.objects_by_id[self.goal.target_id]
        if target.distance_to(obs.x, obs.y) <= INTERACT_RANGE - 0.05 and self.path_index >= len(self.path) - 1:
            if self.goal.kind == "shrine" and obs.shrine_status == "dormant" and obs.tick < self.shrine_hold_until:
                return BotIntent()  # in position; wait for the agreed start so the window isn't wasted
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
        elif ok and goal is not None and goal.kind == "deliver":
            self.wait_until = tick + self.rng.randint(lo, hi)
            if self.rng.random() < self.personality.chatty * 0.4:
                self.pending_chat.append((tick + 5, "mission_complete"))
        else:
            self.wait_until = tick + self.rng.randint(lo, hi)
