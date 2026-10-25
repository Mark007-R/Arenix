"""Match coordinator for strategist agents.

Runs alongside the authoritative tick loop without ever blocking it:

* each tick, feeds every agent's newly visible events into its memory and detects triggers
  (an offer or message addressed to it, a ritual starting, a meeting/vote opening, a periodic beat);
* launches at most one in-flight strategist call per agent (asyncio task, gateway timeout);
* when a decision arrives, discards it if stale, pre-validates each action against the agent's
  authorised state, and queues the legal ones into the bot. The engine validates them again;
* records every decision (input context, proposal, validation, engine outcome, cost) for the
  Agent Lab;
* falls back to the deterministic policy whenever the gateway is unavailable (budget, breaker).
"""

from __future__ import annotations

import asyncio
import contextlib
import itertools
from dataclasses import asdict, dataclass, field
from typing import Any

from ..engine import physics
from ..engine.match import Match
from .context import SYSTEM_PROMPT, build_context, personality_text, render_user_prompt
from .gateway import GatewayResult, LLMGateway
from .memory import AgentMemory
from .schema import DecisionAction, StrategicDecision

DECISION_INTERVAL_S = 15
MIN_GAP_S = 4
STALE_AFTER_S = 12
GOAL_HINT_S = 30
MAX_RECORDS = 400


