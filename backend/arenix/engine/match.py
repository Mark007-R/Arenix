"""Authoritative match simulation.

The Match owns all game state. Contestants (human or bot) can only *request* things: queue a
movement input, interact with an object, chat, vote, or propose/answer/break an alliance.
Every request is validated against phase, range, cooldown, capacity and authorisation rules
before state changes and a GameEvent is recorded.

Match flow:
  explore (missions, gathering, alliances) → discuss → vote → reveal → explore → …
A council meeting is called on a schedule, when someone rings the Council Bell or (impostor
mode) when someone reports a body. Movement pauses during meetings.

Modes:
* "classic" (Island Council): the match ends when time runs out or two contestants remain;
  the highest-scoring survivor wins.
* "impostor": hidden roles (see roles.py). Impostors secretly kill islanders; islanders win by
  voting out every impostor or by finishing the island's tasks (tower + every beacon);
  impostors win when they are as many as the islanders, or when time runs out.
"""

from __future__ import annotations

import math
import random
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from . import physics
from . import roles as R
from .events import EventLog, GameEvent
from .map import GameMap
from .missions import RepairTowerMission
from .social import (
    ALLIANCE_PROPOSAL_TTL_TICKS,
    CHAT_COOLDOWN_TICKS,
    MAX_MESSAGES_PER_PHASE,
    MAX_NEGOTIATION_ROUNDS,
    MAX_PAYLOAD_CHARS,
    MESSAGE_TTL_TICKS,
    MESSAGE_TYPES,
    NEGOTIATION_TYPES,
    OBJECTIVE_BONUS,
    QUICK_CHAT,
    REPLY_TYPES,
    Alliances,
    Objective,
    Proposal,
    assign_objectives,
    moderate_chat,
    sanitize_chat,
)

RULES_VERSION = "m3.0"
INTERACT_RANGE = 1.3
INTERACT_COOLDOWN_TICKS = 8
CARRY_CAPACITY = 3
MAX_INPUT_QUEUE = 12
INPUT_TOKEN_MAX = 3.0
POINTS_PER_UNIT = 10
MISSION_BONUS = 50
ALLY_DIVIDEND = 3
WOOD_PER_CONTESTANT = 8
STONE_PER_CONTESTANT = 6
IMPOSTOR_WOOD_PER_ISLANDER = 7
IMPOSTOR_STONE_PER_ISLANDER = 6
SURVIVAL_BONUS = 50
SHRINE_BONUS = 40
SHRINE_WINDOW_TICKS = 10 * physics.TICK_RATE
SHRINE_REQUIRED = 3
VIEW_RADIUS = 13.0
DUPLICATE_WINDOW_TICKS = 15 * physics.TICK_RATE  # the same message twice within 15 s is spam
POSITION_SAMPLE_TICKS = 2 * physics.TICK_RATE  # replay-only position log (visible to no player)

EXPLORE_SECONDS = 75
DISCUSS_SECONDS = 15
VOTE_SECONDS = 20
REVEAL_SECONDS = 5
DEFAULT_TIME_LIMIT_SECONDS = 420

PHASES = ("explore", "discuss", "vote", "reveal")
ARCHETYPES = (
    "warrior",
    "archer",
    "wizard",
    "rogue",
    "guardian",
    "knight",
    "trickster",
    "champion",
)


@dataclass
class InputCmd:
    seq: int
    dx: float
    dy: float


@dataclass
class Contestant:
    id: str
    name: str
    archetype: str
    is_bot: bool
    x: float
    y: float
    facing: str = "down"
    moving: bool = False
    carrying: dict[str, int] = field(default_factory=lambda: {"wood": 0, "stone": 0})
    delivered: dict[str, int] = field(default_factory=lambda: {"wood": 0, "stone": 0})
    score: int = 0
    alive: bool = True
    connected: bool = True
    bell_used: bool = False
    objective: Objective | None = None
    # Cosmetic loadout (validated server-side from the player's inventory) and unlocked phrases.
    cosmetics: dict[str, Any] = field(default_factory=dict)
    extra_phrases: dict[str, str] = field(default_factory=dict)
    # Impostor mode. A killed contestant is dead (alive=False) but others only learn it once the
    # body is found or a meeting starts (death_known).
    role: str = R.ISLANDER
    skill: R.Skill | None = None
    death_known: bool = False
    kill_ready_tick: int = 0
    ability_used: bool = False
    bullet_used: bool = False
    shielded_by: str | None = None
    last_interact_tick: int = -10_000
    last_chat_tick: int = -10_000
    last_chat_text: str = ""
    last_ack_seq: int = 0
    last_queued_seq: int = 0
    input_tokens: float = INPUT_TOKEN_MAX
    inputs: deque[InputCmd] = field(default_factory=deque)

    def carry_total(self) -> int:
        return sum(self.carrying.values())

    def public_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "archetype": self.archetype,
            "is_bot": self.is_bot,
            "x": round(self.x, 4),
            "y": round(self.y, 4),
            "facing": self.facing,
            "moving": self.moving,
            "carrying": dict(self.carrying),
            "score": self.score,
            "alive": self.alive,  # only ghosts and the omniscient view are sent dead contestants
            "connected": self.connected,
            "cosmetics": self.cosmetics,
        }

    def roster_dict(self, alive: bool | None = None) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "archetype": self.archetype,
            "is_bot": self.is_bot,
            "score": self.score,
            "alive": self.alive if alive is None else alive,
            "connected": self.connected,
            "cosmetics": self.cosmetics,
        }


@dataclass
class NodeState:
    resource: str
    charges: int
    max_charges: int
    regen_ticks: int
    next_regen_tick: int | None = None


@dataclass
class ShrineState:
    status: str = "dormant"  # dormant | channeling | activated
    participants: list[str] = field(default_factory=list)
    window_end_tick: int = 0
    activated_by: list[str] = field(default_factory=list)


@dataclass
class Body:
    victim: str
    killer: str
    x: float
    y: float
    tick: int

    @property
    def id(self) -> str:
        return f"body_{self.victim}"


@dataclass(frozen=True)
class ActionResult:
    ok: bool
    reason: str = ""
    events: tuple[GameEvent, ...] = ()


InteractResult = ActionResult  # backwards-compatible name


@dataclass(frozen=True)
class Observation:
    """What a contestant is authorised to know. Bots decide from this, never from Match."""

    tick: int
    self_id: str
    x: float
    y: float
    alive: bool
    carrying: dict[str, int]
    carry_capacity: int
    phase: str
    phase_ticks_left: int
    mission_status: str
    mission_remaining: dict[str, int]
    mission_target: str
    node_charges: dict[str, int]
    match_running: bool
    alive_ids: tuple[str, ...]
    ally: str | None
    incoming_proposals: tuple[str, ...]
    has_voted: bool
    objective: Objective | None
    shrine_status: str
    shrine_participants: tuple[str, ...]
    shrine_window_left: int
    visible_positions: dict[str, tuple[float, float]]
    new_events: tuple[GameEvent, ...]
    # Impostor mode (defaults keep classic-mode callers unchanged).
    mode: str = "classic"
    role: str = R.ISLANDER
    fellow_impostors: tuple[str, ...] = ()
    skill: str | None = None
    ability_used: bool = False
    kill_ready: bool = False
    speed: float = 1.0
    visible_bodies: dict[str, tuple[float, float]] = field(default_factory=dict)
    beacons: dict[str, bool] = field(default_factory=dict)
    bullet_used: bool = False
    sabotage_ready: bool = False
    fog: bool = False


