"""Accounts, progression and economy endpoints. All state changes are validated server-side."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import MatchParticipant, MatchRow, PlayerProfile, User
from ..db.session import Database
from ..economy import catalog, service
from ..economy.records import match_detail
from ..economy.service import EconomyError
from .protocol import PlayerName


def won(result: dict[str, Any], contestant_id: str) -> bool:
    """Team modes list every winner; classic mode names one."""
    winners = result.get("winners")
    if winners is not None:
        return contestant_id in winners
    return result.get("winner") == contestant_id


router = APIRouter(prefix="/api")


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GuestRequest(_Body):
    display_name: PlayerName


class EquipRequest(_Body):
    slot: str = Field(pattern=r"^(skin|hat|effect)$")
    item_id: str | None = Field(default=None, max_length=48, pattern=r"^[a-z0-9_]+$")


class AgeRequest(_Body):
    is_adult: bool


class PurchaseRequest(_Body):
    pack_id: str = Field(max_length=32, pattern=r"^[a-z0-9_]+$")
    confirm: bool


def get_db(request: Request) -> Database:
    db: Database | None = request.app.state.db
    if db is None:
        raise HTTPException(
            503,
            detail={"code": "persistence_disabled", "message": "Progression is disabled on this server (no database)."},
        )
    return db


async def get_session(db: Annotated[Database, Depends(get_db)]):  # type: ignore[no-untyped-def]
    """One session per request. Endpoints commit explicitly (before responding); anything else rolls back."""
    async with db.sessions() as s:
        try:
            yield s
        finally:
            if s.in_transaction():
                await s.rollback()


def bearer(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        return ""
    return authorization.removeprefix("Bearer ").strip()


async def current_user(
    s: Annotated[AsyncSession, Depends(get_session)],
    authorization: Annotated[str | None, Header()] = None,
) -> User:
    user = await service.user_for_token(s, bearer(authorization))
    if user is None:
        raise HTTPException(401, detail={"code": "unauthorized", "message": "Sign in first."})
    return user


def econ_error(e: EconomyError) -> HTTPException:
    return HTTPException(e.status, detail={"code": e.code, "message": str(e)})


Session = Annotated[AsyncSession, Depends(get_session)]
CurrentUser = Annotated[User, Depends(current_user)]


@router.post("/auth/guest", status_code=201)
async def create_guest(body: GuestRequest, request: Request, s: Session) -> dict[str, Any]:
    ip = request.client.host if request.client else "unknown"
    if not request.app.state.guest_limiter.allow(ip):
        raise HTTPException(429, detail={"code": "rate_limited", "message": "slow down"})
    user, token = await service.create_guest(s, body.display_name)
    await s.commit()
    return {"user_id": user.id, "token": token, "display_name": user.display_name}


@router.get("/players/me")
async def me(user: CurrentUser, s: Session) -> dict[str, Any]:
    return await service.profile_view(s, user)


@router.get("/players/me/currencies")
async def currencies(user: CurrentUser, s: Session) -> dict[str, Any]:
    p = await s.get(PlayerProfile, user.id)
    assert p is not None
    return {
        "game_points": p.game_points,
        "diamonds": p.diamonds,
        "transactions": await service.transactions(s, user.id),
    }


@router.get("/players/me/inventory")
async def inventory(user: CurrentUser, s: Session) -> dict[str, Any]:
    p = await s.get(PlayerProfile, user.id)
    assert p is not None
    return {"items": await service.inventory(s, user.id), "equipped": p.equipped or {}}


@router.post("/players/me/equip")
async def equip(body: EquipRequest, user: CurrentUser, s: Session) -> dict[str, Any]:
    try:
        equipped = await service.equip(s, user.id, body.slot, body.item_id)
        await s.commit()
    except EconomyError as e:
        raise econ_error(e) from None
    return {"equipped": equipped}


@router.post("/players/me/age")
async def confirm_age(body: AgeRequest, user: CurrentUser, s: Session) -> dict[str, Any]:
    p = await s.get(PlayerProfile, user.id, with_for_update=True)
    assert p is not None
    p.adult_confirmed = body.is_adult
    await s.commit()
    return {"adult_confirmed": body.is_adult}


@router.get("/players/me/matches")
async def my_matches(user: CurrentUser, s: Session) -> dict[str, Any]:
    rows = (
        await s.execute(
            select(MatchParticipant, MatchRow)
            .join(MatchRow, MatchRow.id == MatchParticipant.match_id)
            .where(MatchParticipant.user_id == user.id)
            .order_by(MatchRow.finished_at.desc())
            .limit(20)
        )
    ).all()
    return {
        "matches": [
            {
                "match_id": m.id,
                "finished_at": m.finished_at.isoformat(),
                "placement": p.placement,
                "score": p.score,
                "alive": p.alive,
                "won": won(m.result, p.contestant_id),
            }
            for p, m in rows
        ]
    }


@router.get("/matches/{match_id}")
async def get_match(match_id: str, s: Session) -> dict[str, Any]:
    detail = await match_detail(s, match_id)
    if detail is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "match not found"})
    return detail


@router.get("/crates")
async def crates(s: Session) -> dict[str, Any]:
    return {
        "crates": await service.crate_listing(s),
        "duplicate_refund_points": catalog.DUPLICATE_REFUND,
        "note": "Crates contain cosmetic items only. Duplicates convert into Game Points.",
    }


@router.post("/crates/{crate_id}/open")
async def open_crate(
    crate_id: str,
    user: CurrentUser,
    s: Session,
    request: Request,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=128)],
) -> dict[str, Any]:
    if not request.app.state.open_limiter.allow(str(user.id)):
        raise HTTPException(429, detail={"code": "rate_limited", "message": "slow down"})
    try:
        r = await service.open_crate(s, user.id, crate_id, idempotency_key)
        p = await s.get(PlayerProfile, user.id)
        assert p is not None
        balance = {"game_points": p.game_points, "diamonds": p.diamonds}
        await s.commit()
    except EconomyError as e:
        raise econ_error(e) from None
    return {
        "opening_id": r.opening_id,
        "crate_id": r.crate_id,
        "item": r.item,
        "duplicate": r.duplicate,
        "refund_points": r.refund_points,
        "price": r.price,
        "currency": r.currency,
        "replayed": r.replayed,
        "balance": balance,
    }


@router.get("/store/packs")
async def packs() -> dict[str, Any]:
    return {
        "provider": "mock",
        "notice": "Development build: purchases use a mock provider. No payment details are collected "
        "and nothing is charged.",
        "packs": [
            {"id": p.id, "label": p.label, "diamonds": p.diamonds, "price_usd_cents": p.price_usd_cents}
            for p in catalog.DIAMOND_PACKS
        ],
    }


@router.post("/store/purchases")
async def purchase(
    body: PurchaseRequest,
    user: CurrentUser,
    s: Session,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=128)],
) -> dict[str, Any]:
    try:
        result = await service.purchase_diamonds(s, user.id, body.pack_id, body.confirm, idempotency_key)
        await s.commit()
        return result
    except EconomyError as e:
        raise econ_error(e) from None


@router.get("/achievements")
async def achievements() -> dict[str, Any]:
    return {"achievements": [vars(a) for a in catalog.ACHIEVEMENTS]}
