"""Practice session: one human, N rule-based bots, one authoritative match loop.

Milestone 2 replaces this with shared rooms (codes, lobby, multiple humans, reconnect).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import secrets
import time
from collections.abc import Awaitable, Callable
from typing import Any

from ..engine import physics
from ..engine.maps import get_map
from ..engine.match import ARCHETYPES, INTERACT_RANGE, Match

log = logging.getLogger(__name__)

BOT_NAMES = ["Brakka", "Lyra", "Fennick", "Morwen", "Tobble", "Sir Aldric", "Quill"]

Send = Callable[[dict[str, Any]], Awaitable[None]]


class PracticeSession:
    def __init__(self, player_name: str, archetype: str, bots: int, seed: int | None = None) -> None:
        self.seed = seed if seed is not None else secrets.randbits(32)
        self.match = Match(
            f"practice-{secrets.token_hex(4)}", get_map("emerald_isle"), self.seed, time_limit_seconds=240
        )
        self.player_id = "p1"
        self.match.add_contestant(self.player_id, player_name, archetype, is_bot=False)
        bot_archetypes = [a for a in ARCHETYPES if a != archetype]
        for i in range(bots):
            self.match.add_contestant(f"bot{i + 1}", BOT_NAMES[i], bot_archetypes[i % len(bot_archetypes)], True)
        self._sent_events = 0

    def welcome(self) -> dict[str, Any]:
        return {
            "type": "welcome",
            "you": self.player_id,
            "match_id": self.match.id,
            "map": self.match.map.to_dict(),
            "constants": {
                "tick_rate": physics.TICK_RATE,
                "speed": physics.SPEED,
                "half_w": physics.HALF_W,
                "half_h": physics.HALF_H,
                "interact_range": INTERACT_RANGE,
            },
            "snapshot": self.match.snapshot(),
        }

    def snapshot_message(self) -> dict[str, Any]:
        events = self.match.events.since(self._sent_events)
        self._sent_events = len(self.match.events)
        me = self.match.contestants[self.player_id]
        return {
            "type": "snapshot",
            "ack_seq": me.last_ack_seq,
            "events": [e.to_dict() for e in events],
            **self.match.snapshot(),
        }

    async def run(self, send: Send, stop: asyncio.Event) -> None:
        """Fixed-rate tick loop. Sends one snapshot per tick until the match ends or stop is set."""
        self.match.start()
        interval = physics.DT
        next_tick = time.perf_counter()
        while not stop.is_set():
            self.match.step()
            await send(self.snapshot_message())
            if self.match.status == "finished":
                break
            next_tick += interval
            delay = next_tick - time.perf_counter()
            if delay < -0.25:  # fell badly behind (e.g. debugger); resync instead of bursting
                next_tick = time.perf_counter()
                delay = 0
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), timeout=max(0.0, delay))


def encode(msg: dict[str, Any]) -> str:
    return json.dumps(msg, separators=(",", ":"))
