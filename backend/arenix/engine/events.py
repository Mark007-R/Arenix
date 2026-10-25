"""Append-only authoritative event log.

Every confirmed state change emits a GameEvent with a per-match sequential number. Later
milestones persist this log transactionally and rebuild replays from it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class GameEvent:
    seq: int
    tick: int
    type: str
    data: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"seq": self.seq, "tick": self.tick, "type": self.type, "data": self.data}


class EventLog:
    def __init__(self) -> None:
        self._events: list[GameEvent] = []

    def append(self, tick: int, type_: str, **data: Any) -> GameEvent:
        event = GameEvent(len(self._events) + 1, tick, type_, data)
        self._events.append(event)
        return event

    def since(self, seq: int) -> list[GameEvent]:
        return self._events[seq:]

    def __len__(self) -> int:
        return len(self._events)

    def __iter__(self):  # type: ignore[no-untyped-def]
        return iter(self._events)
