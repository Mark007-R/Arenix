"""Benchmark runner: the same seeds under different agent conditions, metrics from real runs only.

    uv run python -m arenix.sim.runner --seeds 1-10 --conditions independent,communicate,negotiate

Conditions
  independent   rule-based bots that never communicate (no chat, no alliance offers; they still vote)
  communicate   rule-based bots with quick-chat and alliances, but no coordinated planning
  negotiate     strategist agents (heuristic planner) using the structured protocol
  negotiate_mem0  as negotiate, with episodic memory disabled
  negotiate_r1    as negotiate, with a 1-round negotiation budget
  llm           strategist agents backed by Claude (requires ANTHROPIC_API_KEY; costs money)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..agents.config import AgentConfig
from ..agents.coordinator import AgentCoordinator
from ..agents.gateway import LLMGateway
from ..agents.heuristic import HeuristicProvider
from ..engine.maps import get_map
from ..engine.match import Match

CONDITIONS = ("independent", "communicate", "negotiate", "negotiate_mem0", "negotiate_r1", "llm")
DESCRIPTIONS = {
    "independent": "Rule-based bots, no communication (no chat or alliance offers; still vote).",
    "communicate": "Rule-based bots with quick-chat and alliances; no coordinated planning.",
    "negotiate": "Heuristic strategist agents negotiating over the structured protocol (not an LLM).",
    "negotiate_mem0": "As negotiate, with episodic memory disabled (0 facts/claims).",
    "negotiate_r1": "As negotiate, with a negotiation budget of 1 round per thread.",
    "llm": "Claude strategist agents over the structured protocol (rule-based fallback).",
}


@dataclass
class RunMetrics:
    condition: str
    seed: int
    contestants: int
    winner: str | None
    ticks: int
    tower_repaired: bool
    shrine_activated: bool
    shrine_attempts: int
    shrine_fizzles: int
    eliminations: int
    alliances_formed: int
    betrayals: int
    messages: int
    plans_proposed: int
    plans_accepted: int
    actions_total: int
    actions_invalid: int
    decisions: int = 0
    decision_failures: int = 0
    latencies_ms: list[float] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    wall_seconds: float = 0.0

    @property
    def coordination_failures(self) -> int:
        """Shrine rituals that started but fizzled, plus accepted plans that never produced an activation."""
        return self.shrine_fizzles + (self.plans_accepted if not self.shrine_activated else 0)


async def run_one(
    condition: str, seed: int, contestants: int = 6, time_limit: int = 420, persist: Any = None
) -> tuple[RunMetrics, Match, AgentCoordinator | None]:
    start = time.perf_counter()
    m = Match(f"sim-{condition}-{seed}", get_map("emerald_isle"), seed, time_limit_seconds=time_limit)
    for i in range(contestants):
        m.add_contestant(f"bot{i + 1}", f"Agent{i + 1}", "rogue", is_bot=True)
    m.start()
    coordinator: AgentCoordinator | None = None
    if condition == "independent":
        for b in m.bots.values():
            b.communicate = False
    elif condition.startswith("negotiate"):
        if condition == "negotiate_r1":
            m.max_negotiation_rounds = 1
        gateway = LLMGateway(HeuristicProvider())
        memory = 0 if condition == "negotiate_mem0" else None
        coordinator = AgentCoordinator(m, gateway, list(m.bots), memory_size=memory)
    elif condition == "llm":
        cfg = AgentConfig.from_env()
        coordinator = AgentCoordinator(
            m,
            AgentConfig(
                provider="anthropic",
                model=cfg.model,
                effort=cfg.effort,
                timeout_s=cfg.timeout_s,
                max_calls=cfg.max_calls,
                max_cost_usd=cfg.max_cost_usd,
            ).make_gateway(),
            list(m.bots),
        )
    elif condition != "communicate":
        raise ValueError(f"unknown condition {condition}")

    real_time = condition == "llm"  # model latency is real; run the clock in real time for LLM agents
    while m.status == "running":
        m.step()
        if coordinator is not None:
            coordinator.tick()
        await asyncio.sleep(0.05 if real_time else 0)
    if coordinator is not None:
        await coordinator.drain()
        await coordinator.close()

    types = Counter(e.type for e in m.events)
    chats = [e for e in m.events if e.type == "chat"]
    plans = [e for e in chats if e.data.get("kind") == "PLAN_PROPOSAL"]
    plan_ids = {e.data["correlation_id"] for e in plans}
    accepted = {
        e.data["correlation_id"]
        for e in chats
        if e.data.get("kind") == "ACCEPT" and e.data.get("correlation_id") in plan_ids
    }
    actions_total = len(m.action_results)
    actions_invalid = sum(1 for r in m.action_results if not r[3])
    if coordinator is not None:
        actions_invalid += sum(1 for r in coordinator.records for a in r.actions if not a["prevalidated"])
        actions_total += sum(1 for r in coordinator.records for a in r.actions if not a["prevalidated"])
    metrics = RunMetrics(
        condition=condition,
        seed=seed,
        contestants=contestants,
        winner=m.result["winner"] if m.result else None,
        ticks=m.tick,
        tower_repaired=m.mission.status == "completed",
        shrine_activated=m.shrine.status == "activated",
        shrine_attempts=sum(1 for e in m.events if e.type == "shrine_channel" and e.data["count"] == 1),
        shrine_fizzles=types["shrine_fizzled"],
        eliminations=types["contestant_eliminated"],
        alliances_formed=types["alliance_formed"],
        betrayals=sum(1 for e in m.events if e.type == "alliance_broken" and e.data["reason"] == "betrayal"),
        messages=len(chats),
        plans_proposed=len(plan_ids),
        plans_accepted=len(accepted),
        actions_total=actions_total,
        actions_invalid=actions_invalid,
    )
    if coordinator is not None:
        st = coordinator.gateway.stats
        metrics.decisions = len(coordinator.records)
        metrics.decision_failures = sum(1 for r in coordinator.records if r.status == "failed")
        metrics.latencies_ms = list(st.latencies_ms)
        metrics.input_tokens, metrics.output_tokens, metrics.cost_usd = st.input_tokens, st.output_tokens, st.cost_usd
    metrics.wall_seconds = round(time.perf_counter() - start, 2)
    if persist is not None:
        await persist(m, coordinator)
    return metrics, m, coordinator


def _pct(values: list[float], q: float) -> float | None:
    if not values:
        return None
    s = sorted(values)
    return round(s[min(len(s) - 1, int(len(s) * q))], 1)


def aggregate(runs: list[RunMetrics]) -> dict[str, Any]:
    n = len(runs)
    lat = [x for r in runs for x in r.latencies_ms]
    winners = Counter(r.winner for r in runs)
    slots = runs[0].contestants if runs else 0
    plans = sum(r.plans_proposed for r in runs)
    return {
        "runs": n,
        "tower_completion_rate": round(sum(r.tower_repaired for r in runs) / n, 3),
        "shrine_success_rate": round(sum(r.shrine_activated for r in runs) / n, 3),
        "mission_completion_rate": round(sum((r.tower_repaired + r.shrine_activated) / 2 for r in runs) / n, 3),
        "negotiation_success_rate": round(sum(r.plans_accepted for r in runs) / plans, 3) if plans else None,
        "invalid_action_rate": round(
            sum(r.actions_invalid for r in runs) / max(1, sum(r.actions_total for r in runs)), 3
        ),
        "coordination_failures_per_match": round(sum(r.coordination_failures for r in runs) / n, 2),
        "eliminations_per_match": round(sum(r.eliminations for r in runs) / n, 2),
        "alliances_per_match": round(sum(r.alliances_formed for r in runs) / n, 2),
        "betrayals_per_match": round(sum(r.betrayals for r in runs) / n, 2),
        "messages_per_match": round(sum(r.messages for r in runs) / n, 1),
        "individual_win_rate_by_slot": {
            f"bot{i + 1}": round(winners.get(f"bot{i + 1}", 0) / n, 3) for i in range(slots)
        },
        "decisions_per_match": round(sum(r.decisions for r in runs) / n, 1),
        "decision_failure_rate": round(
            sum(r.decision_failures for r in runs) / max(1, sum(r.decisions for r in runs)), 3
        ),
        "latency_ms_p50": _pct(lat, 0.5),
        "latency_ms_p95": _pct(lat, 0.95),
        "tokens_per_match": round(sum(r.input_tokens + r.output_tokens for r in runs) / n),
        "estimated_cost_usd_per_match": round(sum(r.cost_usd for r in runs) / n, 4),
        "wall_seconds_per_match": round(statistics.mean(r.wall_seconds for r in runs), 2),
    }


async def run_experiment(
    conditions: list[str],
    seeds: list[int],
    contestants: int = 6,
    time_limit: int = 420,
    persist: Any = None,
    progress: Any = None,
) -> dict[str, Any]:
    results: dict[str, Any] = {
        "conditions": {},
        "seeds": seeds,
        "contestants": contestants,
        "time_limit_seconds": time_limit,
        "runs": [],
    }
    for cond in conditions:
        runs = []
        for seed in seeds:
            metrics, _, _ = await run_one(cond, seed, contestants, time_limit, persist)
            runs.append(metrics)
            results["runs"].append({k: v for k, v in metrics.__dict__.items() if k != "latencies_ms"})
            if progress is not None:
                await progress(cond, seed, metrics)
        results["conditions"][cond] = {"description": DESCRIPTIONS[cond], **aggregate(runs)}
    return results


def markdown_report(results: dict[str, Any]) -> str:
    conds = list(results["conditions"])
    rows = [
        ("Tower repaired", "tower_completion_rate", "pct"),
        ("Shrine awakened", "shrine_success_rate", "pct"),
        ("Mission completion (both missions)", "mission_completion_rate", "pct"),
        ("Negotiation success (plans accepted)", "negotiation_success_rate", "pct"),
        ("Invalid-action rate", "invalid_action_rate", "pct"),
        ("Coordination failures / match", "coordination_failures_per_match", "num"),
        ("Eliminations / match", "eliminations_per_match", "num"),
        ("Alliances / match", "alliances_per_match", "num"),
        ("Betrayals / match", "betrayals_per_match", "num"),
        ("Messages / match", "messages_per_match", "num"),
        ("Strategist decisions / match", "decisions_per_match", "num"),
        ("Decision failure rate", "decision_failure_rate", "pct"),
        ("Latency p50 (ms)", "latency_ms_p50", "num"),
        ("Latency p95 (ms)", "latency_ms_p95", "num"),
        ("Tokens / match", "tokens_per_match", "num"),
        ("Est. cost / match (USD)", "estimated_cost_usd_per_match", "num"),
    ]

    def fmt(v: Any, kind: str) -> str:
        if v is None:
            return "—"
        return f"{v * 100:.1f}%" if kind == "pct" else str(v)

    out = [
        "| Metric | " + " | ".join(conds) + " |",
        "|---|" + "---|" * len(conds),
    ]
    for label, key, kind in rows:
        out.append(f"| {label} | " + " | ".join(fmt(results["conditions"][c].get(key), kind) for c in conds) + " |")
    out.append("")
    for c in conds:
        out.append(f"- **{c}**: {results['conditions'][c]['description']}")
    out.append("")
    out.append(
        f"Seeds: {results['seeds'][0]}–{results['seeds'][-1]} ({len(results['seeds'])} per condition), "
        f"{results['contestants']} AI contestants, {results['time_limit_seconds']} s matches."
    )
    return "\n".join(out)


def _parse_seeds(text: str) -> list[int]:
    if "-" in text:
        a, b = text.split("-")
        return list(range(int(a), int(b) + 1))
    return [int(x) for x in text.split(",")]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--conditions", default="independent,communicate,negotiate")
    ap.add_argument("--seeds", default="1-10")
    ap.add_argument("--contestants", type=int, default=6)
    ap.add_argument("--time-limit", type=int, default=420)
    ap.add_argument("--out", type=Path, default=None, help="write JSON results here")
    ap.add_argument("--report", type=Path, default=None, help="write a markdown report here")
    ap.add_argument("--persist", action="store_true", help="store matches in ARENIX_DATABASE_URL (Agent Lab)")
    args = ap.parse_args()
    conditions = [c.strip() for c in args.conditions.split(",") if c.strip()]
    for c in conditions:
        if c not in CONDITIONS:
            raise SystemExit(f"unknown condition {c}; choose from {', '.join(CONDITIONS)}")

    async def go() -> dict[str, Any]:
        persist = None
        db = None
        if args.persist:
            from ..db.session import database_from_env
            from ..economy.records import persist_match

            db = database_from_env()
            if db is None:
                raise SystemExit("--persist needs ARENIX_DATABASE_URL")

            async def persist(match: Match, coord: AgentCoordinator | None) -> None:
                assert db is not None
                async with db.sessions.begin() as s:
                    await persist_match(s, match, coord, None, {})

        async def progress(cond: str, seed: int, m: RunMetrics) -> None:
            print(
                f"  {cond:15s} seed {seed:3d}: winner={m.winner} tower={m.tower_repaired} "
                f"shrine={m.shrine_activated} elim={m.eliminations} ({m.wall_seconds}s)",
                flush=True,
            )

        try:
            return await run_experiment(
                conditions, _parse_seeds(args.seeds), args.contestants, args.time_limit, persist, progress
            )
        finally:
            if db is not None:
                await db.dispose()

    results = asyncio.run(go())
    if args.out:
        args.out.write_text(json.dumps(results, indent=2))
    report = markdown_report(results)
    if args.report:
        args.report.write_text(report + "\n")
    print(report)


if __name__ == "__main__":
    main()
