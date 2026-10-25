"""Authoritative match simulation.

The Match owns all game state. Clients (human or bot) can only *request* things: queue a
movement input or ask to interact with an object. The match validates every request against
range, cooldown, capacity and phase rules, mutates state, and records a GameEvent.
"""

from __future__ import annotations

import math
import random
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from . import physics
from .events import EventLog, GameEvent
from .map import GameMap
from .missions import RepairTowerMission

RULES_VERSION = "m1.0"
INTERACT_RANGE = 1.3
INTERACT_COOLDOWN_TICKS = 8
CARRY_CAPACITY = 3
MAX_INPUT_QUEUE = 12
INPUT_TOKEN_MAX = 3.0
POINTS_PER_UNIT = 10
MISSION_BONUS = 50
WOOD_PER_CONTESTANT = 8
STONE_PER_CONTESTANT = 6

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
    score: int = 0
    connected: bool = True
    last_interact_tick: int = -10_000
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
            "connected": self.connected,
        }


@dataclass
class NodeState:
    resource: str
    charges: int
    max_charges: int
    regen_ticks: int
    next_regen_tick: int | None = None


@dataclass(frozen=True)
class InteractResult:
    ok: bool
    reason: str = ""
    events: tuple[GameEvent, ...] = ()


@dataclass(frozen=True)
class Observation:
    """What a contestant is authorised to know. Bots decide from this, never from Match."""

    tick: int
    self_id: str
    x: float
    y: float
    carrying: dict[str, int]
    carry_capacity: int
    mission_status: str
    mission_remaining: dict[str, int]
    mission_target: str
    node_charges: dict[str, int]
    match_running: bool


