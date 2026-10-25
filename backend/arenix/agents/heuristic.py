"""HeuristicProvider: a deterministic planner speaking the full agent protocol.

Not an LLM. It reads only the authorised context dict and produces a StrategicDecision-shaped
JSON reply. Used to run the agent pipeline offline and as an experiment baseline.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from .gateway import ProviderResponse

SHRINE_PLAN = re.compile(r"^shrine at T=(\d+)$")


def _roll(*parts: Any) -> float:
    h = hashlib.sha256("|".join(map(str, parts)).encode()).digest()
    return int.from_bytes(h[:4], "big") / 2**32


def _action(kind: str, **kw: Any) -> dict[str, Any]:
    base = {
        "kind": kind,
        "msg_type": None,
        "to": None,
        "text": None,
        "reply_to": None,
        "plan": None,
        "target": None,
        "accept": None,
    }
    base.update(kw)
    return base


def plan(ctx: dict[str, Any]) -> dict[str, Any]:
    me = ctx["you"]
    my_id = me["id"]
    phase = ctx["phase"]
    t_left = ctx["match_seconds_left"]
    others = [c for c in ctx["contestants"] if c["alive"]]
    names = {c["id"]: c["name"] for c in ctx["contestants"]}
    actions: list[dict[str, Any]] = []
    notes: list[str] = []
    goal = "keep"
    meet_in: int | None = None
    shrine = ctx["shrine"]
    objective = me.get("objective") or ""

    # 1. Alliance offers: accept people we don't distrust if we're free.
    for proposer in ctx["incoming_alliance_offers"]:
        trust = next((c["your_trust"] for c in others if c["id"] == proposer), 0.0)
        accept = me["ally"] is None and trust >= -0.1
        actions.append(_action("respond_alliance", target=proposer, accept=accept))
        notes.append(f"{'accepted' if accept else 'declined'} {names.get(proposer, proposer)}'s alliance")

    # 2. Answer open shrine plans from others.
    for th in ctx["open_threads"]:
        if th["opened_by"] == my_id or th["type"] != "PLAN_PROPOSAL" or th["you_already_replied"] or len(actions) >= 3:
            continue
        m = SHRINE_PLAN.match(th.get("plan") or "")
        if not m:
            continue
        start_at = int(m.group(1))
        wait = t_left - start_at
        busy = sum(me["carrying"].values()) >= 3
        if phase == "explore" and shrine["status"] == "dormant" and 5 <= wait <= 45 and not busy:
            actions.append(
                _action(
                    "message",
                    msg_type="ACCEPT",
                    reply_to=th["correlation_id"],
                    to=th["opened_by"],
                    text="Count me in for the shrine.",
                    plan=th["plan"],
                )
            )
            goal, meet_in = "shrine", wait
            notes.append(f"joined shrine plan by {names.get(th['opened_by'], th['opened_by'])}")
        elif not th.get("public", False):
            # Declining a private invitation is polite; public calls can simply be ignored.
            actions.append(
                _action(
                    "message",
                    msg_type="REJECT",
                    reply_to=th["correlation_id"],
                    to=th["opened_by"],
                    text="Can't make it to the shrine.",
                    plan=None,
                )
            )

    # 3. Propose a timed shrine ritual (needs 3) when it fits our objective or alliance.
    my_open_shrine = any(th["opened_by"] == my_id and th["type"] == "PLAN_PROPOSAL" for th in ctx["open_threads"])
    wants_shrine = "Shrine" in objective or me["ally"] is not None
    if (
        phase == "explore"
        and shrine["status"] == "dormant"
        and goal == "keep"
        and not my_open_shrine
        and wants_shrine
        and t_left > 90
        and ctx["phase_seconds_left"] > 35
        and _roll(my_id, t_left // 15, "shrine") < 0.35
    ):
        start_at = t_left - 25
        actions.append(
            _action(
                "message",
                msg_type="PLAN_PROPOSAL",
                to=None,
                text="Shrine ritual in 25s — I need two more channelers. Who's in?",
                plan=f"shrine at T={start_at}",
            )
        )
        goal, meet_in = "shrine", 25
        notes.append("proposed a timed shrine ritual")

    # 4. Seek an ally we trust.
    offerable = [c for c in others if c["id"] in ctx["legal_actions"].get("propose_alliance_to", [])]
    if phase == "explore" and me["ally"] is None and not ctx["incoming_alliance_offers"] and offerable:
        best = max(offerable, key=lambda c: (c["your_trust"], -c["score"], c["id"]))
        if best["your_trust"] >= 0.05 and _roll(my_id, t_left // 20, "ally") < 0.5:
            actions.append(_action("propose_alliance", target=best["id"]))
            notes.append(f"offered {best['name']} an alliance")

    # 5. Council: share information in discussion, vote with intent in the vote phase.
    candidates = [c for c in others if not c["is_your_ally"]]
    if phase == "discuss" and candidates:
        leader = max(candidates, key=lambda c: c["score"])
        if leader["score"] > me["score"] + 60:
            actions.append(
                _action(
                    "message",
                    msg_type="INFORMATION_SHARE",
                    text=f"{leader['name']} is running away with it. Think about that.",
                    plan=f"suspect {leader['id']}",
                )
            )
            notes.append(f"pointed at the leader {leader['name']}")
    if phase == "vote" and "vote_targets" in ctx["legal_actions"]:
        target: str | None = None
        hunt = re.search(r"Make sure (.+) is voted out", objective)
        if hunt:
            target = next((c["id"] for c in candidates if c["name"] == hunt.group(1)), None)
        if target is None and me["ally"]:
            # Follow our ally's announced vote (a claim, but from someone we chose to trust).
            for claim in reversed(ctx["messages_from_others"]):
                if claim["from"] == me["ally"] and claim["type"] == "VOTE_INTENT" and claim.get("plan"):
                    intended = claim["plan"].removeprefix("vote ")
                    if any(c["id"] == intended for c in candidates):
                        target = intended
                    break
        if target is None and candidates:
            # Threat = score lead adjusted by distrust.
            worst = max(
                candidates,
                key=lambda c: (
                    c["score"] - 120 * c["your_trust"] + (60 if c["voted_against_you_before"] else 0),
                    c["id"],
                ),
            )
            threat = worst["score"] - 120 * worst["your_trust"] + (60 if worst["voted_against_you_before"] else 0)
            if threat > me["score"] - 10 or _roll(my_id, t_left, "vote") < 0.4:
                target = worst["id"]
        actions.append(_action("vote", target=target))
        if me["ally"] and target:
            actions.append(
                _action(
                    "message",
                    msg_type="VOTE_INTENT",
                    to=me["ally"],
                    text=f"I'm voting {names.get(target, target)}. With me?",
                    plan=f"vote {target}",
                )
            )
        notes.append(f"vote {names.get(target, target) if target else 'skip'}")

    # 6. Errand goal when nothing social is pending.
    if goal == "keep" and phase == "explore":
        needs = ctx["tower_still_needs"]
        if isinstance(needs, dict) and any(needs.values()):
            if "wood" in objective:
                goal = "gather_wood"
            elif "stone" in objective:
                goal = "gather_stone"
            else:
                goal = "gather_wood" if needs.get("wood", 0) >= needs.get("stone", 0) else "gather_stone"

    return {
        "summary": "; ".join(notes) or f"continue with {goal}",
        "goal": goal,
        "shrine_meet_in_s": meet_in,
        "actions": actions[:4],
    }


class HeuristicProvider:
    name = "heuristic"
    model = "heuristic-planner-v1"
    is_llm = False

    async def complete(self, system: str, user: str, context: dict[str, Any]) -> ProviderResponse:
        return ProviderResponse(json.dumps(plan(context)))
