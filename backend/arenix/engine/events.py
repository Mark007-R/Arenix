"""Append-only authoritative event log.

Every confirmed state change emits a GameEvent with a per-match sequential number. An event is
either public or visible only to a fixed set of contestants (whispers, alliance offers, secret
objectives). Every consumer, whether a client snapshot, a bot observation or a future replay
viewer, must read through `visible_since` so private events never reach the wrong contestant.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class GameEvent:
    seq: int
    tick: int
    type: str
    data: dict[str, Any] = field(default_factory=dict)
    visible_to: frozenset[str] | None = None  # None = public

    def visible(self, viewer: str | None) -> bool:
        """viewer=None is the omniscient server/replay view."""
        return self.visible_to is None or viewer is None or viewer in self.visible_to

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"seq": self.seq, "tick": self.tick, "type": self.type, "data": self.data}
        if self.visible_to is not None:
            d["private"] = True
        return d


class EventLog:
    def __init__(self) -> None:
        self._events: list[GameEvent] = []

    def append(self, tick: int, type_: str, visible_to: frozenset[str] | None = None, **data: Any) -> GameEvent:
        event = GameEvent(len(self._events) + 1, tick, type_, data, visible_to)
        self._events.append(event)
        return event

    def since(self, seq: int) -> list[GameEvent]:
        """All events after `seq` (omniscient). Use visible_since for anything player-facing."""
        return self._events[seq:]

    def visible_since(self, seq: int, viewer: str | None) -> list[GameEvent]:
        return [e for e in self._events[seq:] if e.visible(viewer)]

    def __len__(self) -> int:
        return len(self._events)

    def __iter__(self) -> Iterator[GameEvent]:
        return iter(self._events)
