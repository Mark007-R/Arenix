"""Persist a finished match and award progression — one transaction, idempotent per match/user."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..agents.coordinator import AgentCoordinator
from ..db.models import (
    AgentDecisionRow,
    AgentMessageRow,
    AgentState,
    GameEventRow,
    GamePhase,
    LlmTrace,
    MatchParticipant,
    MatchRow,
    PlayerProfile,
)
from ..engine.match import Match
from . import catalog
from .service import _apply, _locked_profile


def _phases(match: Match) -> list[dict[str, Any]]:
    """Reconstruct phase spans from the event log."""
    spans: list[dict[str, Any]] = [{"meeting": 0, "phase": "explore", "start_tick": 0}]
    transitions = {
        "meeting_called": "discuss",
        "vote_started": "vote",
        "vote_resolved": "reveal",
        "meeting_ended": "explore",
    }
    meeting = 0
    for e in match.events:
        if e.type in transitions:
            if e.type == "meeting_called":
                meeting = int(e.data["meeting"])
            spans[-1]["end_tick"] = e.tick
            spans.append({"meeting": meeting, "phase": transitions[e.type], "start_tick": e.tick})
    spans[-1]["end_tick"] = match.tick
    return spans


async def persist_match(
    s: AsyncSession,
    match: Match,
    coordinator: AgentCoordinator | None,
    room_code: str | None,
    user_ids: dict[str, int],
) -> dict[int, dict[str, Any]]:
    """Write the match record and event log, then award each signed-in human. Returns rewards per user."""
    if await s.get(MatchRow, match.id) is not None:
        return {}  # already persisted (idempotent)
    assert match.result is not None
    s.add(
        MatchRow(
            id=match.id,
            room_code=room_code,
            map_id=match.map.id,
            seed=match.seed,
            rules_version=match.events.since(0)[0].data["rules_version"],
            ai_mode=coordinator.gateway.provider.name if coordinator else "rules",
            ticks=match.tick,
            result=match.result,
            agent_summary=coordinator.summary() if coordinator else None,
        )
    )
    await s.flush()
    standings = match.result["standings"]
    for place, st in enumerate(standings, start=1):
        c = match.contestants[st["id"]]
        s.add(
            MatchParticipant(
                match_id=match.id,
                contestant_id=c.id,
                user_id=user_ids.get(c.id),
                name=c.name,
                archetype=c.archetype,
                is_bot=c.is_bot,
                score=c.score,
                alive=c.alive,
                placement=place,
                objective=st.get("objective"),
            )
        )
    for span in _phases(match):
        s.add(GamePhase(match_id=match.id, **span))
    for e in match.events:
        s.add(
            GameEventRow(
                match_id=match.id,
                seq=e.seq,
                tick=e.tick,
                type=e.type,
                data=e.data,
                visible_to=sorted(e.visible_to) if e.visible_to is not None else None,
            )
        )
        if e.type == "chat" and e.data.get("kind"):
            d = e.data
            s.add(
                AgentMessageRow(
                    match_id=match.id,
                    message_id=d["message_id"],
                    correlation_id=d["correlation_id"],
                    phase_id=d["phase_id"],
                    sender=d["sender"],
                    recipient=d["to"],
                    type=d["kind"],
                    text=d["text"],
                    payload=d["payload"],
                    tick=e.tick,
                    expires_tick=d["expires_tick"],
                )
            )
    if coordinator is not None:
        for a in coordinator.agents:
            brain = match.bots[a]
            mem = coordinator.memory[a]
            s.add(
                AgentState(
                    match_id=match.id,
                    agent_id=a,
                    personality=vars(brain.personality),
                    beliefs={"trust": brain.beliefs.trust, "voted_against_me": sorted(brain.beliefs.voted_against_me)},
                    memory={"facts": list(mem.facts), "agreements": mem.agreements, "betrayals": mem.betrayals},
                )
            )
        for r in coordinator.records:
            s.add(AgentDecisionRow(match_id=match.id, agent_id=r.agent, record=r.to_dict()))
            if r.attempts:
                s.add(
                    LlmTrace(
                        match_id=match.id,
                        agent_id=r.agent,
                        provider=r.provider,
                        model=r.model,
                        latency_ms=r.latency_ms,
                        input_tokens=r.input_tokens,
                        output_tokens=r.output_tokens,
                        cost_usd=r.cost_usd,
                        error=r.error,
                    )
                )
    await s.flush()

    rewards: dict[int, dict[str, Any]] = {}
    winner = match.result["winner"]
    for st in standings:
        uid = user_ids.get(st["id"])
        if uid is None:
            continue
        rewards[uid] = await _award(s, uid, match, st, st["id"] == winner)
    return rewards


async def _award(s: AsyncSession, uid: int, match: Match, st: dict[str, Any], won: bool) -> dict[str, Any]:
    profile: PlayerProfile = await _locked_profile(s, uid)
    points = catalog.match_reward(st["score"], won, st["alive"])
    await _apply(s, profile, "game_points", points, "match_reward", f"match:{match.id}:{uid}", "match", match.id)
    profile.xp += points
    profile.level = catalog.level_for_xp(profile.xp)
    profile.matches_played += 1
    profile.wins += int(won)
    profile.units_delivered += int(st.get("contributed", 0))
    awakened = st["id"] in match.shrine.activated_by
    profile.shrines_awakened += int(awakened)
    earned: list[dict[str, Any]] = []
    have = set(profile.achievements or [])
    checks = {
        "first_match": profile.matches_played >= 1,
        "first_win": profile.wins >= 1,
        "veteran": profile.matches_played >= 10,
        "builder": profile.units_delivered >= 30,
        "mystic": profile.shrines_awakened >= 1,
    }
    for ach_id, ok in checks.items():
        if ok and ach_id not in have:
            ach = catalog.ACHIEVEMENTS_BY_ID[ach_id]
            have.add(ach_id)
            if ach.game_points:
                await _apply(s, profile, "game_points", ach.game_points, "achievement", f"ach:{ach_id}:{uid}")
            if ach.diamonds:
                await _apply(s, profile, "diamonds", ach.diamonds, "achievement", f"ach_d:{ach_id}:{uid}")
            earned.append({"id": ach.id, "name": ach.name, "game_points": ach.game_points, "diamonds": ach.diamonds})
    profile.achievements = sorted(have)
    await s.flush()
    return {
        "game_points": points,
        "xp": points,
        "level": profile.level,
        "achievements": earned,
        "balance": {"game_points": profile.game_points, "diamonds": profile.diamonds},
    }


async def match_detail(s: AsyncSession, match_id: str) -> dict[str, Any] | None:
    row = await s.get(MatchRow, match_id)
    if row is None:
        return None
    parts = (
        await s.scalars(
            select(MatchParticipant).where(MatchParticipant.match_id == match_id).order_by(MatchParticipant.placement)
        )
    ).all()
    return {
        "id": row.id,
        "map_id": row.map_id,
        "seed": row.seed,
        "rules_version": row.rules_version,
        "ai_mode": row.ai_mode,
        "ticks": row.ticks,
        "result": row.result,
        "finished_at": row.finished_at.isoformat(),
        "participants": [
            {
                "id": p.contestant_id,
                "name": p.name,
                "archetype": p.archetype,
                "is_bot": p.is_bot,
                "score": p.score,
                "alive": p.alive,
                "placement": p.placement,
            }
            for p in parts
        ],
    }
