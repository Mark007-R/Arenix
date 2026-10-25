"""Rooms: shareable codes, lobby, ready states, AI fill, the match loop and reconnects.

Each room owns at most one running Match. Every connected player has a Connection with its
own writer task; the tick loop only marks connections dirty, and each writer builds the
freshest per-player message when it gets a chance to send. A slow client therefore receives
fewer (coalesced) snapshots instead of slowing the room down, and never misses events because
each connection keeps its own event cursor.
"""

from __future__ import annotations

import asyncio
import contextlib
import hmac
import logging
import secrets
import time
from collections import deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from ..agents.config import AgentConfig
from ..agents.coordinator import AgentCoordinator
from ..db.session import Database
from ..engine import physics, roles
from ..engine.maps import get_map
from ..engine.match import ARCHETYPES, INTERACT_RANGE, Match

log = logging.getLogger(__name__)

CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I/L
CODE_LENGTH = 6
MAX_CONTESTANTS = 10
MAX_ROOMS = 500
LOBBY_SEAT_GRACE_S = 30.0
ROOM_IDLE_TTL_S = 120.0
MATCH_TIME_LIMIT_S = 240  # classic mode
IMPOSTOR_TIME_LIMIT_S = 540
MAP_FOR_MODE = {"classic": "emerald_isle", "impostor": "moonfall_isle"}
BOT_NAMES = ["Brakka", "Lyra", "Fennick", "Morwen", "Tobble", "Sir Aldric", "Quill", "Nessa", "Grub"]

SendText = Callable[[str], Awaitable[None]]


class RoomError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class Connection:
    """One live socket. Messages are queued; snapshots are built lazily at send time."""

    def __init__(self, send_text: SendText, encode: Callable[[dict[str, Any]], str]) -> None:
        self._send_text = send_text
        self._encode = encode
        self.outbox: deque[dict[str, Any]] = deque(maxlen=256)
        self.snapshot_dirty = False
        self.event_cursor = 0
        self.wake = asyncio.Event()
        self.closed = False
        self.snapshot_builder: Callable[[Connection], dict[str, Any] | None] | None = None

    def push(self, msg: dict[str, Any]) -> None:
        self.outbox.append(msg)
        self.wake.set()

    def mark_dirty(self) -> None:
        self.snapshot_dirty = True
        self.wake.set()

    async def writer(self) -> None:
        try:
            while not self.closed:
                await self.wake.wait()
                self.wake.clear()
                while self.outbox:
                    await self._send_text(self._encode(self.outbox.popleft()))
                if self.snapshot_dirty and self.snapshot_builder is not None:
                    self.snapshot_dirty = False
                    msg = self.snapshot_builder(self)
                    if msg is not None:
                        await self._send_text(self._encode(msg))
        except Exception:  # socket gone; the reader side handles cleanup
            self.closed = True


@dataclass
class Seat:
    player_id: str
    name: str
    archetype: str
    token: str
    is_host: bool = False
    ready: bool = False
    conn: Connection | None = None
    last_seen: float = field(default_factory=time.monotonic)
    user_id: int | None = None  # signed-in account (for progression); None = anonymous
    loadout: dict[str, Any] = field(default_factory=dict)  # cosmetics loaded server-side from the DB

    @property
    def connected(self) -> bool:
        return self.conn is not None and not self.conn.closed

    def public(self) -> dict[str, Any]:
        return {
            "player_id": self.player_id,
            "name": self.name,
            "archetype": self.archetype,
            "ready": self.ready,
            "connected": self.connected,
            "is_host": self.is_host,
            "cosmetics": {k: v for k, v in self.loadout.items() if k in ("skin", "hat", "effect")},
        }


