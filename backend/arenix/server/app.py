"""FastAPI application: HTTP API + realtime WebSocket."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from ..engine.maps import available_maps, get_map
from ..engine.match import ARCHETYPES
from .protocol import MAX_MESSAGE_BYTES, InputMsg, InteractMsg, JoinParams, PingMsg, client_message_adapter
from .session import PracticeSession, encode

log = logging.getLogger("arenix")

MAX_INVALID_MESSAGES = 20
MAX_MESSAGES_PER_SECOND = 60


def create_app() -> FastAPI:
    app = FastAPI(title="ARENIX", version="0.1.0")
    origins = os.environ.get("ARENIX_CORS_ORIGINS", "http://localhost:3000").split(",")
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"], allow_headers=["*"])

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

    @app.websocket("/ws/practice")
    async def practice(ws: WebSocket) -> None:
        try:
            params = JoinParams(
                name=ws.query_params.get("name", "Player"),
                archetype=ws.query_params.get("archetype", "knight"),
                bots=int(ws.query_params.get("bots", "2")),
            )
            if params.archetype not in ARCHETYPES:
                raise ValueError("unknown archetype")
        except (ValidationError, ValueError):
            await ws.close(code=4400, reason="invalid join parameters")
            return

        await ws.accept()
        session = PracticeSession(params.name, params.archetype, params.bots)
        stop = asyncio.Event()
        send_lock = asyncio.Lock()

        async def send(msg: dict[str, Any]) -> None:
            async with send_lock:
                await ws.send_text(encode(msg))

        await send(session.welcome())
        loop_task = asyncio.create_task(session.run(send, stop))
        invalid = 0
        window_start = asyncio.get_running_loop().time()
        window_count = 0
        try:
            while True:
                receive = asyncio.create_task(ws.receive_text())
                done, _ = await asyncio.wait({receive, loop_task}, return_when=asyncio.FIRST_COMPLETED)
                if receive not in done:
                    receive.cancel()
                    break  # match finished; keep the socket open briefly for the final snapshot
                raw = receive.result()

                now = asyncio.get_running_loop().time()
                if now - window_start >= 1.0:
                    window_start, window_count = now, 0
                window_count += 1
                if window_count > MAX_MESSAGES_PER_SECOND:
                    continue  # silently drop flood traffic

                if len(raw) > MAX_MESSAGE_BYTES:
                    invalid += 1
                else:
                    try:
                        msg = client_message_adapter.validate_python(json.loads(raw))
                    except (ValidationError, json.JSONDecodeError):
                        invalid += 1
                        msg = None
                    if isinstance(msg, InputMsg):
                        session.match.queue_input(session.player_id, msg.seq, msg.dx, msg.dy)
                    elif isinstance(msg, InteractMsg):
                        result = session.match.interact(session.player_id, msg.target_id)
                        await send(
                            {
                                "type": "interact_result",
                                "target_id": msg.target_id,
                                "ok": result.ok,
                                "reason": result.reason,
                            }
                        )
                    elif isinstance(msg, PingMsg):
                        await send({"type": "pong", "t": msg.t})
                if invalid > MAX_INVALID_MESSAGES:
                    await ws.close(code=4408, reason="too many invalid messages")
                    break
        except WebSocketDisconnect:
            pass
        finally:
            stop.set()
            loop_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await loop_task

    return app


app = create_app()
