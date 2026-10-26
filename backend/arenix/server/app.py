"""FastAPI application: HTTP API + realtime WebSockets."""

from __future__ import annotations

import asyncio
import contextlib
import hmac
import json
import logging
import os
import time
from collections import defaultdict, deque
from collections.abc import AsyncIterator
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError
from sqlalchemy import select

from ..db.session import Database, database_from_env
from ..economy import service as economy
from ..engine.maps import available_maps, get_map
from ..engine.match import ARCHETYPES
from . import auth_api
from .economy_api import bearer
from .economy_api import router as economy_router
from .protocol import (
    MAX_MESSAGE_BYTES,
    AbilityMsg,
    BreakMsg,
    ChatMsg,
    CreateRoomRequest,
    ExperimentRequest,
    InputMsg,
    InteractMsg,
    JoinParams,
    JoinRoomRequest,
    KillMsg,
    PingMsg,
    ProposeMsg,
    ReadyMsg,
    ReportMsg,
    RespondMsg,
    SabotageMsg,
    SeatGrant,
    SetArchetypeMsg,
    SetFillMsg,
    SetMapMsg,
    ShootMsg,
    StartMsg,
    VoteMsg,
    client_message_adapter,
)
from .rooms import Connection, Room, RoomError, RoomManager, Seat

log = logging.getLogger("arenix")

MAX_INVALID_MESSAGES = 20
MAX_MESSAGES_PER_SECOND = 60
ROOM_CREATES_PER_MINUTE = 10
SWEEP_INTERVAL_S = 10.0

ERROR_STATUS = {
    "not_found": 404,
    "room_full": 409,
    "in_progress": 409,
    "busy": 503,
    "bad_archetype": 422,
    "already_joined": 409,
}


def encode(msg: dict[str, Any]) -> str:
    return json.dumps(msg, separators=(",", ":"))


class RateLimiter:
    def __init__(self, limit: int, window_s: float) -> None:
        self.limit = limit
        self.window_s = window_s
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def _prune(self, key: str, now: float) -> deque[float]:
        if len(self.hits) > 20_000:  # bound memory under many distinct keys (IPs, emails)
            for k in [k for k, q in self.hits.items() if not q or now - q[-1] > self.window_s]:
                del self.hits[k]
        q = self.hits[key]
        while q and now - q[0] > self.window_s:
            q.popleft()
        return q

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        q = self._prune(key, now)
        if len(q) >= self.limit:
            return False
        q.append(now)
        return True

    def allow_check(self, key: str) -> bool:
        """Would `allow` succeed? Does not count a hit (used to lock out after failures)."""
        return len(self._prune(key, time.monotonic())) < self.limit


_FROM_ENV = object()


