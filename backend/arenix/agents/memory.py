"""Bounded per-agent memory. Facts (confirmed events) and claims (messages) are kept apart."""

from __future__ import annotations

from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from ..engine.events import GameEvent

MAX_FACTS = 30
MAX_CLAIMS = 20


@dataclass
class Thread:
    correlation_id: str
    opened_by: str
    with_: set[str]
    msg_type: str
    plan: str | None
    status: str = "open"  # open | accepted | rejected | countered
    rounds: int = 1
    public: bool = False
    expires_tick: int = 0
    replied: bool = False  # this agent already answered


@dataclass
class AgentMemory:
    facts: deque[str] = field(default_factory=lambda: deque(maxlen=MAX_FACTS))
    claims: deque[dict[str, Any]] = field(default_factory=lambda: deque(maxlen=MAX_CLAIMS))
    threads: dict[str, Thread] = field(default_factory=dict)
    agreements: list[str] = field(default_factory=list)
    # Targets whose alliance offer the engine refused recently (e.g. they are secretly allied).
    offer_refused: dict[str, int] = field(default_factory=dict)
    betrayals: list[str] = field(default_factory=list)

    def ingest(self, me: str, ev: GameEvent, names: dict[str, str]) -> bool:
        """Record an event this agent was allowed to see. Returns True if it should trigger a decision."""
        d = ev.data

        def n(cid: Any) -> str:
            return names.get(str(cid), str(cid))

        t = ev.type
        if t == "chat":
            claim = {
                "from": d["sender"],
                "from_name": n(d["sender"]),
                "type": d.get("kind") or "CHAT",
                "text": d["text"],
                "private": d["private"],
                "correlation_id": d.get("correlation_id"),
                "plan": (d.get("payload") or {}).get("plan"),
            }
            if d["sender"] != me:
                self.claims.append(claim)
            cid = d.get("correlation_id")
            kind = d.get("kind")
            if cid and kind:
                th = self.threads.get(cid)
                if th is None:
                    th = Thread(
                        cid,
                        d["sender"],
                        {d["sender"], *([d["to"]] if d.get("to") else [])},
                        kind,
                        claim["plan"],
                        public=d.get("to") is None,
                        expires_tick=int(d.get("expires_tick", 0)),
                    )
                    self.threads[cid] = th
                else:
                    if d["sender"] == me:
                        th.replied = True
                    th.rounds += 1
                    th.with_.add(d["sender"])
                    th.status = {"ACCEPT": "accepted", "REJECT": "rejected", "COUNTER_OFFER": "countered"}.get(
                        kind, th.status
                    )
                    if kind == "ACCEPT":
                        self.agreements.append(f"{n(d['sender'])} accepted '{th.plan or th.msg_type}'")
            addressed = d.get("to") == me or (cid in self.threads and me in self.threads[cid].with_)
            return d["sender"] != me and (addressed or bool(kind in ("PLAN_PROPOSAL", "ACTION_PROPOSAL")))
        if t in ("resource_gathered", "resource_regenerated", "vote_cast"):
            return False
        line = describe(ev, n)
        if line:
            self.facts.append(f"[t{ev.tick}] {line}")
        if t == "alliance_broken" and d["reason"] == "betrayal":
            self.betrayals.append(f"{n(d['by'])} betrayed {n(d['partner'])}")
        return t in ("alliance_proposed", "shrine_channel", "meeting_called", "vote_started") and (
            t != "alliance_proposed" or d.get("target") == me
        )

    def answerable(self, me: str, correlation_id: str | None, tick: int) -> bool:
        th = self.threads.get(correlation_id or "")
        return (
            th is not None
            and th.expires_tick > tick
            and not th.replied
            and th.opened_by != me
            and th.status in ("open", "countered")
            and (th.public or me in th.with_)
        )

    def open_threads(self, me: str, tick: int) -> list[dict[str, Any]]:
        return [
            {
                "correlation_id": th.correlation_id,
                "opened_by": th.opened_by,
                "type": th.msg_type,
                "plan": th.plan,
                "status": th.status,
                "rounds": th.rounds,
                "you_already_replied": th.replied,
                "public": th.public,
            }
            for th in self.threads.values()
            if th.expires_tick > tick
            and th.status in ("open", "countered")
            and (th.public or me in th.with_ | {th.opened_by})
        ][-6:]


def describe(ev: GameEvent, n: Callable[[Any], str]) -> str | None:
    d = ev.data
    t = ev.type
    if t == "resources_delivered":
        acc = ", ".join(f"{v} {k}" for k, v in d["accepted"].items() if v)
        return f"{n(d['contestant'])} delivered {acc or 'nothing useful'}"
    if t == "mission_completed":
        return "the Watchtower was repaired"
    if t == "shrine_channel":
        return f"{n(d['contestant'])} is channeling at the shrine ({d['count']}/{d['required']})"
    if t == "shrine_activated":
        return "the shrine was activated by " + ", ".join(n(p) for p in d["participants"])
    if t == "shrine_fizzled":
        return "a shrine ritual fizzled"
    if t == "meeting_called":
        return "council meeting called" + (f" by {n(d['caller'])}" if d.get("caller") else "")
    if t == "vote_resolved":
        votes = ", ".join(f"{n(v)}→{'skip' if t_ == 'skip' else n(t_)}" for v, t_ in d["votes"].items())
        out = n(d["eliminated"]) if d.get("eliminated") else "nobody"
        return f"vote result: {out} eliminated ({votes})"
    if t == "contestant_eliminated":
        return f"{n(d['contestant'])} was eliminated"
    if t == "alliance_formed":
        return "alliance formed: " + " & ".join(n(m) for m in d["members"])
    if t == "alliance_broken":
        return f"{n(d['by'])} broke the alliance with {n(d['partner'])} ({d['reason']})"
    if t == "alliance_proposed":
        return f"{n(d['proposer'])} proposed an alliance to {n(d['target'])}"
    if t == "alliance_rejected":
        return f"{n(d['target'])} rejected {n(d['proposer'])}'s alliance"
    if t == "objective_assigned":
        return f"your secret objective: {d['objective']['text']}"
    return None
