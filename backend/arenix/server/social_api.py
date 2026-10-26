"""Public social endpoints: leaderboards and player profiles.

Only registered accounts appear here. Guests stay private, and nothing personal (email, currencies,
inventory) is ever exposed: just the display name, level, match stats, achievements and the
cosmetics a player wears in matches anyway.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import Float, cast, select

from ..db.models import MatchParticipant, MatchRow, PlayerProfile, User
from ..economy import catalog
from .economy_api import Session, won

router = APIRouter(prefix="/api")

LEADERBOARD_SIZE = 50
WIN_RATE_MIN_MATCHES = 10  # a 1-for-1 record should not top the win-rate board
RECENT_MATCHES = 10


def role_of(result: dict[str, Any], contestant_id: str) -> str | None:
    for s in result.get("standings", []):
        if s.get("id") == contestant_id:
            return s.get("role")
    return None


def win_rate(wins: int, played: int) -> float:
    return round(wins / played, 3) if played else 0.0


@router.get("/leaderboard")
async def leaderboard(s: Session, by: Literal["wins", "level", "win_rate"] = Query(default="wins")) -> dict[str, Any]:
    q = (
        select(User, PlayerProfile)
        .join(PlayerProfile, PlayerProfile.user_id == User.id)
        .where(User.is_guest.is_(False), PlayerProfile.matches_played > 0)
    )
    if by == "wins":
        q = q.order_by(PlayerProfile.wins.desc(), PlayerProfile.matches_played.asc(), User.id)
    elif by == "level":
        q = q.order_by(PlayerProfile.level.desc(), PlayerProfile.xp.desc(), User.id)
    else:
        rate = cast(PlayerProfile.wins, Float) / PlayerProfile.matches_played
        q = q.where(PlayerProfile.matches_played >= WIN_RATE_MIN_MATCHES).order_by(
            rate.desc(), PlayerProfile.wins.desc(), User.id
        )
    rows = (await s.execute(q.limit(LEADERBOARD_SIZE))).all()
    return {
        "by": by,
        "min_matches": WIN_RATE_MIN_MATCHES if by == "win_rate" else 1,
        "entries": [
            {
                "rank": i + 1,
                "user_id": u.id,
                "display_name": u.display_name,
                "level": p.level,
                "wins": p.wins,
                "matches_played": p.matches_played,
                "win_rate": win_rate(p.wins, p.matches_played),
                "equipped": p.equipped or {},
            }
            for i, (u, p) in enumerate(rows)
        ],
    }


@router.get("/players/{user_id}/profile")
async def public_profile(user_id: int, s: Session) -> dict[str, Any]:
    user = await s.get(User, user_id)
    p = await s.get(PlayerProfile, user_id)
    if user is None or p is None or user.is_guest:
        raise HTTPException(404, detail={"code": "not_found", "message": "player not found"})
    rows = (
        await s.execute(
            select(MatchParticipant, MatchRow)
            .join(MatchRow, MatchRow.id == MatchParticipant.match_id)
            .where(MatchParticipant.user_id == user_id)
            .order_by(MatchRow.finished_at.desc())
            .limit(RECENT_MATCHES)
        )
    ).all()
    return {
        "user_id": user.id,
        "display_name": user.display_name,
        "joined": user.created_at.date().isoformat(),
        "level": p.level,
        "xp": p.xp,
        "matches_played": p.matches_played,
        "wins": p.wins,
        "win_rate": win_rate(p.wins, p.matches_played),
        "units_delivered": p.units_delivered,
        "equipped": p.equipped or {},
        "achievements": [
            {
                "id": a,
                "name": catalog.ACHIEVEMENTS_BY_ID[a].name,
                "description": catalog.ACHIEVEMENTS_BY_ID[a].description,
            }
            for a in p.achievements
            if a in catalog.ACHIEVEMENTS_BY_ID
        ],
        "recent_matches": [
            {
                "map_id": m.map_id,
                "finished_at": m.finished_at.isoformat(),
                "mode": m.result.get("mode", "classic"),
                "role": role_of(m.result, mp.contestant_id),
                "won": won(m.result, mp.contestant_id),
                "score": mp.score,
            }
            for mp, m in rows
        ],
    }
