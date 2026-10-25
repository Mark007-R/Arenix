"""FastAPI application: HTTP API + realtime WebSockets."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import time
from collections import defaultdict, deque
from collections.abc import AsyncIterator
from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from ..engine.maps import available_maps, get_map
from ..engine.match import ARCHETYPES
from .protocol import (
    MAX_MESSAGE_BYTES,
    CreateRoomRequest,
    InputMsg,
    InteractMsg,
    JoinParams,
    JoinRoomRequest,
    PingMsg,
    ReadyMsg,
    SeatGrant,
    SetArchetypeMsg,
    SetFillMsg,
    StartMsg,
    client_message_adapter,
)
from .rooms import Connection, Room, RoomError, RoomManager, Seat

log = logging.getLogger("arenix")

MAX_INVALID_MESSAGES = 20
MAX_MESSAGES_PER_SECOND = 60
ROOM_CREATES_PER_MINUTE = 10
SWEEP_INTERVAL_S = 10.0

ERROR_STATUS = {"not_found": 404, "room_full": 409, "in_progress": 409, "busy": 503, "bad_archetype": 422}


def encode(msg: dict[str, Any]) -> str:
    return json.dumps(msg, separators=(",", ":"))


class RateLimiter:
    def __init__(self, limit: int, window_s: float) -> None:
        self.limit = limit
        self.window_s = window_s
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        q = self.hits[key]
        while q and now - q[0] > self.window_s:
            q.popleft()
        if len(q) >= self.limit:
            return False
        q.append(now)
        return True


def create_app() -> FastAPI:
    manager = RoomManager()
    creates = RateLimiter(ROOM_CREATES_PER_MINUTE, 60.0)

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        async def sweeper() -> None:
            while True:
                await asyncio.sleep(SWEEP_INTERVAL_S)
                await manager.sweep()

        task = asyncio.create_task(sweeper())
        try:
            yield
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
            await manager.close_all()

    app = FastAPI(title="ARENIX", version="0.2.0", lifespan=lifespan)
    app.state.rooms = manager
    origins = os.environ.get("ARENIX_CORS_ORIGINS", "http://localhost:3000").split(",")
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"], allow_headers=["*"])

    def http_error(e: RoomError) -> HTTPException:
        return HTTPException(status_code=ERROR_STATUS.get(e.code, 400), detail={"code": e.code, "message": str(e)})

    # ------------------------------------------------------------------ REST
    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/maps")
    async def maps() -> dict[str, list[str]]:
        return {"maps": available_maps()}

    @app.get("/api/maps/{map_id}")
    async def map_detail(map_id: str) -> dict[str, Any]:
        try:
            return get_map(map_id).to_dict()
        except KeyError:
            raise HTTPException(status_code=404, detail="map not found") from None

    @app.get("/api/archetypes")
    async def archetypes() -> dict[str, list[str]]:
        return {"archetypes": list(ARCHETYPES)}

    @app.post("/api/rooms", status_code=201)
    async def create_room(body: CreateRoomRequest, request: Request) -> SeatGrant:
        ip = request.client.host if request.client else "unknown"
        if not creates.allow(ip):
            raise HTTPException(status_code=429, detail={"code": "rate_limited", "message": "slow down"})
        try:
            room = manager.create(fill_to=body.fill_to)
            seat = room.add_seat(body.name, body.archetype)
        except RoomError as e:
            raise http_error(e) from None
        return SeatGrant(code=room.code, player_id=seat.player_id, token=seat.token)

    @app.post("/api/rooms/{code}/join")
    async def join_room(code: str, body: JoinRoomRequest) -> SeatGrant:
        try:
            room = manager.get(code)
            if room.practice:
                raise RoomError("not_found", "room not found")
            seat = room.add_seat(body.name, body.archetype)
        except RoomError as e:
            raise http_error(e) from None
        return SeatGrant(code=room.code, player_id=seat.player_id, token=seat.token)

    @app.get("/api/rooms/{code}")
    async def room_detail(code: str) -> dict[str, Any]:
        try:
            room = manager.get(code)
        except RoomError as e:
            raise http_error(e) from None
        if room.practice:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "room not found"})
        return room.lobby_message()

    # ------------------------------------------------------------------ realtime
    async def serve(ws: WebSocket, room: Room, seat: Seat) -> None:
        async def send_text(text: str) -> None:
            await ws.send_text(text)

        conn = Connection(send_text, encode)
        writer = asyncio.create_task(conn.writer())
        room.attach(seat, conn)
        if room.practice and room.status == "lobby" and room.matches_played == 0:
            room.start(None)
        invalid = 0
        window_start = time.monotonic()
        window_count = 0
        try:
            while not conn.closed:
                raw = await ws.receive_text()
                now = time.monotonic()
                if now - window_start >= 1.0:
                    window_start, window_count = now, 0
                window_count += 1
                if window_count > MAX_MESSAGES_PER_SECOND:
                    continue  # drop flood traffic
                if len(raw) > MAX_MESSAGE_BYTES:
                    invalid += 1
                else:
                    try:
                        msg = client_message_adapter.validate_python(json.loads(raw))
                    except (ValidationError, json.JSONDecodeError):
                        invalid += 1
                        msg = None
                    try:
                        if isinstance(msg, InputMsg):
                            room.handle_input(seat, msg.seq, msg.dx, msg.dy)
                        elif isinstance(msg, InteractMsg):
                            conn.push(room.handle_interact(seat, msg.target_id))
                        elif isinstance(msg, PingMsg):
                            conn.push({"type": "pong", "t": msg.t})
                        elif isinstance(msg, ReadyMsg):
                            room.set_ready(seat, msg.ready)
                        elif isinstance(msg, SetArchetypeMsg):
                            room.set_archetype(seat, msg.archetype)
                        elif isinstance(msg, SetFillMsg):
                            room.set_fill(seat, msg.fill_to)
                        elif isinstance(msg, StartMsg):
                            room.start(seat)
                    except RoomError as e:
                        conn.push({"type": "error", "code": e.code, "message": str(e)})
                if invalid > MAX_INVALID_MESSAGES:
                    await ws.close(code=4408, reason="too many invalid messages")
                    break
        except WebSocketDisconnect:
            pass
        finally:
            room.detach(seat, conn)
            writer.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await writer

    @app.websocket("/ws/rooms/{code}")
    async def room_socket(ws: WebSocket, code: str) -> None:
        token = ws.query_params.get("token", "")
        # Accept first so the browser receives a meaningful close code instead of a bare HTTP 403.
        await ws.accept()
        try:
            room = manager.get(code)
        except RoomError:
            await ws.close(code=4404, reason="room not found")
            return
        seat = room.seat_for_token(token) if token else None
        if seat is None:
            await ws.close(code=4401, reason="invalid seat token")
            return
        await serve(ws, room, seat)

    @app.websocket("/ws/practice")
    async def practice(ws: WebSocket) -> None:
        """Single-player practice: a private one-seat room that starts immediately."""
        try:
            params = JoinParams(
                name=ws.query_params.get("name", "Player"),
                archetype=ws.query_params.get("archetype", "knight"),
                bots=int(ws.query_params.get("bots", "2")),
            )
            if params.archetype not in ARCHETYPES:
                raise ValueError("unknown archetype")
            room = manager.create(fill_to=params.bots + 1, practice=True)
            seat = room.add_seat(params.name, params.archetype)
        except (ValidationError, ValueError, RoomError):
            await ws.accept()
            await ws.close(code=4400, reason="invalid join parameters")
            return
        await ws.accept()
        try:
            await serve(ws, room, seat)
        finally:
            await room.close()
            manager.rooms.pop(room.code, None)

    return app


app = create_app()