class Match:
    def __init__(
        self,
        match_id: str,
        game_map: GameMap,
        seed: int,
        time_limit_seconds: int = 300,
    ) -> None:
        self.id = match_id
        self.map = game_map
        self.seed = seed
        self.rng = random.Random(seed)
        self.tick = 0
        self.time_limit_ticks = time_limit_seconds * physics.TICK_RATE
        self.status = "lobby"  # lobby | running | finished
        self.contestants: dict[str, Contestant] = {}
        self.mission = RepairTowerMission()
        self.events = EventLog()
        self.result: dict[str, Any] | None = None
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
        # Imported lazily to keep the dependency direction engine.bots -> engine.match.
        from .bots import BotBrain

        self._bot_cls = BotBrain
        self.bots: dict[str, BotBrain] = {}

    # ------------------------------------------------------------------ setup
    def add_contestant(self, cid: str, name: str, archetype: str, is_bot: bool) -> Contestant:
        if cid in self.contestants:
            raise ValueError(f"duplicate contestant {cid}")
        if archetype not in ARCHETYPES:
            raise ValueError(f"unknown archetype {archetype}")
        spawn = self.map.spawns[len(self.contestants) % len(self.map.spawns)]
        c = Contestant(cid, name, archetype, is_bot, spawn[0], spawn[1])
        self.contestants[cid] = c
        if is_bot:
            self.bots[cid] = self._bot_cls(cid, self.map, random.Random(f"{self.seed}:{cid}"))
        return c

    def start(self) -> GameEvent:
        if self.status != "lobby":
            raise RuntimeError("match already started")
        self.status = "running"
        # Scale the workload with the field so solo practice and 8-player matches both last a few minutes.
        n = len(self.contestants)
        self.mission.required = {"wood": WOOD_PER_CONTESTANT * n + 2, "stone": STONE_PER_CONTESTANT * n + 2}
        return self.events.append(
            self.tick,
            "match_started",
            map_id=self.map.id,
            seed=self.seed,
            rules_version=RULES_VERSION,
            contestants=[c.id for c in self.contestants.values()],
            mission=self.mission.id,
            required=dict(self.mission.required),
        )

    # ------------------------------------------------------------------ requests
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

    def interact(self, cid: str, target_id: str) -> InteractResult:
        c = self.contestants.get(cid)
        if c is None:
            return InteractResult(False, "unknown_contestant")
        if self.status != "running":
            return InteractResult(False, "match_not_running")
        if self.tick - c.last_interact_tick < INTERACT_COOLDOWN_TICKS:
            return InteractResult(False, "cooldown")
        obj = self.map.objects_by_id.get(target_id)
        if obj is None or not obj.interactable:
            return InteractResult(False, "not_interactable")
        if obj.distance_to(c.x, c.y) > INTERACT_RANGE:
            return InteractResult(False, "out_of_range")

        if obj.kind == "resource_node":
            node = self.nodes[obj.id]
            if node.charges <= 0:
                return InteractResult(False, "depleted")
            if c.carry_total() >= CARRY_CAPACITY:
                return InteractResult(False, "inventory_full")
            node.charges -= 1
            if node.next_regen_tick is None:
                node.next_regen_tick = self.tick + node.regen_ticks
            c.carrying[node.resource] += 1
            c.last_interact_tick = self.tick
            ev = self.events.append(
                self.tick,
                "resource_gathered",
                contestant=cid,
                node=obj.id,
                resource=node.resource,
                charges_left=node.charges,
                carrying=dict(c.carrying),
            )
            return InteractResult(True, events=(ev,))

        if obj.id == self.mission.target_id:
            if self.mission.status != "active":
                return InteractResult(False, "mission_closed")
            if c.carry_total() == 0:
                return InteractResult(False, "nothing_to_deliver")
            accepted = self.mission.accept(cid, c.carrying)
            surplus = {r: n - accepted.get(r, 0) for r, n in c.carrying.items() if n - accepted.get(r, 0)}
            c.carrying = {r: 0 for r in c.carrying}
            units = sum(accepted.values())
            c.score += units * POINTS_PER_UNIT
            c.last_interact_tick = self.tick
            events = [
                self.events.append(
                    self.tick,
                    "resources_delivered",
                    contestant=cid,
                    accepted=accepted,
                    surplus=surplus,
                    points=units * POINTS_PER_UNIT,
                    delivered=dict(self.mission.delivered),
                )
            ]
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
                events.append(self._finish("mission_completed"))
            return InteractResult(True, events=tuple(events))

        return InteractResult(False, "not_interactable")

    def set_connected(self, cid: str, connected: bool) -> None:
        c = self.contestants[cid]
        if c.connected != connected:
            c.connected = connected
            if not connected:
                c.inputs.clear()
            self.events.append(self.tick, "contestant_connection", contestant=cid, connected=connected)

    # ------------------------------------------------------------------ simulation
    def observe(self, cid: str) -> Observation:
        c = self.contestants[cid]
        return Observation(
            tick=self.tick,
            self_id=cid,
            x=c.x,
            y=c.y,
            carrying=dict(c.carrying),
            carry_capacity=CARRY_CAPACITY,
            mission_status=self.mission.status,
            mission_remaining=self.mission.remaining(),
            mission_target=self.mission.target_id,
            node_charges={nid: n.charges for nid, n in self.nodes.items()},
            match_running=self.status == "running",
        )

    def _move(self, c: Contestant, dx: float, dy: float) -> None:
        nx, ny = physics.step(self.map.is_solid, c.x, c.y, dx, dy)
        c.moving = nx != c.x or ny != c.y
        if dx != 0.0 or dy != 0.0:
            if abs(dx) >= abs(dy):
                c.facing = "right" if dx > 0 else "left"
            else:
                c.facing = "down" if dy > 0 else "up"
        c.x, c.y = nx, ny

    def step(self) -> list[GameEvent]:
        if self.status != "running":
            return []
        first_new = len(self.events)
        self.tick += 1

        for c in self.contestants.values():
            if c.is_bot:
                continue
            c.input_tokens = min(INPUT_TOKEN_MAX, c.input_tokens + 1.0)
            moved = False
            while c.inputs and c.input_tokens >= 1.0:
                cmd = c.inputs.popleft()
                c.input_tokens -= 1.0
                self._move(c, cmd.dx, cmd.dy)
                c.last_ack_seq = cmd.seq
                moved = moved or c.moving
            c.moving = moved

        for cid, brain in self.bots.items():
            if self.status != "running":
                break
            c = self.contestants[cid]
            intent = brain.update(self.observe(cid))
            self._move(c, intent.dx, intent.dy)
            if intent.interact_target is not None:
                result = self.interact(cid, intent.interact_target)
                brain.on_interact_result(result.ok, result.reason, self.tick)

        for nid, node in self.nodes.items():
            if node.next_regen_tick is not None and self.tick >= node.next_regen_tick:
                node.charges = min(node.max_charges, node.charges + 1)
                node.next_regen_tick = None if node.charges >= node.max_charges else self.tick + node.regen_ticks
                self.events.append(self.tick, "resource_regenerated", node=nid, charges=node.charges)

        if self.status == "running" and self.tick >= self.time_limit_ticks:
            self.mission.status = "failed"
            self.events.append(self.tick, "mission_failed", mission=self.mission.id)
            self._finish("time_up")

        return self.events.since(first_new)

    def _finish(self, reason: str) -> GameEvent:
        self.status = "finished"
        standings = sorted(
            self.contestants.values(),
            key=lambda c: (-c.score, -self.mission.contributions.get(c.id, 0), c.id),
        )
        winner = standings[0].id if reason == "mission_completed" and standings else None
        self.result = {
            "reason": reason,
            "winner": winner,
            "standings": [
                {"id": c.id, "name": c.name, "score": c.score, "contributed": self.mission.contributions.get(c.id, 0)}
                for c in standings
            ],
        }
        return self.events.append(self.tick, "match_finished", **self.result)

    # ------------------------------------------------------------------ views
    def time_left_seconds(self) -> float:
        return max(0, self.time_limit_ticks - self.tick) / physics.TICK_RATE

    def snapshot(self) -> dict[str, Any]:
        return {
            "tick": self.tick,
            "status": self.status,
            "time_left": self.time_left_seconds(),
            "contestants": [c.public_dict() for c in self.contestants.values()],
            "nodes": {nid: n.charges for nid, n in self.nodes.items()},
            "mission": self.mission.to_dict(),
        }