class Match:
    def __init__(
        self,
        match_id: str,
        game_map: GameMap,
        seed: int,
        time_limit_seconds: int = DEFAULT_TIME_LIMIT_SECONDS,
        meetings: bool = True,
        mode: str = "classic",
    ) -> None:
        if mode not in ("classic", "impostor"):
            raise ValueError(f"unknown mode {mode}")
        self.id = match_id
        self.mode = mode
        impostor = mode == "impostor"
        self.phase_seconds = {
            "explore": R.EXPLORE_SECONDS if impostor else EXPLORE_SECONDS,
            "discuss": R.DISCUSS_SECONDS if impostor else DISCUSS_SECONDS,
            "vote": R.VOTE_SECONDS if impostor else VOTE_SECONDS,
            "reveal": R.REVEAL_SECONDS if impostor else REVEAL_SECONDS,
        }
        self.map = game_map
        self.seed = seed
        self.rng = random.Random(seed)
        self.tick = 0
        self.time_limit_ticks = time_limit_seconds * physics.TICK_RATE
        self.meetings_enabled = meetings
        self.status = "lobby"  # lobby | running | finished
        self.phase = "explore"
        self.phase_end_tick = 0
        self.meeting_count = 0
        self.votes: dict[str, str] = {}
        self.contestants: dict[str, Contestant] = {}
        self.mission = RepairTowerMission()
        self.shrine = ShrineState()
        self.alliances = Alliances()
        self.events = EventLog()
        self.result: dict[str, Any] | None = None
        self.bodies: dict[str, Body] = {}  # victim id -> body (impostor mode)
        self.kill_cooldown = 0  # ticks, set when roles are assigned
        self.sabotage_ready_tick = R.FIRST_SABOTAGE_TICKS
        self.fog_until = 0
        self.jester_winner: str | None = None
        self.beacons: dict[str, bool] = {o.id: False for o in game_map.objects if o.kind == "beacon"}
        self.nodes: dict[str, NodeState] = {}
        for o in game_map.objects:
            if o.kind == "resource_node":
                charges = int(o.props["charges"])
                self.nodes[o.id] = NodeState(
                    resource=str(o.props["resource"]),
                    charges=charges,
                    max_charges=charges,
                    regen_ticks=int(o.props["regen_seconds"]) * physics.TICK_RATE,
                )
        from .bots import BotBrain  # bots depend on match types; import lazily

        self._bot_cls = BotBrain
        if mode == "impostor":
            from .island_bots import IslandBrain

            self._bot_cls = IslandBrain
        self.bots: dict[str, BotBrain] = {}
        self._bot_cursors: dict[str, int] = {}
        # Structured-message bookkeeping: per (sender, phase id) counts and per-thread rounds.
        self._phase_messages: dict[tuple[str, str], int] = {}
        self._threads: dict[str, dict[str, Any]] = {}
        self._message_counter = 0
        self.max_negotiation_rounds = MAX_NEGOTIATION_ROUNDS  # experiment knob
        # Validation outcome of every bot/agent action: (tick, contestant, action, ok, reason).
        self.action_results: list[tuple[int, str, tuple[Any, ...], bool, str]] = []

    # ------------------------------------------------------------------ setup
    def add_contestant(
        self,
        cid: str,
        name: str,
        archetype: str,
        is_bot: bool,
        cosmetics: dict[str, Any] | None = None,
        phrases: dict[str, str] | None = None,
    ) -> Contestant:
        if cid in self.contestants:
            raise ValueError(f"duplicate contestant {cid}")
        if archetype not in ARCHETYPES:
            raise ValueError(f"unknown archetype {archetype}")
        spawn = self.map.spawns[len(self.contestants) % len(self.map.spawns)]
        c = Contestant(cid, name, archetype, is_bot, spawn[0], spawn[1])
        c.cosmetics = {k: v for k, v in (cosmetics or {}).items() if k in ("skin", "hat", "effect")}
        c.extra_phrases = dict(phrases or {})
        self.contestants[cid] = c
        if is_bot:
            self.bots[cid] = self._bot_cls(cid, self.map, random.Random(f"{self.seed}:{cid}"))
            self._bot_cursors[cid] = 0
        return c

    def names(self) -> dict[str, str]:
        return {c.id: c.name for c in self.contestants.values()}

    def start(self) -> GameEvent:
        if self.status != "lobby":
            raise RuntimeError("match already started")
        n = len(self.contestants)
        if self.mode == "impostor" and n < 3:
            raise ValueError("impostor mode needs at least 3 contestants")
        self.status = "running"
        # Scale the workload with the field so solo practice and 10-player matches both work.
        if self.mode == "impostor":
            crew = n - R.impostor_count(n)
            self.mission.required = {
                "wood": IMPOSTOR_WOOD_PER_ISLANDER * crew + 2,
                "stone": IMPOSTOR_STONE_PER_ISLANDER * crew + 2,
            }
        else:
            self.mission.required = {"wood": WOOD_PER_CONTESTANT * n + 2, "stone": STONE_PER_CONTESTANT * n + 2}
        self._set_phase("explore", self.phase_seconds["explore"])
        ev = self.events.append(
            self.tick,
            "match_started",
            map_id=self.map.id,
            seed=self.seed,
            rules_version=RULES_VERSION,
            mode=self.mode,
            contestants=[c.id for c in self.contestants.values()],
            mission=self.mission.id,
            required=dict(self.mission.required),
            beacons=sorted(self.beacons),
        )
        if self.mode == "impostor":
            self._assign_roles_and_skills()
            names = self.names()
            for brain in self.bots.values():
                brain.names = names
            return ev
        objectives = assign_objectives(sorted(self.contestants), self.rng)
        names = self.names()
        for cid, obj in objectives.items():
            self.contestants[cid].objective = obj
            self.events.append(
                self.tick,
                "objective_assigned",
                visible_to=frozenset({cid}),
                contestant=cid,
                objective=obj.to_dict(names),
            )
        return ev

    def _assign_roles_and_skills(self) -> None:
        ids = sorted(self.contestants)
        self.kill_cooldown = R.kill_cooldown_ticks(len(ids))
        roles = R.assign_roles(ids, self.rng)
        skills = R.assign_skills(ids, self.rng)
        impostors = sorted(cid for cid, r in roles.items() if r == R.IMPOSTOR)
        for cid in ids:
            c = self.contestants[cid]
            c.role, c.skill = roles[cid], skills[cid]
            fellow = [i for i in impostors if i != cid] if c.role == R.IMPOSTOR else []
            self.events.append(
                self.tick, "role_assigned", visible_to=frozenset({cid}), contestant=cid, role=c.role, fellow=fellow
            )
            self.events.append(
                self.tick, "skill_assigned", visible_to=frozenset({cid}), contestant=cid, skill=c.skill.to_dict()
            )
            if c.role == R.IMPOSTOR:
                c.kill_ready_tick = self.tick + max(R.FIRST_KILL_TICKS, self.kill_cooldown)

    # ------------------------------------------------------------------ helpers
    def impostors(self, alive_only: bool = True) -> list[Contestant]:
        return [c for c in self.contestants.values() if c.role == R.IMPOSTOR and (c.alive or not alive_only)]

    def has_skill(self, c: Contestant, skill: str) -> bool:
        return c.skill is not None and c.skill.id == skill

    def capacity(self, c: Contestant) -> int:
        return R.STRONGBACK_CAPACITY if self.has_skill(c, "strongback") else CARRY_CAPACITY

    def speed(self, c: Contestant) -> float:
        return R.SWIFT_SPEED if self.has_skill(c, "swift") else 1.0

    def view_radius(self, c: Contestant) -> float:
        base = R.SCOUT_VIEW_RADIUS if self.has_skill(c, "scout") else VIEW_RADIUS
        if self.fog_active() and c.role != R.IMPOSTOR:
            return min(base, R.FOG_VIEW_RADIUS)
        return base

    def region(self, x: float, y: float) -> str:
        return self.map.region_at(x, y) or "the wilds"

    def _observers(self, c: Contestant) -> frozenset[str] | None:
        """Impostor mode: who sees `c` do something (tasks are only witnessed, never announced)."""
        if self.mode != "impostor":
            return None
        return frozenset({c.id, *(o.id for o in self.contestants.values() if o.alive and self.can_see(o.id, c))})

    def known_alive(self, viewer: str | None, target: Contestant) -> bool:
        """Whether `viewer` believes `target` is alive. Unfound kills are secret to all but
        impostors, ghosts and the victim."""
        if target.alive or target.death_known or viewer is None or viewer == target.id:
            return target.alive
        v = self.contestants.get(viewer)
        return not (v is not None and (v.role == R.IMPOSTOR or not v.alive))

    def _set_phase(self, phase: str, seconds: int) -> None:
        self.phase = phase
        self.phase_end_tick = self.tick + seconds * physics.TICK_RATE

    def _alive(self, cid: str) -> Contestant | None:
        c = self.contestants.get(cid)
        return c if c is not None and c.alive else None

    def _check_actor(self, cid: str, phases: tuple[str, ...] | None = None) -> tuple[Contestant | None, str]:
        c = self.contestants.get(cid)
        if c is None:
            return None, "unknown_contestant"
        if self.status != "running":
            return None, "match_not_running"
        if not c.alive:
            return None, "eliminated"
        if phases is not None and self.phase not in phases:
            return None, "wrong_phase"
        return c, ""

    # ------------------------------------------------------------------ movement
    def queue_input(self, cid: str, seq: int, dx: float, dy: float) -> bool:
        c = self.contestants.get(cid)
        if c is None or c.is_bot or self.status != "running":
            return False
        if not (math.isfinite(dx) and math.isfinite(dy)) or seq <= c.last_queued_seq:
            return False
        dx = max(-1.0, min(1.0, dx))
        dy = max(-1.0, min(1.0, dy))
        c.last_queued_seq = seq
        c.inputs.append(InputCmd(seq, dx, dy))
        while len(c.inputs) > MAX_INPUT_QUEUE:
            dropped = c.inputs.popleft()
            c.last_ack_seq = dropped.seq
        return True

    def _move(self, c: Contestant, dx: float, dy: float) -> None:
        nx, ny = physics.step(self.map.is_solid, c.x, c.y, dx, dy, self.speed(c))
        c.moving = nx != c.x or ny != c.y
        if dx != 0.0 or dy != 0.0:
            if abs(dx) >= abs(dy):
                c.facing = "right" if dx > 0 else "left"
            else:
                c.facing = "down" if dy > 0 else "up"
        c.x, c.y = nx, ny

    # ------------------------------------------------------------------ interactions
    def interact(self, cid: str, target_id: str) -> ActionResult:
        c, reason = self._check_actor(cid)
        if c is None:
            return ActionResult(False, reason)
        if self.phase != "explore":
            return ActionResult(False, "meeting_in_progress")
        if self.tick - c.last_interact_tick < INTERACT_COOLDOWN_TICKS:
            return ActionResult(False, "cooldown")
        if target_id.startswith("body_"):
            return self._report_body(c, target_id.removeprefix("body_"))
        obj = self.map.objects_by_id.get(target_id)
        if obj is None or not obj.interactable:
            return ActionResult(False, "not_interactable")
        if obj.distance_to(c.x, c.y) > INTERACT_RANGE:
            return ActionResult(False, "out_of_range")

        if obj.kind == "resource_node":
            node = self.nodes[obj.id]
            if node.charges <= 0:
                return ActionResult(False, "depleted")
            if c.carry_total() >= self.capacity(c):
                return ActionResult(False, "inventory_full")
            node.charges -= 1
            if node.next_regen_tick is None:
                node.next_regen_tick = self.tick + node.regen_ticks
            c.carrying[node.resource] += 1
            c.last_interact_tick = self.tick
            ev = self.events.append(
                self.tick,
                "resource_gathered",
                visible_to=self._observers(c),
                contestant=cid,
                node=obj.id,
                resource=node.resource,
                charges_left=node.charges,
                carrying=dict(c.carrying),
            )
            return ActionResult(True, events=(ev,))

        if obj.id == self.mission.target_id:
            return self._deliver(c)
        if obj.kind == "shrine":
            return self._channel_shrine(c)
        if obj.kind == "beacon":
            return self._light_beacon(c, obj.id)
        if obj.kind == "bell":
            if c.bell_used:
                return ActionResult(False, "bell_used")
            if not self.meetings_enabled:
                return ActionResult(False, "not_interactable")
            c.bell_used = True
            c.last_interact_tick = self.tick
            return ActionResult(True, events=tuple(self._start_meeting("bell", cid)))
        return ActionResult(False, "not_interactable")

    def _deliver(self, c: Contestant) -> ActionResult:
        if self.mission.status != "active":
            return ActionResult(False, "mission_closed")
        if c.carry_total() == 0:
            return ActionResult(False, "nothing_to_deliver")
        if c.role in R.FAKERS:
            # Impostors (and the jester) can only pretend: the cargo vanishes, the tower doesn't change.
            c.carrying = {r: 0 for r in c.carrying}
            c.last_interact_tick = self.tick
            ev = self.events.append(self.tick, "delivery_faked", visible_to=frozenset({c.id}), contestant=c.id)
            return ActionResult(True, events=(ev,))
        accepted = self.mission.accept(c.id, c.carrying)
        surplus = {r: n - accepted.get(r, 0) for r, n in c.carrying.items() if n - accepted.get(r, 0)}
        c.carrying = {r: 0 for r in c.carrying}
        for r, n in accepted.items():
            c.delivered[r] += n
        units = sum(accepted.values())
        c.score += units * POINTS_PER_UNIT
        c.last_interact_tick = self.tick
        events = [
            self.events.append(
                self.tick,
                "resources_delivered",
                visible_to=self._observers(c),
                contestant=c.id,
                accepted=accepted,
                surplus=surplus,
                points=units * POINTS_PER_UNIT,
                delivered=dict(self.mission.delivered),
            )
        ]
        ally = self._alive(self.alliances.ally_of(c.id) or "")
        if ally is not None and units:
            # Cooperation dividend, private to the pair.
            ally.score += units * ALLY_DIVIDEND
            events.append(
                self.events.append(
                    self.tick,
                    "ally_dividend",
                    visible_to=frozenset({c.id, ally.id}),
                    contestant=ally.id,
                    source=c.id,
                    points=units * ALLY_DIVIDEND,
                )
            )
        if self.mission.status == "completed":
            for contributor in self.mission.contributions:
                self.contestants[contributor].score += MISSION_BONUS
            events.append(
                self.events.append(
                    self.tick,
                    "mission_completed",
                    mission=self.mission.id,
                    contributions=dict(self.mission.contributions),
                    bonus=MISSION_BONUS,
                )
            )
            self._check_team_win()
        return ActionResult(True, events=tuple(events))

    def shrine_required(self) -> int:
        return min(SHRINE_REQUIRED, sum(1 for c in self.contestants.values() if c.alive))

    def _channel_shrine(self, c: Contestant) -> ActionResult:
        s = self.shrine
        if s.status == "activated":
            return ActionResult(False, "mission_closed")
        if c.id in s.participants:
            return ActionResult(False, "already_channeling")
        if s.status == "dormant":
            s.status = "channeling"
            s.participants = []
            s.window_end_tick = self.tick + SHRINE_WINDOW_TICKS
        s.participants.append(c.id)
        c.last_interact_tick = self.tick
        required = self.shrine_required()
        events = [
            self.events.append(
                self.tick,
                "shrine_channel",
                contestant=c.id,
                count=len(s.participants),
                required=required,
                window_ticks_left=s.window_end_tick - self.tick,
            )
        ]
        if len(s.participants) >= required:
            s.status = "activated"
            s.activated_by = list(s.participants)
            for pid in s.participants:
                self.contestants[pid].score += SHRINE_BONUS
            events.append(
                self.events.append(
                    self.tick,
                    "shrine_activated",
                    participants=list(s.participants),
                    bonus=SHRINE_BONUS,
                )
            )
            if self.mode == "impostor":
                # Shrine vision: each channeler privately learns one contestant who is innocent.
                for pid in s.participants:
                    pool = sorted(
                        o.id for o in self.contestants.values() if o.alive and o.role != R.IMPOSTOR and o.id != pid
                    )
                    if pool:
                        events.append(
                            self.events.append(
                                self.tick, "shrine_vision", visible_to=frozenset({pid}), innocent=self.rng.choice(pool)
                            )
                        )
        return ActionResult(True, events=tuple(events))

    def _light_beacon(self, c: Contestant, beacon_id: str) -> ActionResult:
        if self.beacons.get(beacon_id):
            return ActionResult(False, "already_lit")
        if c.role not in R.FAKERS and c.carrying["wood"] < 1:
            return ActionResult(False, "need_wood")  # a beacon burns one wood
        c.last_interact_tick = self.tick
        if c.role in R.FAKERS:
            ev = self.events.append(
                self.tick, "beacon_faked", visible_to=frozenset({c.id}), contestant=c.id, beacon=beacon_id
            )
            return ActionResult(True, events=(ev,))
        self.beacons[beacon_id] = True
        c.carrying["wood"] -= 1
        c.score += R.BEACON_POINTS
        obj = self.map.objects_by_id[beacon_id]
        ev = self.events.append(
            self.tick,
            "beacon_lit",
            visible_to=self._observers(c),
            contestant=c.id,
            beacon=beacon_id,
            region=self.region(obj.x + 0.5, obj.y + 0.5),
            lit=sum(self.beacons.values()),
            total=len(self.beacons),
            points=R.BEACON_POINTS,
        )
        self._check_team_win()
        return ActionResult(True, events=(ev,))

    # ------------------------------------------------------------------ impostor mode
    def kill(self, cid: str, target: str) -> ActionResult:
        c, reason = self._check_actor(cid)
        if c is None:
            return ActionResult(False, reason)
        if self.mode != "impostor" or c.role != R.IMPOSTOR:
            return ActionResult(False, "not_impostor")
        if self.phase != "explore":
            return ActionResult(False, "meeting_in_progress")
        if self.tick < c.kill_ready_tick:
            return ActionResult(False, "kill_cooldown")
        t = self._alive(target)
        if t is None or t.id == cid or t.role == R.IMPOSTOR:
            return ActionResult(False, "invalid_target")
        if math.hypot(c.x - t.x, c.y - t.y) > R.KILL_RANGE:
            return ActionResult(False, "out_of_range")
        c.kill_ready_tick = self.tick + self.kill_cooldown
        region = self.region(t.x, t.y)
        if t.shielded_by is not None:
            medic, t.shielded_by = t.shielded_by, None
            ev = self.events.append(
                self.tick,
                "shield_blocked",
                visible_to=frozenset({cid, t.id, medic}),
                attacker=cid,
                target=t.id,
                medic=medic,
                region=region,
            )
            return ActionResult(True, "shielded", events=(ev,))
        c.score += R.KILL_POINTS
        events = self._slay(c, t, "impostor", R.KILL_POINTS)
        self._check_team_win()
        return ActionResult(True, events=tuple(events))

    def shoot(self, cid: str, target: str) -> ActionResult:
        """The sheriff's single bullet. An impostor dies; anyone else and the sheriff dies instead."""
        c, reason = self._check_actor(cid)
        if c is None:
            return ActionResult(False, reason)
        if self.mode != "impostor" or c.role != R.SHERIFF:
            return ActionResult(False, "not_sheriff")
        if c.bullet_used:
            return ActionResult(False, "bullet_used")
        if self.phase != "explore":
            return ActionResult(False, "meeting_in_progress")
        t = self._alive(target)
        if t is None or t.id == cid:
            return ActionResult(False, "invalid_target")
        if math.hypot(c.x - t.x, c.y - t.y) > R.SHERIFF_RANGE:
            return ActionResult(False, "out_of_range")
        c.bullet_used = True
        if t.role == R.IMPOSTOR:
            c.score += R.SHERIFF_POINTS
            events = self._slay(c, t, "sheriff", R.SHERIFF_POINTS)
        else:
            events = self._slay(c, c, "misfire", 0)
        self._check_team_win()
        return ActionResult(True, "hit" if t.role == R.IMPOSTOR else "misfire", events=tuple(events))

    def sabotage(self, cid: str, kind: str) -> ActionResult:
        """Impostors: roll fog over the island (islanders see less) or douse a lit beacon."""
        c, reason = self._check_actor(cid)
        if c is None:
            return ActionResult(False, reason)
        if self.mode != "impostor" or c.role != R.IMPOSTOR:
            return ActionResult(False, "not_impostor")
        if self.phase != "explore":
            return ActionResult(False, "meeting_in_progress")
        if kind not in R.SABOTAGES:
            return ActionResult(False, "unknown_sabotage")
        if self.tick < self.sabotage_ready_tick:
            return ActionResult(False, "sabotage_cooldown")
        detail: dict[str, Any] = {}
        if kind == "fog":
            self.fog_until = self.tick + R.FOG_TICKS
            detail["seconds"] = R.FOG_TICKS // physics.TICK_RATE
        else:
            lit = sorted(b for b, on in self.beacons.items() if on)
            if not lit:
                return ActionResult(False, "nothing_to_douse")
            beacon = self.rng.choice(lit)
            self.beacons[beacon] = False
            obj = self.map.objects_by_id[beacon]
            detail.update(beacon=beacon, region=self.region(obj.x + 0.5, obj.y + 0.5))
        self.sabotage_ready_tick = self.tick + R.SABOTAGE_COOLDOWN_TICKS
        # Public, but anonymous: everyone learns *that* it happened, not who did it.
        ev = self.events.append(self.tick, "sabotage", kind=kind, **detail)
        return ActionResult(True, events=(ev,))

    def fog_active(self) -> bool:
        return self.tick < self.fog_until

    def _slay(self, c: Contestant, t: Contestant, cause: str, points: int) -> list[GameEvent]:
        """`c` kills `t` (or itself, for a sheriff's misfire): body, witnesses, lookout alerts."""
        cid = c.id
        region = self.region(t.x, t.y)
        witnesses = sorted(
            o.id
            for o in self.contestants.values()
            if o.alive
            and o.id not in (cid, t.id)
            and o.role != R.IMPOSTOR
            and math.hypot(o.x - t.x, o.y - t.y) <= R.WITNESS_RADIUS
        )
        lookouts = sorted(
            o.id
            for o in self.contestants.values()
            if o.alive
            and self.has_skill(o, "lookout")
            and o.id not in (cid, t.id, *witnesses)
            and math.hypot(o.x - t.x, o.y - t.y) <= R.LOOKOUT_RADIUS
        )
        t.alive = False
        t.carrying = {r: 0 for r in t.carrying}
        t.inputs.clear()
        t.moving = False
        self.bodies[t.id] = Body(t.id, cid, t.x, t.y, self.tick)
        if self.shrine.status == "channeling" and t.id in self.shrine.participants:
            self.shrine.participants.remove(t.id)
        self.alliances.proposals = [p for p in self.alliances.proposals if t.id not in (p.proposer, p.target)]
        events = []
        partner = self.alliances.dissolve(t.id)
        if partner is not None:
            events.append(self.events.append(self.tick, "ally_lost", visible_to=frozenset({partner}), ally=t.id))
        insiders = frozenset({t.id, cid, *(i.id for i in self.impostors(alive_only=False))})
        events.append(
            self.events.append(
                self.tick,
                "contestant_killed",
                visible_to=insiders,
                killer=cid,
                victim=t.id,
                x=round(t.x, 2),
                y=round(t.y, 2),
                region=region,
                witnesses=witnesses,
                points=points,
                cause=cause,
            )
        )
        if witnesses:
            events.append(
                self.events.append(
                    self.tick,
                    "kill_witnessed",
                    visible_to=frozenset(witnesses),
                    killer=cid,
                    victim=t.id,
                    region=region,
                    cause=cause,
                )
            )
        if lookouts:
            events.append(self.events.append(self.tick, "lookout_alert", visible_to=frozenset(lookouts), region=region))
        return events

    def use_ability(self, cid: str, target: str | None = None) -> ActionResult:
        """Active skills. Today only the Medic's one-time shield."""
        c, reason = self._check_actor(cid)
        if c is None:
            return ActionResult(False, reason)
        if not self.has_skill(c, "medic"):
            return ActionResult(False, "no_active_skill")
        if c.ability_used:
            return ActionResult(False, "ability_used")
        t = self.contestants.get(target or "")
        if t is None or t.id == cid or not self.known_alive(cid, t):
            return ActionResult(False, "invalid_target")
        c.ability_used = True
        if t.alive:
            t.shielded_by = cid  # a shield on someone already (secretly) dead is simply wasted
        ev = self.events.append(self.tick, "shield_cast", visible_to=frozenset({cid}), medic=cid, target=t.id)
        return ActionResult(True, events=(ev,))

    def _report_body(self, c: Contestant, victim: str) -> ActionResult:
        body = self.bodies.get(victim)
        if body is None:
            return ActionResult(False, "not_interactable")
        if not self.meetings_enabled:
            return ActionResult(False, "not_interactable")
        if math.hypot(c.x - body.x, c.y - body.y) > R.REPORT_RANGE:
            return ActionResult(False, "out_of_range")
        c.last_interact_tick = self.tick
        region = self.region(body.x, body.y)
        events = self._start_meeting("body", c.id, victim=victim, region=region, x=round(body.x, 2), y=round(body.y, 2))
        if self.has_skill(c, "detective") and body.killer != c.id:
            others = sorted(
                o.id for o in self.contestants.values() if o.alive and o.id not in (c.id, body.killer, victim)
            )
            if others:
                pair = [body.killer, self.rng.choice(others)]
                self.rng.shuffle(pair)
                events.append(
                    self.events.append(
                        self.tick, "detective_clue", visible_to=frozenset({c.id}), victim=victim, suspects=pair
                    )
                )
        return ActionResult(True, events=tuple(events))

    def _team_counts(self) -> tuple[int, int]:
        imp = sum(1 for c in self.contestants.values() if c.alive and c.role == R.IMPOSTOR)
        crew = sum(1 for c in self.contestants.values() if c.alive and c.role != R.IMPOSTOR)
        return imp, crew

    def tasks_done(self) -> bool:
        return self.mission.status == "completed" and all(self.beacons.values())

    def _check_team_win(self, allow_vote_wins: bool = True) -> bool:
        if self.mode != "impostor" or self.status != "running":
            return False
        imp, crew = self._team_counts()
        if imp == 0 and allow_vote_wins:
            self._finish("impostors_caught")
        elif imp >= crew:
            self._finish("impostors_outnumber")
        elif self.tasks_done():
            self._finish("tasks_done")
        else:
            return False
        return True

    # ------------------------------------------------------------------ chat
    def chat(
        self,
        cid: str,
        text: str | None = None,
        quick: str | None = None,
        to: str | None = None,
        claim: dict[str, Any] | None = None,
    ) -> ActionResult:
        """Public chat, ally whispers and (impostor mode) ghost chat among the dead.

        `claim` is an optional machine-readable summary bots attach to what they say (e.g.
        {"type": "accuse", "target": "p2"}). Like the text, it is only a claim, never a fact.
        """
        c = self.contestants.get(cid)
        ghost = self.mode == "impostor" and c is not None and not c.alive and self.status == "running"
        if not ghost:
            c, reason = self._check_actor(cid)
            if c is None:
                return ActionResult(False, reason)
        assert c is not None
        if self.tick - c.last_chat_tick < CHAT_COOLDOWN_TICKS:
            return ActionResult(False, "chat_cooldown")
        if quick is not None:
            body_or_none = QUICK_CHAT.get(quick) or c.extra_phrases.get(quick)
            if body_or_none is None:
                return ActionResult(False, "unknown_phrase")  # locked packs can't be used
            body = body_or_none
        else:
            clean, why = moderate_chat(text or "")
            if clean is None:
                return ActionResult(False, why)
            if clean.lower() == c.last_chat_text and self.tick - c.last_chat_tick < DUPLICATE_WINDOW_TICKS:
                return ActionResult(False, "duplicate_message")
            body = clean
            c.last_chat_text = clean.lower()
        visible: frozenset[str] | None = None
        if ghost:
            to = None
            visible = frozenset(o.id for o in self.contestants.values() if not o.alive)
        elif to is not None:
            if not self.alliances.allied(cid, to):
                return ActionResult(False, "not_allied")  # whispers are an alliance privilege
            visible = frozenset({cid, to})
        c.last_chat_tick = self.tick
        extra: dict[str, Any] = {"ghost": True} if ghost else {}
        if claim:
            extra["claim"] = {k: v for k, v in claim.items() if k in ("type", "target", "region", "about")}
        ev = self.events.append(
            self.tick,
            "chat",
            visible_to=visible,
            sender=cid,
            to=to,
            text=body,
            quick=quick,
            private=to is not None,
            **extra,
        )
        return ActionResult(True, events=(ev,))

    def phase_id(self) -> str:
        return f"{self.meeting_count}:{self.phase}"

    def agent_message(
        self,
        cid: str,
        msg_type: str,
        text: str,
        to: str | None = None,
        payload: dict[str, Any] | None = None,
        reply_to: str | None = None,
    ) -> ActionResult:
        """A structured protocol message. It is a *claim*: nothing here changes game state.

        Rules: known type; sanitised text; bounded payload; a sender may post at most
        MAX_MESSAGES_PER_PHASE per phase; replies must reference a live thread the sender
        belongs to; a thread may run at most MAX_NEGOTIATION_ROUNDS messages; private messages
        are allowed to anyone for negotiation types and to allies for everything else.
        """
        import json

        c, reason = self._check_actor(cid)
        if c is None:
            return ActionResult(False, reason)
        if msg_type not in MESSAGE_TYPES or msg_type == "SYSTEM_EVENT":
            return ActionResult(False, "invalid_message_type")  # SYSTEM_EVENT is server-only
        if self.tick - c.last_chat_tick < CHAT_COOLDOWN_TICKS:
            return ActionResult(False, "chat_cooldown")
        body = sanitize_chat(text)
        if body is None:
            return ActionResult(False, "message_rejected")
        payload = payload or {}
        try:
            encoded = json.dumps(payload, sort_keys=True)
        except (TypeError, ValueError):
            return ActionResult(False, "invalid_payload")
        if len(encoded) > MAX_PAYLOAD_CHARS:
            return ActionResult(False, "payload_too_large")
        key = (cid, self.phase_id())
        if self._phase_messages.get(key, 0) >= MAX_MESSAGES_PER_PHASE:
            return ActionResult(False, "message_limit")
        if to is not None:
            if self._alive(to) is None or to == cid:
                return ActionResult(False, "invalid_target")
            if msg_type not in NEGOTIATION_TYPES and not self.alliances.allied(cid, to):
                return ActionResult(False, "not_allied")
        thread: dict[str, Any] | None = None
        if msg_type in REPLY_TYPES:
            thread = self._threads.get(reply_to or "")
            if thread is None or thread["expires_tick"] <= self.tick:
                return ActionResult(False, "no_such_thread")
            if not thread["open_to_all"] and cid not in thread["participants"]:
                return ActionResult(False, "not_in_thread")
            if thread["rounds"] >= self.max_negotiation_rounds:
                return ActionResult(False, "negotiation_limit")
        self._message_counter += 1
        message_id = f"m{self._message_counter}"
        if thread is None:
            correlation_id = message_id
            participants = {cid, to} if to else {cid}
            self._threads[correlation_id] = {
                "participants": participants,
                "rounds": 1,
                "expires_tick": self.tick + MESSAGE_TTL_TICKS,
                "open_to_all": to is None,
            }
        else:
            correlation_id = reply_to or message_id
            thread["rounds"] += 1
            if thread["open_to_all"]:
                thread["participants"].add(cid)
        self._phase_messages[key] = self._phase_messages.get(key, 0) + 1
        c.last_chat_tick = self.tick
        visible = frozenset({cid, to}) if to is not None else None
        ev = self.events.append(
            self.tick,
            "chat",
            visible_to=visible,
            sender=cid,
            to=to,
            text=body,
            quick=None,
            private=to is not None,
            kind=msg_type,
            message_id=message_id,
            correlation_id=correlation_id,
            phase_id=self.phase_id(),
            payload=payload,
            expires_tick=self.tick + MESSAGE_TTL_TICKS,
        )
        return ActionResult(True, events=(ev,))

    # ------------------------------------------------------------------ alliances
    def propose_alliance(self, cid: str, target: str) -> ActionResult:
        c, reason = self._check_actor(cid)
        if c is None:
            return ActionResult(False, reason)
        t = self._alive(target)
        if t is None or target == cid:
            return ActionResult(False, "invalid_target")
        if self.alliances.ally_of(cid) or self.alliances.ally_of(target):
            return ActionResult(False, "already_allied")
        if any(p.proposer == cid and p.target == target for p in self.alliances.pending_for(target, self.tick)):
            return ActionResult(False, "already_proposed")
        self.alliances.proposals.append(Proposal(cid, target, self.tick + ALLIANCE_PROPOSAL_TTL_TICKS))
        ev = self.events.append(
            self.tick, "alliance_proposed", visible_to=frozenset({cid, target}), proposer=cid, target=target
        )
        return ActionResult(True, events=(ev,))

    def respond_alliance(self, cid: str, proposer: str, accept: bool) -> ActionResult:
        c, reason = self._check_actor(cid)
        if c is None:
            return ActionResult(False, reason)
        pending = [p for p in self.alliances.pending_for(cid, self.tick) if p.proposer == proposer]
        if not pending:
            return ActionResult(False, "no_proposal")
        self.alliances.proposals.remove(pending[0])
        pair = frozenset({cid, proposer})
        if not accept:
            ev = self.events.append(self.tick, "alliance_rejected", visible_to=pair, proposer=proposer, target=cid)
            return ActionResult(True, events=(ev,))
        if self._alive(proposer) is None or self.alliances.ally_of(cid) or self.alliances.ally_of(proposer):
            return ActionResult(False, "already_allied")
        self.alliances.form(cid, proposer)
        ev = self.events.append(self.tick, "alliance_formed", visible_to=pair, members=sorted(pair))
        return ActionResult(True, events=(ev,))

    def break_alliance(self, cid: str, reason: str = "broken") -> ActionResult:
        c, why = self._check_actor(cid)
        if c is None:
            return ActionResult(False, why)
        partner = self.alliances.dissolve(cid)
        if partner is None:
            return ActionResult(False, "not_allied")
        # Betrayal is public drama: everyone learns the alliance existed and who ended it.
        ev = self.events.append(self.tick, "alliance_broken", by=cid, partner=partner, reason=reason)
        return ActionResult(True, events=(ev,))

    # ------------------------------------------------------------------ council
    def _start_meeting(self, cause: str, caller: str | None = None, **detail: Any) -> list[GameEvent]:
        self.meeting_count += 1
        self.votes = {}
        self._set_phase("discuss", self.phase_seconds["discuss"])
        for c in self.contestants.values():
            c.inputs.clear()
            c.moving = False
        events = [
            self.events.append(
                self.tick, "meeting_called", cause=cause, caller=caller, meeting=self.meeting_count, **detail
            )
        ]
        if self.mode == "impostor":
            # Every death so far becomes public; bodies are cleared away.
            newly = sorted(c.id for c in self.contestants.values() if not c.alive and not c.death_known)
            for cid in newly:
                self.contestants[cid].death_known = True
            if newly:
                events.append(self.events.append(self.tick, "deaths_revealed", dead=newly))
            self.bodies.clear()
        return events

    def vote(self, cid: str, target: str | None) -> ActionResult:
        c, reason = self._check_actor(cid, ("vote",))
        if c is None:
            return ActionResult(False, reason)
        if cid in self.votes:
            return ActionResult(False, "already_voted")
        if target is not None and (target == cid or self._alive(target) is None):
            return ActionResult(False, "invalid_target")
        self.votes[cid] = target or "skip"
        # Who voted is public immediately; for whom is revealed at the end.
        ev = self.events.append(self.tick, "vote_cast", voter=cid)
        return ActionResult(True, events=(ev,))

    def _resolve_votes(self) -> None:
        alive = [c.id for c in self.contestants.values() if c.alive]
        counts: dict[str, int] = {}
        for target in self.votes.values():
            counts[target] = counts.get(target, 0) + 1
        skip = counts.pop("skip", 0)
        eliminated: str | None = None
        if counts:
            top = max(counts.values())
            leaders = [t for t, n in counts.items() if n == top]
            if len(leaders) == 1 and top > skip:
                eliminated = leaders[0]
        extra: dict[str, Any] = {}
        if self.mode == "impostor" and eliminated is not None:
            # Ejections are confirmed: everyone learns whether the council got it right.
            extra["was_impostor"] = self.contestants[eliminated].role == R.IMPOSTOR
            if self.contestants[eliminated].role == R.JESTER:
                extra["was_jester"] = True
                self.jester_winner = eliminated
            extra["impostors_left"] = sum(1 for c in self.impostors() if c.id != eliminated)
        self.events.append(
            self.tick,
            "vote_resolved",
            votes=dict(self.votes),
            counts=counts,
            skip=skip,
            abstained=[a for a in alive if a not in self.votes],
            eliminated=eliminated,
            **extra,
        )
        # Voting against your own ally is a betrayal and ends the alliance publicly.
        for voter, target in self.votes.items():
            if self.alliances.allied(voter, target):
                self.alliances.dissolve(voter)
                self.events.append(self.tick, "alliance_broken", by=voter, partner=target, reason="betrayal")
        if eliminated is not None:
            self._eliminate(eliminated, "voted_out")

    def _eliminate(self, cid: str, cause: str) -> None:
        c = self.contestants[cid]
        c.alive = False
        c.death_known = True
        c.carrying = {r: 0 for r in c.carrying}
        c.inputs.clear()
        c.moving = False
        partner = self.alliances.dissolve(cid)
        self.alliances.proposals = [p for p in self.alliances.proposals if cid not in (p.proposer, p.target)]
        if self.shrine.status == "channeling" and cid in self.shrine.participants:
            self.shrine.participants.remove(cid)
        self.events.append(self.tick, "contestant_eliminated", contestant=cid, cause=cause, former_ally=partner)

    def _advance_phase(self) -> None:
        if self.tick < self.phase_end_tick and not (
            self.phase == "vote" and all(c.id in self.votes for c in self.contestants.values() if c.alive)
        ):
            return
        if self.phase == "discuss":
            self._set_phase("vote", self.phase_seconds["vote"])
            self.events.append(
                self.tick,
                "vote_started",
                meeting=self.meeting_count,
                candidates=[c.id for c in self.contestants.values() if c.alive],
            )
        elif self.phase == "vote":
            self._resolve_votes()
            self._set_phase("reveal", self.phase_seconds["reveal"])
        elif self.phase == "reveal":
            if self.jester_winner is not None:
                self._finish("jester_ejected")
                return
            if self._check_team_win():
                return
            self._set_phase("explore", self.phase_seconds["explore"])
            self.events.append(self.tick, "meeting_ended", meeting=self.meeting_count)
            for imp in self.impostors():
                imp.kill_ready_tick = max(imp.kill_ready_tick, self.tick + R.KILL_COOLDOWN_AFTER_MEETING_TICKS)
        elif self.phase == "explore" and self.meetings_enabled:
            self._start_meeting("scheduled")

    # ------------------------------------------------------------------ connection
    def set_connected(self, cid: str, connected: bool) -> None:
        c = self.contestants[cid]
        if c.connected != connected:
            c.connected = connected
            if not connected:
                c.inputs.clear()
            self.events.append(self.tick, "contestant_connection", contestant=cid, connected=connected)

    # ------------------------------------------------------------------ observation
    def can_see(self, viewer: str | None, target: Contestant) -> bool:
        """Server-side visibility filter for positions."""
        if viewer is None or viewer == target.id:
            return True
        v = self.contestants.get(viewer)
        if v is not None and v.alive and not target.alive and self.mode == "impostor":
            return False  # the living never see ghosts
        if v is None or not v.alive or self.phase != "explore" or self.status != "running":
            return True  # spectators, ghosts, meetings and results see everyone
        if not target.alive:
            return False
        if self.alliances.allied(viewer, target.id):
            return True
        return math.hypot(v.x - target.x, v.y - target.y) <= self.view_radius(v)

    def visible_bodies(self, viewer: str | None) -> list[Body]:
        v = self.contestants.get(viewer or "")
        if viewer is None or v is None or not v.alive:
            return list(self.bodies.values())
        r = self.view_radius(v)
        return [b for b in self.bodies.values() if math.hypot(v.x - b.x, v.y - b.y) <= r]

    def observe(self, cid: str, event_cursor: int = 0) -> Observation:
        c = self.contestants[cid]
        s = self.shrine
        return Observation(
            tick=self.tick,
            self_id=cid,
            x=c.x,
            y=c.y,
            alive=c.alive,
            carrying=dict(c.carrying),
            carry_capacity=self.capacity(c),
            phase=self.phase,
            phase_ticks_left=max(0, self.phase_end_tick - self.tick),
            mission_status=self.mission.status,
            mission_remaining=self.mission.remaining(),
            mission_target=self.mission.target_id,
            node_charges={nid: n.charges for nid, n in self.nodes.items()},
            match_running=self.status == "running",
            alive_ids=tuple(o.id for o in self.contestants.values() if self.known_alive(cid, o)),
            ally=self.alliances.ally_of(cid),
            incoming_proposals=tuple(p.proposer for p in self.alliances.pending_for(cid, self.tick)),
            has_voted=cid in self.votes,
            objective=c.objective,
            shrine_status=s.status,
            shrine_participants=tuple(s.participants),
            shrine_window_left=max(0, s.window_end_tick - self.tick) if s.status == "channeling" else 0,
            visible_positions={
                o.id: (o.x, o.y) for o in self.contestants.values() if o.id != cid and o.alive and self.can_see(cid, o)
            },
            new_events=tuple(self.events.visible_since(event_cursor, cid)),
            mode=self.mode,
            role=c.role,
            fellow_impostors=tuple(i.id for i in self.impostors() if i.id != cid) if c.role == R.IMPOSTOR else (),
            skill=c.skill.id if c.skill else None,
            ability_used=c.ability_used,
            kill_ready=c.role == R.IMPOSTOR and self.tick >= c.kill_ready_tick and self.phase == "explore",
            speed=self.speed(c),
            visible_bodies={b.victim: (b.x, b.y) for b in self.visible_bodies(cid)},
            beacons=dict(self.beacons),
            bullet_used=c.bullet_used,
            sabotage_ready=c.role == R.IMPOSTOR and self.tick >= self.sabotage_ready_tick and self.phase == "explore",
            fog=self.fog_active(),
        )

    # ------------------------------------------------------------------ simulation
    def step(self) -> list[GameEvent]:
        if self.status != "running":
            return []
        first_new = len(self.events)
        self.tick += 1
        exploring = self.phase == "explore"

        for c in self.contestants.values():
            if c.is_bot:
                continue
            c.input_tokens = min(INPUT_TOKEN_MAX, c.input_tokens + 1.0)
            moved = False
            while c.inputs and c.input_tokens >= 1.0:
                cmd = c.inputs.popleft()
                c.input_tokens -= 1.0
                if exploring and (c.alive or self.mode == "impostor"):  # ghosts roam in impostor mode
                    self._move(c, cmd.dx, cmd.dy)
                    moved = moved or c.moving
                c.last_ack_seq = cmd.seq  # inputs during meetings are acknowledged but ignored
            c.moving = moved

        for cid, brain in self.bots.items():
            if self.status != "running":
                break
            c = self.contestants[cid]
            if not c.alive:
                continue
            obs = self.observe(cid, self._bot_cursors[cid])
            self._bot_cursors[cid] = len(self.events)
            intent = brain.update(obs)
            if self.phase == "explore":
                self._move(c, intent.dx, intent.dy)
            else:
                c.moving = False
            for action in intent.actions:
                self._apply_bot_action(cid, action)
            if intent.interact_target is not None:
                result = self.interact(cid, intent.interact_target)
                brain.on_interact_result(result.ok, result.reason, self.tick)

        for nid, node in self.nodes.items():
            if node.next_regen_tick is not None and self.tick >= node.next_regen_tick:
                node.charges = min(node.max_charges, node.charges + 1)
                node.next_regen_tick = None if node.charges >= node.max_charges else self.tick + node.regen_ticks
                self.events.append(self.tick, "resource_regenerated", node=nid, charges=node.charges)

        if self.shrine.status == "channeling" and self.tick >= self.shrine.window_end_tick:
            self.events.append(self.tick, "shrine_fizzled", participants=list(self.shrine.participants))
            self.shrine = ShrineState()

        for p in self.alliances.expire(self.tick):
            self.events.append(
                self.tick,
                "alliance_expired",
                visible_to=frozenset({p.proposer, p.target}),
                proposer=p.proposer,
                target=p.target,
            )

        self._advance_phase()

        if self.tick % POSITION_SAMPLE_TICKS == 0:
            # Positions are hidden information during play, so samples are visible to nobody
            # (empty set) — they exist only for post-match replays.
            self.events.append(
                self.tick,
                "position_sample",
                visible_to=frozenset(),
                positions={c.id: [round(c.x, 2), round(c.y, 2)] for c in self.contestants.values() if c.alive},
            )

        alive = sum(1 for c in self.contestants.values() if c.alive)
        if self.status != "running":
            pass  # a kill, task or vote already decided the match this tick
        elif self.tick >= self.time_limit_ticks:
            self._finish("time_up")
        elif self.mode == "classic" and len(self.contestants) > 2 and alive <= 2 and self.phase == "explore":
            self._finish("final_two")

        return self.events.since(first_new)

    def _apply_bot_action(self, cid: str, action: tuple[Any, ...]) -> ActionResult:
        kind = action[0]
        if kind == "chat":
            r = self.chat(cid, quick=action[1], to=action[2] if len(action) > 2 else None)
        elif kind == "say":
            r = self.chat(cid, text=action[1], claim=action[2] if len(action) > 2 else None)
        elif kind == "kill":
            r = self.kill(cid, action[1])
        elif kind == "ability":
            r = self.use_ability(cid, action[1])
        elif kind == "shoot":
            r = self.shoot(cid, action[1])
        elif kind == "sabotage":
            r = self.sabotage(cid, action[1])
        elif kind == "vote":
            r = self.vote(cid, action[1])
        elif kind == "propose":
            r = self.propose_alliance(cid, action[1])
        elif kind == "respond":
            r = self.respond_alliance(cid, action[1], action[2])
        elif kind == "break":
            r = self.break_alliance(cid)
        elif kind == "message":
            _, msg_type, text, to, payload, reply_to = action
            r = self.agent_message(cid, msg_type, text, to=to, payload=payload, reply_to=reply_to)
        else:
            r = ActionResult(False, "unknown_action")
        self.action_results.append((self.tick, cid, action, r.ok, r.reason))
        return r

    def objective_achieved(self, c: Contestant) -> bool:
        o = c.objective
        if o is None:
            return False
        if o.kind == "deliver_wood":
            return c.delivered["wood"] >= o.amount
        if o.kind == "deliver_stone":
            return c.delivered["stone"] >= o.amount
        if o.kind == "survive":
            return c.alive
        if o.kind == "eliminate":
            t = self.contestants.get(o.target or "")
            return t is not None and not t.alive
        if o.kind == "ally_at_end":
            return c.alive and self.alliances.ally_of(c.id) is not None
        return c.id in self.shrine.activated_by

    def _finish(self, reason: str) -> GameEvent:
        if self.mode == "impostor":
            return self._finish_teams(reason)
        self.status = "finished"
        names = self.names()
        bonuses: dict[str, dict[str, int]] = {}
        for c in self.contestants.values():
            b: dict[str, int] = {}
            if c.alive:
                b["survival"] = SURVIVAL_BONUS
            if self.objective_achieved(c):
                b["objective"] = OBJECTIVE_BONUS
            c.score += sum(b.values())
            bonuses[c.id] = b
        standings = sorted(
            self.contestants.values(),
            key=lambda c: (not c.alive, -c.score, -self.mission.contributions.get(c.id, 0), c.id),
        )
        winner = next((c.id for c in standings if c.alive), None)
        self.result = {
            "reason": reason,
            "winner": winner,
            "tower_repaired": self.mission.status == "completed",
            "shrine_activated": self.shrine.status == "activated",
            "standings": [
                {
                    "id": c.id,
                    "name": c.name,
                    "score": c.score,
                    "alive": c.alive,
                    "contributed": self.mission.contributions.get(c.id, 0),
                    "bonuses": bonuses[c.id],
                    # Objectives are revealed to everyone once the match is over.
                    "objective": c.objective.to_dict(names) if c.objective else None,
                    "objective_achieved": self.objective_achieved(c),
                }
                for c in standings
            ],
        }
        return self.events.append(self.tick, "match_finished", **self.result)

    def _finish_teams(self, reason: str) -> GameEvent:
        self.status = "finished"
        if reason == "jester_ejected":
            team = R.JESTER
            winners = [self.jester_winner] if self.jester_winner else []
        else:
            team = R.ISLANDER if reason in ("impostors_caught", "tasks_done") else R.IMPOSTOR
            winners = sorted(c.id for c in self.contestants.values() if R.team(c.role) == team)
        bonuses: dict[str, dict[str, int]] = {}
        for c in self.contestants.values():
            b: dict[str, int] = {}
            if c.id in winners:
                b["victory"] = R.VICTORY_BONUS
            if c.alive:
                b["survival"] = SURVIVAL_BONUS
            c.score += sum(b.values())
            bonuses[c.id] = b
        standings = sorted(
            self.contestants.values(),
            key=lambda c: (c.id not in winners, not c.alive, -c.score, c.id),
        )
        self.result = {
            "reason": reason,
            "mode": self.mode,
            "winning_team": team,
            "winners": winners,
            "winner": standings[0].id if standings and standings[0].id in winners else None,
            "tower_repaired": self.mission.status == "completed",
            "beacons_lit": sum(self.beacons.values()),
            "beacons_total": len(self.beacons),
            "shrine_activated": self.shrine.status == "activated",
            "standings": [
                {
                    "id": c.id,
                    "name": c.name,
                    "score": c.score,
                    "alive": c.alive,
                    "won": c.id in winners,
                    "role": c.role,
                    "skill": c.skill.to_dict() if c.skill else None,
                    "contributed": self.mission.contributions.get(c.id, 0),
                    "bonuses": bonuses[c.id],
                    "objective": None,
                    "objective_achieved": False,
                }
                for c in standings
            ],
        }
        return self.events.append(self.tick, "match_finished", **self.result)

    # ------------------------------------------------------------------ views
    def time_left_seconds(self) -> float:
        return max(0, self.time_limit_ticks - self.tick) / physics.TICK_RATE

    def snapshot(self, viewer: str | None = None) -> dict[str, Any]:
        """State as seen by `viewer` (None = omniscient, for tests and replays)."""
        s = self.shrine
        snap: dict[str, Any] = {
            "tick": self.tick,
            "status": self.status,
            "time_left": self.time_left_seconds(),
            "phase": self.phase,
            "phase_left": max(0, self.phase_end_tick - self.tick) / physics.TICK_RATE,
            "meeting": self.meeting_count,
            "mode": self.mode,
            "contestants": [c.public_dict() for c in self.contestants.values() if self.can_see(viewer, c)],
            "roster": [c.roster_dict(self.known_alive(viewer, c)) for c in self.contestants.values()],
            "nodes": {nid: n.charges for nid, n in self.nodes.items()},
            "mission": self.mission.to_dict(),
            "shrine": {
                "status": s.status,
                "count": len(s.participants),
                "required": self.shrine_required(),
                "window_left": max(0, s.window_end_tick - self.tick) / physics.TICK_RATE
                if s.status == "channeling"
                else 0,
            },
            "voted": sorted(self.votes) if self.phase in ("vote", "reveal") else [],
        }
        if self.mode == "impostor":
            if self.status == "running" and viewer is not None:
                # Scores and tower contributions would reveal who did tasks and who killed.
                for entry in (*snap["contestants"], *snap["roster"]):
                    if entry["id"] != viewer:
                        entry["score"] = None
                mine = self.mission.contributions.get(viewer)
                snap["mission"]["contributions"] = {} if mine is None else {viewer: mine}
            snap["beacons"] = dict(self.beacons)
            snap["fog_left"] = max(0, self.fog_until - self.tick) / physics.TICK_RATE
            snap["bodies"] = [
                {"id": b.id, "victim": b.victim, "x": round(b.x, 2), "y": round(b.y, 2)}
                for b in self.visible_bodies(viewer)
            ]
        if viewer is not None and viewer in self.contestants:
            me = self.contestants[viewer]
            snap["me"] = {
                "ally": self.alliances.ally_of(viewer),
                "incoming_proposals": [p.proposer for p in self.alliances.pending_for(viewer, self.tick)],
                "outgoing_proposals": [p.target for p in self.alliances.proposals if p.proposer == viewer],
                "objective": me.objective.to_dict(self.names()) if me.objective else None,
                "bell_used": me.bell_used,
                "vote": self.votes.get(viewer),
                "delivered": dict(me.delivered),
                "phrases": dict(me.extra_phrases),
                "alive": me.alive,
                "capacity": self.capacity(me),
            }
            if self.mode == "impostor":
                snap["me"].update(
                    {
                        "role": me.role,
                        "fellow_impostors": [i.id for i in self.impostors(alive_only=False) if i.id != viewer]
                        if me.role == R.IMPOSTOR
                        else [],
                        "skill": me.skill.to_dict() if me.skill else None,
                        "ability_used": me.ability_used,
                        "speed": self.speed(me),
                        "kill_cooldown": max(0, me.kill_ready_tick - self.tick) / physics.TICK_RATE
                        if me.role == R.IMPOSTOR
                        else None,
                        "sabotage_cooldown": max(0, self.sabotage_ready_tick - self.tick) / physics.TICK_RATE
                        if me.role == R.IMPOSTOR
                        else None,
                        "bullet_used": me.bullet_used if me.role == R.SHERIFF else None,
                    }
                )
        return snap
