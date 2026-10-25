"""Rebuild match state from the event log alone (no simulation, no model calls).

`replay(events)` folds authoritative events into a ReplayState. The tests prove that folding a
match's full log reproduces the live match's final scores, survival, mission progress, shrine
and alliance state exactly. The frontend's Agent Lab uses an equivalent TypeScript reducer.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from .events import GameEvent


@dataclass
class ReplayState:
    tick: int = 0
    seq: int = 0
    phase: str = "explore"
    meeting: int = 0
    contestants: list[str] = field(default_factory=list)
    scores: dict[str, int] = field(default_factory=dict)
    alive: dict[str, bool] = field(default_factory=dict)
    delivered: dict[str, int] = field(default_factory=lambda: {"wood": 0, "stone": 0})
    required: dict[str, int] = field(default_factory=dict)
    tower_repaired: bool = False
    shrine: str = "dormant"
    alliances: dict[str, str] = field(default_factory=dict)
    positions: dict[str, list[float]] = field(default_factory=dict)
    last_votes: dict[str, str] = field(default_factory=dict)
    finished: bool = False
    winner: str | None = None
    beacons: dict[str, bool] = field(default_factory=dict)
    winning_team: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {k: (dict(v) if isinstance(v, dict) else v) for k, v in self.__dict__.items()}


def apply(state: ReplayState, ev: GameEvent) -> None:
    d = ev.data
    state.tick, state.seq = ev.tick, ev.seq
    t = ev.type

    def add(cid: str, points: int) -> None:
        state.scores[cid] = state.scores.get(cid, 0) + int(points)

    if t == "match_started":
        state.contestants = list(d["contestants"])
        state.scores = dict.fromkeys(state.contestants, 0)
        state.alive = dict.fromkeys(state.contestants, True)
        state.required = dict(d["required"])
        state.beacons = dict.fromkeys(d.get("beacons", []), False)
    elif t == "resources_delivered":
        add(d["contestant"], d["points"])
        state.delivered = dict(d["delivered"])
    elif t == "ally_dividend":
        add(d["contestant"], d["points"])
    elif t == "mission_completed":
        state.tower_repaired = True
        for cid in d["contributions"]:
            add(cid, d["bonus"])
    elif t == "shrine_channel":
        state.shrine = "channeling"
    elif t == "shrine_fizzled":
        state.shrine = "dormant"
    elif t == "shrine_activated":
        state.shrine = "activated"
        for cid in d["participants"]:
            add(cid, d["bonus"])
    elif t == "meeting_called":
        state.phase, state.meeting = "discuss", int(d["meeting"])
    elif t == "vote_started":
        state.phase = "vote"
    elif t == "vote_resolved":
        state.phase = "reveal"
        state.last_votes = dict(d["votes"])
    elif t == "meeting_ended":
        state.phase = "explore"
    elif t == "contestant_killed":
        add(d["killer"], d["points"])
        state.alive[d["victim"]] = False
        state.positions.pop(d["victim"], None)
        partner = state.alliances.pop(d["victim"], None)
        if partner:
            state.alliances.pop(partner, None)
    elif t == "beacon_lit":
        state.beacons[d["beacon"]] = True
        add(d["contestant"], d["points"])
    elif t == "contestant_eliminated":
        state.alive[d["contestant"]] = False
        state.positions.pop(d["contestant"], None)
        partner = state.alliances.pop(d["contestant"], None)
        if partner:
            state.alliances.pop(partner, None)
    elif t == "alliance_formed":
        a, b = d["members"]
        state.alliances[a], state.alliances[b] = b, a
    elif t == "alliance_broken":
        state.alliances.pop(d["by"], None)
        state.alliances.pop(d["partner"], None)
    elif t == "position_sample":
        state.positions = {k: list(v) for k, v in d["positions"].items()}
    elif t == "match_finished":
        state.finished = True
        state.winner = d["winner"]
        state.winning_team = d.get("winning_team")
        for st in d["standings"]:
            add(st["id"], sum(st["bonuses"].values()))


def replay(events: Iterable[GameEvent], upto_seq: int | None = None) -> ReplayState:
    state = ReplayState()
    for ev in events:
        if upto_seq is not None and ev.seq > upto_seq:
            break
        apply(state, ev)
    return state