class Room:
    def __init__(
        self,
        code: str,
        fill_to: int,
        practice: bool = False,
        seed: int | None = None,
        agents: AgentConfig | None = None,
        db: Database | None = None,
        mode: str = "impostor",
    ) -> None:
        self.code = code
        self.mode = mode
        self.fill_to = fill_to
        self.practice = practice
        self.seed_override = seed
        self.seats: dict[str, Seat] = {}
        self.status = "lobby"  # lobby | running
        self.match: Match | None = None
        self.last_result: dict[str, Any] | None = None
        self.loop_task: asyncio.Task[None] | None = None
        self._next_player = 1
        self.empty_since: float | None = time.monotonic()
        self.matches_played = 0
        self.agent_config = agents or AgentConfig()
        self.db = db
        self.coordinator: AgentCoordinator | None = None
        # Finished matches kept for the Agent Lab and replays (most recent last).
        self.history: list[tuple[Match, AgentCoordinator | None]] = []

    # ------------------------------------------------------------ seats
    def add_seat(
        self, name: str, archetype: str, user_id: int | None = None, loadout: dict[str, Any] | None = None
    ) -> Seat:
        if archetype not in ARCHETYPES:
            raise RoomError("bad_archetype", "unknown archetype")
        if self.status != "lobby":
            raise RoomError("in_progress", "match already in progress")
        if len(self.seats) >= MAX_CONTESTANTS or (self.practice and self.seats):
            raise RoomError("room_full", "room is full")
        pid = f"p{self._next_player}"
        self._next_player += 1
        if user_id is not None and any(st.user_id == user_id for st in self.seats.values()):
            raise RoomError("already_joined", "you already have a seat in this room")
        seat = Seat(
            pid,
            name,
            archetype,
            secrets.token_urlsafe(24),
            is_host=not self.seats,
            user_id=user_id,
            loadout=loadout or {},
        )
        self.seats[pid] = seat
        self.fill_to = max(self.fill_to, len(self.seats))
        self.broadcast_lobby()
        return seat

    def seat_for_token(self, token: str) -> Seat | None:
        for seat in self.seats.values():
            if hmac.compare_digest(seat.token, token):
                return seat
        return None

    def remove_seat(self, pid: str) -> None:
        seat = self.seats.pop(pid, None)
        if seat is None:
            return
        if seat.is_host and self.seats:
            next(iter(self.seats.values())).is_host = True
        self.broadcast_lobby()

    def attach(self, seat: Seat, conn: Connection) -> None:
        if seat.conn is not None and not seat.conn.closed:
            # A newer tab takes over the seat; the old one is told and dropped.
            seat.conn.push({"type": "error", "code": "replaced", "message": "Opened in another tab."})
            seat.conn.closed = True
            seat.conn.wake.set()
        seat.conn = conn
        seat.last_seen = time.monotonic()
        self.empty_since = None
        conn.snapshot_builder = lambda c, pid=seat.player_id: self._snapshot_for(pid, c)
        conn.push(self.lobby_message())
        if self.status == "running" and self.match is not None:
            conn.event_cursor = len(self.match.events)
            conn.push(self._welcome(seat.player_id))
            if seat.player_id in self.match.contestants:
                self.match.set_connected(seat.player_id, True)
        self.broadcast_lobby()

    def detach(self, seat: Seat, conn: Connection) -> None:
        if seat.conn is not conn:
            return  # already replaced by a newer connection
        conn.closed = True
        conn.wake.set()
        seat.conn = None
        seat.last_seen = time.monotonic()
        if self.status == "running" and self.match is not None and seat.player_id in self.match.contestants:
            self.match.set_connected(seat.player_id, False)
        if not any(s.connected for s in self.seats.values()):
            self.empty_since = time.monotonic()
        self.broadcast_lobby()

    # ------------------------------------------------------------ lobby actions
    def _require_lobby(self) -> None:
        if self.status != "lobby":
            raise RoomError("in_progress", "match already in progress")

    def set_ready(self, seat: Seat, ready: bool) -> None:
        self._require_lobby()
        seat.ready = ready
        self.broadcast_lobby()

    def set_archetype(self, seat: Seat, archetype: str) -> None:
        self._require_lobby()
        if archetype not in ARCHETYPES:
            raise RoomError("bad_archetype", "unknown archetype")
        seat.archetype = archetype
        self.broadcast_lobby()

    def set_fill(self, seat: Seat, fill_to: int) -> None:
        self._require_lobby()
        if not seat.is_host:
            raise RoomError("not_host", "only the host can change room settings")
        self.fill_to = max(len(self.seats), min(MAX_CONTESTANTS, fill_to))
        self.broadcast_lobby()

    def can_start(self) -> tuple[bool, str]:
        if self.status != "lobby":
            return False, "in_progress"
        humans = [s for s in self.seats.values() if s.connected]
        if not humans:
            return False, "no_players"
        if not self.practice and not all(s.ready for s in humans):
            return False, "not_ready"
        return True, ""

    def start(self, seat: Seat | None) -> None:
        """Start a match. seat=None is used for practice rooms (auto start)."""
        if seat is not None and not seat.is_host:
            raise RoomError("not_host", "only the host can start the match")
        ok, reason = self.can_start()
        if not ok:
            raise RoomError(reason, "cannot start yet")
        seed = self.seed_override if self.seed_override is not None else secrets.randbits(32)
        self.matches_played += 1
        impostor = self.mode == "impostor"
        match = Match(
            f"{self.code}-{self.matches_played}",
            get_map(MAP_FOR_MODE[self.mode]),
            seed,
            time_limit_seconds=IMPOSTOR_TIME_LIMIT_S if impostor else MATCH_TIME_LIMIT_S,
            mode=self.mode,
        )
        # Disconnected lobby seats are dropped; everyone else plays.
        for pid in [p for p, s in self.seats.items() if not s.connected]:
            self.seats.pop(pid)
        for s in self.seats.values():
            match.add_contestant(
                s.player_id, s.name, s.archetype, is_bot=False, cosmetics=s.loadout, phrases=s.loadout.get("phrases")
            )
        used = {s.archetype for s in self.seats.values()}
        free = [a for a in ARCHETYPES if a not in used] or list(ARCHETYPES)
        # Impostor mode needs a minimum field; AI contestants make up the numbers.
        target = max(self.fill_to, roles.MIN_CONTESTANTS) if impostor else self.fill_to
        for i in range(max(0, target - len(self.seats))):
            match.add_contestant(f"bot{i + 1}", BOT_NAMES[i % len(BOT_NAMES)], free[i % len(free)], is_bot=True)
        match.start()
        self.match = match
        self.coordinator = None
        # The strategist layer drives classic mode; impostor-mode bots use their own deduction policy.
        if self.agent_config.enabled and match.bots and not impostor:
            self.coordinator = AgentCoordinator(match, self.agent_config.make_gateway(), list(match.bots))
        self.history.append((match, self.coordinator))
        del self.history[:-5]
        self.status = "running"
        self.last_result = None
        for s in self.seats.values():
            s.ready = False
            if s.conn is not None:
                s.conn.event_cursor = 0
                s.conn.push(self._welcome(s.player_id))
        self.broadcast_lobby()
        self.loop_task = asyncio.create_task(self._run_loop(), name=f"room-{self.code}")

    # ------------------------------------------------------------ match loop
    async def _run_loop(self) -> None:
        match = self.match
        assert match is not None
        next_tick = time.perf_counter()
        try:
            while match.status == "running":
                match.step()
                if self.coordinator is not None and self.coordinator.match is match:
                    self.coordinator.tick()
                for s in self.seats.values():
                    if s.conn is not None:
                        s.conn.mark_dirty()
                next_tick += physics.DT
                delay = next_tick - time.perf_counter()
                if delay < -0.25:
                    next_tick = time.perf_counter()
                    delay = 0.0
                await asyncio.sleep(max(0.0, delay))
        finally:
            if self.coordinator is not None:
                await self.coordinator.close()
            self.status = "lobby"
            self.last_result = match.result
            if match.status == "finished" and self.db is not None:
                await self._persist(match)
            for s in self.seats.values():
                if s.conn is not None:
                    s.conn.mark_dirty()  # final snapshot carries match_finished
            self.broadcast_lobby()

    async def _persist(self, match: Match) -> None:
        """Write the match + event log and award progression in one transaction; tell players their rewards."""
        from ..economy.records import persist_match

        assert self.db is not None
        user_ids = {s.player_id: s.user_id for s in self.seats.values() if s.user_id is not None}
        try:
            async with self.db.sessions.begin() as session:
                coord = self.coordinator if self.coordinator is not None and self.coordinator.match is match else None
                rewards = await persist_match(session, match, coord, self.code, user_ids)
        except Exception:
            log.exception("failed to persist match %s", match.id)
            return
        for s in self.seats.values():
            if s.user_id in rewards and s.conn is not None:
                s.conn.push({"type": "rewards", "match_id": match.id, **rewards[s.user_id]})

    def handle_input(self, seat: Seat, seq: int, dx: float, dy: float) -> None:
        if self.match is not None and self.status == "running":
            self.match.queue_input(seat.player_id, seq, dx, dy)

    def handle_action(self, seat: Seat, kind: str, **kw: Any) -> dict[str, Any] | None:
        """Chat, vote and alliance actions. Returns an error message for the client, or None."""
        match = self.match
        if match is None or self.status != "running":
            return {"type": "error", "code": "match_not_running", "message": "No match running."}
        pid = seat.player_id
        if kind == "chat":
            r = match.chat(pid, text=kw.get("text"), quick=kw.get("quick"), to=kw.get("to"))
        elif kind == "vote":
            r = match.vote(pid, kw.get("target"))
        elif kind == "propose":
            r = match.propose_alliance(pid, kw["target"])
        elif kind == "respond":
            r = match.respond_alliance(pid, kw["proposer"], kw["accept"])
        elif kind == "break":
            r = match.break_alliance(pid)
        elif kind == "kill":
            r = match.kill(pid, kw["target"])
        elif kind == "ability":
            r = match.use_ability(pid, kw.get("target"))
        else:
            return {"type": "error", "code": "unknown_action", "message": "Unknown action."}
        for s in self.seats.values():
            if s.conn is not None:
                s.conn.mark_dirty()
        if r.ok:
            return None
        return {"type": "error", "code": r.reason, "message": r.reason, "action": kind}

    def handle_interact(self, seat: Seat, target_id: str) -> dict[str, Any]:
        if self.match is None or self.status != "running":
            return {"type": "interact_result", "target_id": target_id, "ok": False, "reason": "match_not_running"}
        r = self.match.interact(seat.player_id, target_id)
        for s in self.seats.values():
            if s.conn is not None:
                s.conn.mark_dirty()
        return {"type": "interact_result", "target_id": target_id, "ok": r.ok, "reason": r.reason}

    # ------------------------------------------------------------ messages
    def _welcome(self, pid: str) -> dict[str, Any]:
        assert self.match is not None
        me = self.match.contestants.get(pid)
        return {
            "type": "welcome",
            "you": pid,
            # A reloaded client must continue its input sequence; older numbers are treated as replays.
            "resume_seq": me.last_queued_seq if me else 0,
            "match_id": self.match.id,
            "map": self.match.map.to_dict(),
            "constants": {
                "tick_rate": physics.TICK_RATE,
                "speed": physics.SPEED,
                "half_w": physics.HALF_W,
                "half_h": physics.HALF_H,
                "interact_range": INTERACT_RANGE,
            },
            "snapshot": self.match.snapshot(pid),
        }

    def _snapshot_for(self, pid: str, conn: Connection) -> dict[str, Any] | None:
        match = self.match
        if match is None:
            return None
        # Only events this player may see (whispers, alliance offers and objectives are private).
        events = match.events.visible_since(conn.event_cursor, pid)
        conn.event_cursor = len(match.events)
        me = match.contestants.get(pid)
        return {
            "type": "snapshot",
            "ack_seq": me.last_ack_seq if me else 0,
            "events": [e.to_dict() for e in events],
            **match.snapshot(pid),
        }

    def lobby_message(self) -> dict[str, Any]:
        return {
            "type": "lobby",
            "code": self.code,
            "status": self.status,
            "practice": self.practice,
            "fill_to": self.fill_to,
            "capacity": MAX_CONTESTANTS,
            "mode": self.mode,
            "map_id": MAP_FOR_MODE[self.mode],
            "min_contestants": roles.MIN_CONTESTANTS if self.mode == "impostor" else 1,
            "seats": [s.public() for s in self.seats.values()],
            "can_start": self.can_start()[0],
            "ai_mode": self.agent_config.provider if self.agent_config.enabled and self.mode == "classic" else "rules",
            "last_result": self.last_result,
        }

    def broadcast_lobby(self) -> None:
        msg = self.lobby_message()
        for s in self.seats.values():
            if s.conn is not None and not s.conn.closed:
                s.conn.push(msg)

    async def close(self) -> None:
        if self.loop_task is not None:
            self.loop_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self.loop_task