def create_app(db: Database | None | object = _FROM_ENV) -> FastAPI:
    database: Database | None = database_from_env() if db is _FROM_ENV else db  # type: ignore[assignment]
    manager = RoomManager(db=database)
    creates = RateLimiter(ROOM_CREATES_PER_MINUTE, 60.0)

    # Single-use, short-lived WebSocket tickets so bearer tokens never appear in URLs (and logs).
    ws_tickets: dict[str, tuple[int, float]] = {}

    def redeem_ticket(ticket: str) -> int | None:
        now = time.monotonic()
        for k in [k for k, (_, exp) in ws_tickets.items() if exp < now]:
            ws_tickets.pop(k, None)
        entry = ws_tickets.pop(ticket, None)
        return entry[0] if entry else None

    def origin_allowed(ws: WebSocket) -> bool:
        origin = ws.headers.get("origin")
        return origin is None or origin in origins  # non-browser clients send no Origin

    admin_token = os.environ.get("ARENIX_ADMIN_TOKEN", "")

    async def identify(token: str) -> tuple[int | None, dict[str, Any]]:
        """Resolve an optional account token to (user_id, server-side cosmetic loadout)."""
        if database is None or not token:
            return None, {}
        async with database.sessions() as s:
            user = await economy.user_for_token(s, token)
            if user is None:
                raise HTTPException(401, detail={"code": "unauthorized", "message": "invalid account token"})
            return user.id, await economy.loadout(s, user.id)

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        async def sweeper() -> None:
            while True:
                await asyncio.sleep(SWEEP_INTERVAL_S)
                await manager.sweep()

        if database is not None:
            async with database.sessions.begin() as s:
                await economy.seed_catalog(s)  # server-side catalog is the source of truth
        task = asyncio.create_task(sweeper())
        try:
            yield
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
            await manager.close_all()
            if database is not None:
                await database.dispose()

    app = FastAPI(title="ARENIX", version="0.2.0", lifespan=lifespan)
    app.state.rooms = manager
    app.state.db = database
    app.state.guest_limiter = RateLimiter(5, 60.0)
    app.state.open_limiter = RateLimiter(30, 60.0)
    app.state.register_limiter = RateLimiter(5, 60.0)
    app.state.login_limiter = RateLimiter(20, 60.0)
    app.state.login_failures = RateLimiter(auth_api.LOGIN_FAILURES_PER_EMAIL, 15 * 60.0)
    app.include_router(economy_router)
    app.include_router(auth_api.router)

    @app.middleware("http")
    async def security_headers(request: Request, call_next: Any) -> Any:
        response = await call_next(request)
        h = response.headers
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        if request.url.path.startswith("/api/"):
            h.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
            h.setdefault("X-Frame-Options", "DENY")
            if request.url.path.startswith(("/api/auth", "/api/players", "/api/store", "/api/admin")):
                h["Cache-Control"] = "no-store"
        return response

    @app.post("/api/auth/ws-ticket")
    async def ws_ticket(authorization: str | None = Header(default=None)) -> dict[str, Any]:
        user_id, _ = await identify(bearer(authorization))
        if user_id is None:
            raise HTTPException(401, detail={"code": "unauthorized", "message": "Sign in first."})
        import secrets as _secrets

        ticket = _secrets.token_urlsafe(24)
        ws_tickets[ticket] = (user_id, time.monotonic() + 60)
        return {"ticket": ticket, "expires_in": 60}

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

    # ------------------------------------------------------------------ experiments
    from ..sim.experiments import ExperimentService

    experiments = ExperimentService(database)
    app.state.experiments = experiments

    @app.post("/api/experiments", status_code=202)
    async def create_experiment(
        body: ExperimentRequest, authorization: str | None = Header(default=None)
    ) -> dict[str, Any]:
        # Experiments are CPU-heavy: when an admin token is configured, require it.
        if admin_token and not hmac.compare_digest(bearer(authorization), admin_token):
            raise HTTPException(403, detail={"code": "forbidden", "message": "admin token required"})
        try:
            return await experiments.start(
                body.name, body.conditions, body.seed_list(), body.contestants, body.time_limit_seconds
            )
        except ValueError as e:
            raise HTTPException(422, detail={"code": "invalid_experiment", "message": str(e)}) from None
        except RuntimeError as e:
            raise HTTPException(409, detail={"code": "busy", "message": str(e)}) from None

    @app.get("/api/experiments")
    async def list_experiments() -> dict[str, Any]:
        return {"experiments": experiments.list(), "running": experiments.running}

    @app.get("/api/experiments/{exp_id}/results")
    async def experiment_results(exp_id: int) -> dict[str, Any]:
        item = experiments.get(exp_id)
        if item is None:
            raise HTTPException(404, detail={"code": "not_found", "message": "experiment not found"})
        return item

    # ------------------------------------------------------------------ Agent Lab
    def live_matches() -> list[tuple[Any, Any, str]]:
        out = []
        for room in manager.rooms.values():
            for match, coord in room.history:
                out.append((match, coord, room.code))
        return out

    @app.get("/api/agent-lab/matches")
    async def lab_matches() -> dict[str, Any]:
        items: dict[str, dict[str, Any]] = {}
        for match, coord, code in live_matches():
            items[match.id] = {
                "id": match.id,
                "room_code": code,
                "status": match.status,
                "ticks": match.tick,
                "source": "live",
                "contestants": len(match.contestants),
                "ai_mode": coord.gateway.provider.name if coord else "rules",
            }
        if database is not None:
            from ..db.models import MatchRow

            async with database.sessions() as s:
                rows = (await s.scalars(select(MatchRow).order_by(MatchRow.finished_at.desc()).limit(30))).all()
                for r in rows:
                    items.setdefault(
                        r.id,
                        {
                            "id": r.id,
                            "room_code": r.room_code,
                            "status": "finished",
                            "ticks": r.ticks,
                            "source": "database",
                            "ai_mode": r.ai_mode,
                            "contestants": len(r.result.get("standings", [])),
                        },
                    )
        return {"matches": sorted(items.values(), key=lambda m: m["id"], reverse=True)}

    def is_admin(authorization: str | None) -> bool:
        import hmac

        return bool(admin_token) and hmac.compare_digest(bearer(authorization), admin_token)

    def require_admin(authorization: str | None) -> None:
        if not is_admin(authorization):
            raise HTTPException(403, detail={"code": "forbidden", "message": "admin token required"})

    async def store_report(report: dict[str, Any]) -> None:
        if database is None:
            manager.memory_reports.append({**report, "id": len(manager.memory_reports) + 1, "status": "open"})
            return
        from ..db.models import PlayerReport

        async with database.sessions.begin() as s:
            s.add(PlayerReport(**{k: v for k, v in report.items() if k != "reported_is_bot"}, status="open"))

    @app.get("/api/admin/reports")
    async def admin_reports(status: str = "open", authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_admin(authorization)
        if database is None:
            return {"reports": [r for r in manager.memory_reports if r["status"] == status]}
        from ..db.models import PlayerReport

        async with database.sessions() as s:
            rows = (
                await s.scalars(
                    select(PlayerReport)
                    .where(PlayerReport.status == status)
                    .order_by(PlayerReport.created_at.desc())
                    .limit(200)
                )
            ).all()
        return {
            "reports": [
                {
                    "id": r.id,
                    "match_id": r.match_id,
                    "reported_name": r.reported_name,
                    "reported_user_id": r.reported_user_id,
                    "reporter_user_id": r.reporter_user_id,
                    "reason": r.reason,
                    "note": r.note,
                    "evidence": r.evidence,
                    "status": r.status,
                    "created_at": r.created_at.isoformat(),
                }
                for r in rows
            ]
        }

    @app.post("/api/admin/reports/{report_id}")
    async def admin_review(
        report_id: int, body: dict[str, str], authorization: str | None = Header(default=None)
    ) -> dict[str, Any]:
        require_admin(authorization)
        status = body.get("status")
        if status not in ("reviewed", "dismissed", "open"):
            raise HTTPException(
                422, detail={"code": "bad_status", "message": "status must be reviewed, dismissed or open"}
            )
        if database is None:
            for r in manager.memory_reports:
                if r["id"] == report_id:
                    r["status"] = status
                    return {"ok": True}
            raise HTTPException(404, detail={"code": "not_found", "message": "report not found"})
        from ..db.models import PlayerReport

        async with database.sessions.begin() as s:
            row = await s.get(PlayerReport, report_id)
            if row is None:
                raise HTTPException(404, detail={"code": "not_found", "message": "report not found"})
            row.status = status
        return {"ok": True}

    @app.get("/api/agent-lab/matches/{match_id}")
    async def lab_match(match_id: str, authorization: str | None = Header(default=None)) -> dict[str, Any]:
        from ..lab import payload_from_live, redact_private_human_chat

        def privacy(payload: dict[str, Any]) -> dict[str, Any]:
            return payload if is_admin(authorization) else redact_private_human_chat(payload)

        for match, coord, code in live_matches():
            if match.id == match_id:
                return privacy(payload_from_live(match, coord, code))
        if database is not None:
            from ..lab_db import payload_from_db

            async with database.sessions() as s:
                payload = await payload_from_db(s, match_id)
            if payload is not None:
                return privacy(payload)
        raise HTTPException(404, detail={"code": "not_found", "message": "match not found"})

    @app.post("/api/rooms", status_code=201)
    async def create_room(
        body: CreateRoomRequest, request: Request, authorization: str | None = Header(default=None)
    ) -> SeatGrant:
        ip = request.client.host if request.client else "unknown"
        if not creates.allow(ip):
            raise HTTPException(status_code=429, detail={"code": "rate_limited", "message": "slow down"})
        user_id, loadout = await identify(bearer(authorization))
        try:
            room = manager.create(fill_to=body.fill_to)
            seat = room.add_seat(body.name, body.archetype, user_id, loadout)
        except RoomError as e:
            raise http_error(e) from None
        return SeatGrant(code=room.code, player_id=seat.player_id, token=seat.token)

    @app.post("/api/rooms/{code}/join")
    async def join_room(
        code: str, body: JoinRoomRequest, authorization: str | None = Header(default=None)
    ) -> SeatGrant:
        user_id, loadout = await identify(bearer(authorization))
        try:
            room = manager.get(code)
            if room.practice:
                raise RoomError("not_found", "room not found")
            seat = room.add_seat(body.name, body.archetype, user_id, loadout)
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
                    reply: dict[str, Any] | None = None
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
                        elif isinstance(msg, ChatMsg):
                            reply = room.handle_action(seat, "chat", text=msg.text, quick=msg.quick, to=msg.to)
                        elif isinstance(msg, VoteMsg):
                            reply = room.handle_action(seat, "vote", target=msg.target)
                        elif isinstance(msg, ProposeMsg):
                            reply = room.handle_action(seat, "propose", target=msg.target)
                        elif isinstance(msg, RespondMsg):
                            reply = room.handle_action(seat, "respond", proposer=msg.proposer, accept=msg.accept)
                        elif isinstance(msg, BreakMsg):
                            reply = room.handle_action(seat, "break")
                        elif isinstance(msg, SetMapMsg):
                            room.set_map(seat, msg.map_id)
                        elif isinstance(msg, ShootMsg):
                            reply = room.handle_action(seat, "shoot", target=msg.target)
                        elif isinstance(msg, SabotageMsg):
                            reply = room.handle_action(seat, "sabotage", what=msg.kind)
                        elif isinstance(msg, KillMsg):
                            reply = room.handle_action(seat, "kill", target=msg.target)
                        elif isinstance(msg, AbilityMsg):
                            reply = room.handle_action(seat, "ability", target=msg.target)
                        elif isinstance(msg, ReportMsg):
                            report = room.build_report(seat, msg.target, msg.reason, msg.note)
                            await store_report(report)
                            reply = {"type": "report_ack", "target": msg.target}
                        if reply is not None:
                            conn.push(reply)
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
        if not origin_allowed(ws):
            await ws.close(code=4403, reason="origin not allowed")
            return
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
        if not origin_allowed(ws):
            await ws.accept()
            await ws.close(code=4403, reason="origin not allowed")
            return
        try:
            params = JoinParams(
                name=ws.query_params.get("name", "Player"),
                archetype=ws.query_params.get("archetype", "knight"),
                bots=int(ws.query_params.get("bots", "2")),
            )
            if params.archetype not in ARCHETYPES:
                raise ValueError("unknown archetype")
            # Browsers can't set headers on WebSockets: accounts authenticate with a single-use ticket.
            user_id, loadout = None, {}
            ticket = ws.query_params.get("ticket", "")
            if ticket:
                user_id = redeem_ticket(ticket)
                if user_id is None:
                    raise ValueError("invalid or expired ticket")
                if database is not None:
                    async with database.sessions() as s:
                        loadout = await economy.loadout(s, user_id)
            room = manager.create(fill_to=params.bots + 1, practice=True)
            seat = room.add_seat(params.name, params.archetype, user_id, loadout)
        except (ValidationError, ValueError, RoomError, HTTPException):
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