@dataclass
class DecisionRecord:
    id: int
    agent: str
    trigger: str
    phase_id: str
    tick_requested: int
    status: str = "pending"  # pending | applied | stale | failed
    tick_resolved: int | None = None
    context: dict[str, Any] | None = None
    decision: dict[str, Any] | None = None
    actions: list[dict[str, Any]] = field(default_factory=list)  # proposal + pre-validation
    engine_results: list[dict[str, Any]] = field(default_factory=list)  # authoritative outcome
    provider: str = ""
    model: str = ""
    is_llm: bool = False
    latency_ms: float = 0.0
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float | None = 0.0
    attempts: int = 0
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class AgentCoordinator:
    def __init__(self, match: Match, gateway: LLMGateway, agent_ids: list[str]) -> None:
        self.match = match
        self.gateway = gateway
        self.agents = [a for a in agent_ids if a in match.bots]
        self.memory = {a: AgentMemory() for a in self.agents}
        self.cursor = dict.fromkeys(self.agents, 0)
        self.next_due: dict[str, int] = {}
        self.last_call: dict[str, int] = {}
        self.last_phase: dict[str, str] = {}
        self.pending_trigger: dict[str, str] = {}
        self.inflight: dict[str, tuple[asyncio.Task[GatewayResult], DecisionRecord]] = {}
        self.records: list[DecisionRecord] = []
        self.awaiting_engine: dict[str, list[DecisionRecord]] = {a: [] for a in self.agents}
        self._ids = itertools.count(1)
        self._result_cursor = 0
        self.fallback_reason: str | None = None
        for i, a in enumerate(self.agents):
            match.bots[a].social_mode = "external"
            # Stagger the periodic beat so agents don't all call at once.
            self.next_due[a] = (i * 3 + 2) * physics.TICK_RATE

    # ------------------------------------------------------------------ tick
    def tick(self) -> None:
        m = self.match
        if m.status != "running":
            return
        self._collect_finished()
        self._link_engine_results()
        unavailable = self.gateway.available
        if unavailable and self.fallback_reason is None:
            self.fallback_reason = unavailable
            for a in self.agents:
                m.bots[a].social_mode = "fallback"  # whole match falls back to the deterministic policy
        names = m.names()
        for a in self.agents:
            if not m.contestants[a].alive:
                continue
            events = m.events.visible_since(self.cursor[a], a)
            self.cursor[a] = len(m.events)
            for ev in events:
                if self.memory[a].ingest(a, ev, names):
                    self.pending_trigger.setdefault(a, ev.type)
            pid = m.phase_id()
            if self.last_phase.get(a) != pid:
                self.last_phase[a] = pid
                if m.phase in ("discuss", "vote"):
                    self.pending_trigger[a] = f"phase:{m.phase}"
            if self.fallback_reason or a in self.inflight:
                continue
            if m.tick - self.last_call.get(a, -10_000) < MIN_GAP_S * physics.TICK_RATE:
                continue
            trigger = self.pending_trigger.pop(a, None)
            if trigger is None and m.phase == "explore" and m.tick >= self.next_due[a]:
                trigger = "periodic"
            if trigger is not None:
                self._launch(a, trigger)

    def _launch(self, a: str, trigger: str) -> None:
        m = self.match
        brain = m.bots[a]
        obs = m.observe(a, len(m.events))
        snap = m.snapshot(a)
        names = m.names()
        ctx = build_context(obs, snap, self.memory[a], brain, names)
        system = SYSTEM_PROMPT.format(name=names[a], personality=personality_text(brain))
        user = render_user_prompt(ctx, trigger)
        record = DecisionRecord(next(self._ids), a, trigger, m.phase_id(), m.tick, context=ctx)
        self.records.append(record)
        del self.records[:-MAX_RECORDS]
        self.last_call[a] = m.tick
        self.next_due[a] = m.tick + DECISION_INTERVAL_S * physics.TICK_RATE
        task = asyncio.get_running_loop().create_task(self.gateway.decide(system, user, ctx))
        self.inflight[a] = (task, record)

    # ------------------------------------------------------------------ results
    def _collect_finished(self) -> None:
        for a, (task, record) in list(self.inflight.items()):
            if not task.done():
                continue
            del self.inflight[a]
            try:
                result = task.result()
            except Exception as e:  # provider bug: never let it take the match down
                record.status, record.error = "failed", f"exception: {type(e).__name__}"
                continue
            self._resolve(a, record, result)

    def _resolve(self, a: str, record: DecisionRecord, result: GatewayResult) -> None:
        m = self.match
        record.tick_resolved = m.tick
        record.provider, record.model, record.is_llm = result.provider, result.model, result.is_llm
        record.latency_ms, record.attempts = round(result.latency_ms, 1), result.attempts
        record.input_tokens, record.output_tokens, record.cost_usd = (
            result.input_tokens,
            result.output_tokens,
            result.cost_usd,
        )
        if result.decision is None:
            record.status, record.error = "failed", result.error
            return  # the bot's deadline fallbacks still cover votes and offers
        record.decision = result.decision.model_dump()
        voting_closed = record.phase_id.endswith(":vote") and m.phase != "vote"
        if voting_closed or m.tick - record.tick_requested > STALE_AFTER_S * physics.TICK_RATE:
            record.status = "stale"
            return
        if not m.contestants[a].alive:
            record.status = "stale"
            return
        self._apply(a, record, result.decision)

    def _apply(self, a: str, record: DecisionRecord, decision: StrategicDecision) -> None:
        m = self.match
        brain = m.bots[a]
        obs = m.observe(a, len(m.events))
        for act in decision.actions:
            ok, reason, engine_action = self._prevalidate(a, act, obs)
            record.actions.append({"proposed": act.model_dump(exclude_none=True), "prevalidated": ok, "reason": reason})
            if ok and engine_action is not None:
                brain.external_actions.append(engine_action)
                self.awaiting_engine[a].append(record)
        if decision.goal != "keep":
            brain.goal_hint = decision.goal
            brain.goal_hint_until = m.tick + GOAL_HINT_S * physics.TICK_RATE
            if decision.goal == "shrine":
                brain.shrine_hold_until = m.tick + (decision.shrine_meet_in_s or 0) * physics.TICK_RATE
            if brain.goal is not None and brain.goal.kind != decision.goal.split("_")[0]:
                brain.goal = None  # re-plan toward the new goal
                brain.path = []
        record.status = "applied"

    def _prevalidate(self, a: str, act: DecisionAction, obs: Any) -> tuple[bool, str, tuple[Any, ...] | None]:
        """Authorisation and legality check against what the agent may know. The engine re-checks."""
        alive = set(obs.alive_ids)
        if act.kind == "vote":
            if obs.phase != "vote":
                return False, "not_vote_phase", None
            if obs.has_voted:
                return False, "already_voted", None
            target = None if act.target in (None, "", "null", "skip") else act.target
            if target is not None and (target not in alive or target == a):
                return False, "invalid_target", None
            return True, "", ("vote", target)
        if act.kind == "propose_alliance":
            if act.target not in alive or act.target == a:
                return False, "invalid_target", None
            return True, "", ("propose", act.target)
        if act.kind == "respond_alliance":
            if act.target not in obs.incoming_proposals:
                return False, "no_such_offer", None
            return True, "", ("respond", act.target, bool(act.accept))
        if act.kind == "break_alliance":
            if obs.ally is None:
                return False, "no_ally", None
            return True, "", ("break",)
        # message
        to = act.to or None
        if to is not None and (to not in alive or to == a):
            return False, "invalid_recipient", None
        if act.msg_type in ("ACCEPT", "REJECT", "COUNTER_OFFER"):
            if not self.memory[a].answerable(a, act.reply_to, obs.tick):
                return False, "unknown_or_closed_thread", None
            self.memory[a].threads[act.reply_to or ""].replied = True
        payload = {"plan": act.plan} if act.plan else {}
        return True, "", ("message", act.msg_type, act.text or "", to, payload, act.reply_to)

    def _link_engine_results(self) -> None:
        """Attach the engine's authoritative verdict on each queued action to its decision."""
        results = self.match.action_results
        while self._result_cursor < len(results):
            tick, cid, action, ok, reason = results[self._result_cursor]
            self._result_cursor += 1
            queue = self.awaiting_engine.get(cid)
            if queue:
                record = queue.pop(0)
                record.engine_results.append({"tick": tick, "action": list(action), "ok": ok, "reason": reason})
            mem = self.memory.get(cid)
            if mem is not None and not ok:
                # Agents learn from refusals; they are facts about the world they couldn't see.
                mem.facts.append(f"[t{tick}] the server refused your {action[0]}: {reason}")
                if action[0] == "propose":
                    mem.offer_refused[action[1]] = tick

    # ------------------------------------------------------------------ lifecycle
    async def drain(self) -> None:
        """Wait for in-flight calls (tests and offline simulations)."""
        if self.inflight:
            await asyncio.gather(*(t for t, _ in self.inflight.values()), return_exceptions=True)
        self._collect_finished()
        self._link_engine_results()

    async def close(self) -> None:
        for task, record in self.inflight.values():
            task.cancel()
            record.status = "failed"
            record.error = "cancelled"
        for task, _ in self.inflight.values():
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        self.inflight.clear()

    def summary(self) -> dict[str, Any]:
        s = self.gateway.stats
        lat = sorted(s.latencies_ms)
        statuses: dict[str, int] = {}
        for r in self.records:
            statuses[r.status] = statuses.get(r.status, 0) + 1
        proposed = sum(len(r.actions) for r in self.records)
        rejected = sum(1 for r in self.records for x in r.actions if not x["prevalidated"])
        engine_rejected = sum(1 for r in self.records for x in r.engine_results if not x["ok"])
        return {
            "provider": self.gateway.provider.name,
            "model": self.gateway.provider.model,
            "is_llm": self.gateway.provider.is_llm,
            "agents": self.agents,
            "decisions": len(self.records),
            "statuses": statuses,
            "actions_proposed": proposed,
            "actions_rejected_prevalidation": rejected,
            "actions_rejected_engine": engine_rejected,
            "calls": s.calls,
            "errors": s.errors,
            "latency_ms_p50": lat[len(lat) // 2] if lat else None,
            "latency_ms_p95": lat[min(len(lat) - 1, int(len(lat) * 0.95))] if lat else None,
            "input_tokens": s.input_tokens,
            "output_tokens": s.output_tokens,
            "estimated_cost_usd": round(s.cost_usd, 4),
            "fallback_reason": self.fallback_reason,
        }