class RoomManager:
    def _new_code(self) -> str:
        for _ in range(100):
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
            if code not in self.rooms:
                return code
        raise RoomError("busy", "could not allocate a room code")

    def __init__(self, agents: AgentConfig | None = None, db: Database | None = None) -> None:
        self.rooms: dict[str, Room] = {}
        self.agents = agents or AgentConfig.from_env()
        self.db = db

    def create(self, fill_to: int = 6, practice: bool = False, seed: int | None = None) -> Room:
        if len(self.rooms) >= MAX_ROOMS:
            raise RoomError("busy", "server is full, try again later")
        room = Room(
            self._new_code(), max(1, min(MAX_CONTESTANTS, fill_to)), practice=practice, seed=seed, agents=self.agents
        )
        self.rooms[room.code] = room
        return room

    def get(self, code: str) -> Room:
        room = self.rooms.get(code.upper())
        if room is None:
            raise RoomError("not_found", "room not found")
        return room

    async def sweep(self, now: float | None = None) -> None:
        """Drop stale lobby seats and rooms nobody has been connected to for a while."""
        now = time.monotonic() if now is None else now
        for code, room in list(self.rooms.items()):
            if room.status == "lobby":
                for pid, seat in list(room.seats.items()):
                    if not seat.connected and now - seat.last_seen > LOBBY_SEAT_GRACE_S:
                        room.remove_seat(pid)
            idle = room.empty_since is not None and now - room.empty_since > ROOM_IDLE_TTL_S
            if idle or (room.practice and room.empty_since is not None and room.matches_played > 0):
                await room.close()
                self.rooms.pop(code, None)

    async def close_all(self) -> None:
        for room in list(self.rooms.values()):
            await room.close()
        self.rooms.clear()
