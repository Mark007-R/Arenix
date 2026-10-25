"""Agent Lab payload for persisted matches (always finished, so the full record is shown)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .db.models import AgentDecisionRow, GameEventRow, MatchParticipant, MatchRow
from .lab import assemble


async def payload_from_db(s: AsyncSession, match_id: str) -> dict[str, Any] | None:
    row = await s.get(MatchRow, match_id)
    if row is None:
        return None
    parts = (await s.scalars(select(MatchParticipant).where(MatchParticipant.match_id == match_id))).all()
    events = (
        await s.scalars(select(GameEventRow).where(GameEventRow.match_id == match_id).order_by(GameEventRow.seq))
    ).all()
    decisions = (
        await s.scalars(
            select(AgentDecisionRow).where(AgentDecisionRow.match_id == match_id).order_by(AgentDecisionRow.id)
        )
    ).all()
    return assemble(
        match_id=row.id,
        room_code=row.room_code,
        status="finished",
        map_id=row.map_id,
        seed=row.seed,
        ticks=row.ticks,
        contestants=[
            {
                "id": p.contestant_id,
                "name": p.name,
                "archetype": p.archetype,
                "is_bot": p.is_bot,
                "score": p.score,
                "alive": p.alive,
                "connected": True,
                "objective": p.objective,
            }
            for p in parts
        ],
        events=[
            {
                "seq": e.seq,
                "tick": e.tick,
                "type": e.type,
                "data": e.data,
                **({"private": True, "visible_to": e.visible_to} if e.visible_to is not None else {}),
            }
            for e in events
        ],
        decisions=[d.record for d in decisions],
        agent_summary=row.agent_summary,
        result=row.result,
    )
