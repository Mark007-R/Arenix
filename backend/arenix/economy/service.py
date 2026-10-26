"""Economy service: accounts, ledger, crates, purchases, inventory and match rewards.

Invariants (all enforced inside one database transaction per operation):
* every balance change is a ledger row with a unique idempotency key, written together with the
  profile balance it produces, while that profile row is locked (SELECT … FOR UPDATE);
* balances never go negative (CHECK constraints back up the application checks);
* a crate opening with the same (user, idempotency key) returns the original result and never
  charges twice; rewards are drawn on the server with `secrets` and recorded with the roll;
* real-money purchases require explicit confirmation and an adult confirmation, use a mock
  provider in development, and never see card data.
"""

from __future__ import annotations

import hashlib
import os
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import (
    AuthSession,
    CosmeticItem,
    CrateDefinition,
    CrateOpening,
    CrateRewardEntry,
    CurrencyTransaction,
    PlayerInventory,
    PlayerProfile,
    User,
)
from . import catalog

EQUIP_SLOTS = {"skin": "skin", "hat": "hat", "effect": "effect"}


class EconomyError(Exception):
    def __init__(self, code: str, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def paid_random_crates_enabled() -> bool:
    """Deployment switch for regions where paid random rewards are restricted."""
    return os.environ.get("ARENIX_PAID_RANDOM_CRATES", "enabled").lower() != "disabled"


# ---------------------------------------------------------------- catalog seeding
async def seed_catalog(s: AsyncSession) -> None:
    """Idempotently upsert the catalog into the database (items, crates, reward tables)."""
    catalog.validate_catalog()
    for it in catalog.ITEMS:
        row = await s.get(CosmeticItem, it.id)
        if row is None:
            s.add(
                CosmeticItem(
                    id=it.id,
                    name=it.name,
                    kind=it.kind,
                    rarity=it.rarity,
                    data=it.data,
                    duplicate_refund_points=it.refund,
                )
            )
        else:
            row.name, row.kind, row.rarity, row.data, row.duplicate_refund_points = (
                it.name,
                it.kind,
                it.rarity,
                it.data,
                it.refund,
            )
    await s.flush()
    for c in catalog.CRATES:
        crate_row = await s.get(CrateDefinition, c.id)
        if crate_row is None:
            s.add(
                CrateDefinition(
                    id=c.id,
                    name=c.name,
                    currency=c.currency,
                    price=c.price,
                    sort_order=c.sort_order,
                    table_version=c.table_version(),
                )
            )
        else:
            crate_row.name, crate_row.currency, crate_row.price = c.name, c.currency, c.price
            crate_row.sort_order, crate_row.table_version = c.sort_order, c.table_version()
        await s.flush()
        existing = {
            e.item_id: e
            for e in (await s.scalars(select(CrateRewardEntry).where(CrateRewardEntry.crate_id == c.id))).all()
        }
        wanted = dict(c.entries())
        for item_id, entry in existing.items():
            if item_id not in wanted:
                await s.delete(entry)
        for item_id, weight in wanted.items():
            if item_id in existing:
                existing[item_id].weight = weight
            else:
                s.add(CrateRewardEntry(crate_id=c.id, item_id=item_id, weight=weight))
    await s.flush()


# ---------------------------------------------------------------- accounts
async def create_guest(s: AsyncSession, display_name: str) -> tuple[User, str]:
    token = secrets.token_urlsafe(32)
    user = User(display_name=display_name, session_token_hash=hash_token(token), is_guest=True)
    s.add(user)
    await s.flush()
    s.add(PlayerProfile(user_id=user.id, achievements=[], equipped={}))
    await s.flush()
    await credit(s, user.id, "game_points", catalog.STARTING_GAME_POINTS, "welcome", f"welcome:{user.id}")
    return user, token


async def user_for_token(s: AsyncSession, token: str) -> User | None:
    """A guest token, or an unexpired, unrevoked session of a registered account."""
    if not token:
        return None
    h = hash_token(token)
    user = await s.scalar(select(User).where(User.session_token_hash == h, User.is_guest.is_(True)))
    if user is not None:
        return user
    session = await s.scalar(
        select(AuthSession).where(
            AuthSession.token_hash == h, AuthSession.revoked.is_(False), AuthSession.expires_at > datetime.now(UTC)
        )
    )
    return await s.get(User, session.user_id) if session is not None else None


async def _locked_profile(s: AsyncSession, user_id: int) -> PlayerProfile:
    profile = await s.scalar(select(PlayerProfile).where(PlayerProfile.user_id == user_id).with_for_update())
    if profile is None:
        raise EconomyError("no_profile", "player profile not found", 404)
    return profile


# ---------------------------------------------------------------- ledger
async def _apply(
    s: AsyncSession,
    profile: PlayerProfile,
    currency: str,
    amount: int,
    reason: str,
    key: str,
    ref_type: str | None = None,
    ref_id: str | None = None,
) -> CurrencyTransaction:
    """Ledger write for an already-locked profile. Idempotent on `key`."""
    existing = await s.scalar(select(CurrencyTransaction).where(CurrencyTransaction.idempotency_key == key))
    if existing is not None:
        return existing
    balance = getattr(profile, currency) + amount
    if balance < 0:
        raise EconomyError("insufficient_funds", f"not enough {currency.replace('_', ' ')}", 402)
    setattr(profile, currency, balance)
    tx = CurrencyTransaction(
        user_id=profile.user_id,
        currency=currency,
        amount=amount,
        balance_after=balance,
        reason=reason,
        ref_type=ref_type,
        ref_id=ref_id,
        idempotency_key=key,
    )
    s.add(tx)
    await s.flush()
    return tx


async def credit(
    s: AsyncSession,
    user_id: int,
    currency: str,
    amount: int,
    reason: str,
    key: str,
    ref_type: str | None = None,
    ref_id: str | None = None,
) -> CurrencyTransaction:
    if amount <= 0:
        raise ValueError("credit amount must be positive")
    return await _apply(s, await _locked_profile(s, user_id), currency, amount, reason, key, ref_type, ref_id)


# ---------------------------------------------------------------- crates
@dataclass
class OpeningResult:
    opening_id: int
    crate_id: str
    item: dict[str, Any]
    duplicate: bool
    refund_points: int
    price: int
    currency: str
    roll: int
    replayed: bool  # True if this idempotency key was already used (no second charge)


def _item_dict(it: CosmeticItem) -> dict[str, Any]:
    return {"id": it.id, "name": it.name, "kind": it.kind, "rarity": it.rarity, "data": it.data}


def pick_index(weights: list[int], roll: int) -> int:
    """Map a uniform roll in [0, sum(weights)) to an entry index. Each index owns exactly `weight` rolls."""
    if not 0 <= roll < sum(weights):
        raise ValueError("roll out of range")
    acc = 0
    for i, w in enumerate(weights):
        acc += w
        if roll < acc:
            return i
    raise AssertionError("unreachable")


async def crate_listing(s: AsyncSession) -> list[dict[str, Any]]:
    crates = (
        await s.scalars(select(CrateDefinition).where(CrateDefinition.active).order_by(CrateDefinition.sort_order))
    ).all()
    out = []
    paid_ok = paid_random_crates_enabled()
    for c in crates:
        rows = (
            await s.execute(
                select(CrateRewardEntry, CosmeticItem)
                .join(CosmeticItem, CosmeticItem.id == CrateRewardEntry.item_id)
                .where(CrateRewardEntry.crate_id == c.id)
            )
        ).all()
        total = sum(e.weight for e, _ in rows)
        by_rarity: dict[str, int] = {}
        for e, it in rows:
            by_rarity[it.rarity] = by_rarity.get(it.rarity, 0) + e.weight
        out.append(
            {
                "id": c.id,
                "name": c.name,
                "currency": c.currency,
                "price": c.price,
                "table_version": c.table_version,
                "available": c.currency == "game_points" or paid_ok,
                "unavailable_reason": None
                if c.currency == "game_points" or paid_ok
                else "Paid random crates are unavailable in this region.",
                "odds_by_rarity": [
                    {"rarity": r, "probability": by_rarity[r] / total} for r in catalog.RARITIES if r in by_rarity
                ],
                "items": sorted(
                    ({**_item_dict(it), "probability": e.weight / total} for e, it in rows),
                    key=lambda x: (catalog.RARITIES.index(x["rarity"]), x["id"]),
                ),
            }
        )
    return out


async def open_crate(
    s: AsyncSession, user_id: int, crate_id: str, idempotency_key: str, randbelow: Any = secrets.randbelow
) -> OpeningResult:
    if not (8 <= len(idempotency_key) <= 128):
        raise EconomyError("bad_idempotency_key", "Idempotency-Key header (8-128 chars) is required")
    profile = await _locked_profile(s, user_id)  # serialises concurrent openings for this user
    previous = await s.scalar(
        select(CrateOpening).where(CrateOpening.user_id == user_id, CrateOpening.idempotency_key == idempotency_key)
    )
    if previous is not None:
        item = await s.get(CosmeticItem, previous.item_id)
        assert item is not None
        return OpeningResult(
            previous.id,
            previous.crate_id,
            _item_dict(item),
            previous.duplicate,
            previous.refund_points,
            previous.price,
            previous.currency,
            previous.roll,
            True,
        )
    crate = await s.get(CrateDefinition, crate_id)
    if crate is None or not crate.active:
        raise EconomyError("unknown_crate", "crate not found", 404)
    if crate.currency == "diamonds" and not paid_random_crates_enabled():
        raise EconomyError("region_restricted", "Paid random crates are unavailable in this region.", 451)
    entries = (
        await s.scalars(
            select(CrateRewardEntry).where(CrateRewardEntry.crate_id == crate_id).order_by(CrateRewardEntry.id)
        )
    ).all()
    total = sum(e.weight for e in entries)
    if total != catalog.WEIGHT_TOTAL:
        raise EconomyError("misconfigured_crate", "crate odds are misconfigured", 500)

    await _apply(
        s, profile, crate.currency, -crate.price, "crate_open", f"crate:{user_id}:{idempotency_key}", "crate", crate_id
    )
    roll = int(randbelow(total))
    chosen = entries[pick_index([e.weight for e in entries], roll)]
    item = await s.get(CosmeticItem, chosen.item_id)
    assert item is not None
    owned = await s.scalar(
        select(PlayerInventory).where(PlayerInventory.user_id == user_id, PlayerInventory.item_id == item.id)
    )
    refund = item.duplicate_refund_points if owned is not None else 0
    opening = CrateOpening(
        user_id=user_id,
        crate_id=crate_id,
        idempotency_key=idempotency_key,
        currency=crate.currency,
        price=crate.price,
        roll=roll,
        table_version=crate.table_version,
        item_id=item.id,
        duplicate=owned is not None,
        refund_points=refund,
    )
    s.add(opening)
    await s.flush()
    if owned is None:
        s.add(PlayerInventory(user_id=user_id, item_id=item.id, source=f"crate:{crate_id}"))
    elif refund:
        await _apply(
            s, profile, "game_points", refund, "duplicate_refund", f"dup:{opening.id}", "crate_opening", str(opening.id)
        )
    await s.flush()
    return OpeningResult(
        opening.id, crate_id, _item_dict(item), owned is not None, refund, crate.price, crate.currency, roll, False
    )


# ---------------------------------------------------------------- purchases (mock provider)
async def purchase_diamonds(
    s: AsyncSession, user_id: int, pack_id: str, confirmed: bool, idempotency_key: str
) -> dict[str, Any]:
    pack = catalog.PACKS_BY_ID.get(pack_id)
    if pack is None:
        raise EconomyError("unknown_pack", "unknown diamond pack", 404)
    if not confirmed:
        raise EconomyError("confirmation_required", "explicit purchase confirmation is required")
    if not (8 <= len(idempotency_key) <= 128):
        raise EconomyError("bad_idempotency_key", "Idempotency-Key header (8-128 chars) is required")
    profile = await _locked_profile(s, user_id)
    if not profile.adult_confirmed:
        raise EconomyError("age_restricted", "Purchases require confirming you are an adult.", 403)
    # Mock payment provider: always "succeeds", records an order id, stores no payment details.
    order_id = "mock_" + hashlib.sha256(f"{user_id}:{idempotency_key}".encode()).hexdigest()[:16]
    tx = await _apply(
        s,
        profile,
        "diamonds",
        pack.diamonds,
        "purchase",
        f"purchase:{user_id}:{idempotency_key}",
        "mock_order",
        order_id,
    )
    return {
        "order_id": order_id,
        "pack_id": pack.id,
        "diamonds": pack.diamonds,
        "charged_usd_cents": pack.price_usd_cents,
        "provider": "mock",
        "balance": tx.balance_after,
    }


async def credit_paid_pack(
    s: AsyncSession, user_id: int, pack_id: str, order_id: str, amount_paid_cents: int | None
) -> dict[str, Any] | None:
    """Credit a pack the payment provider has confirmed as paid. Idempotent on the provider order id.

    Returns None (and credits nothing) when the user or pack no longer exists, or when the amount
    paid does not match the pack price (a tampered or misconfigured checkout).
    """
    pack = catalog.PACKS_BY_ID.get(pack_id)
    if pack is None or (amount_paid_cents is not None and amount_paid_cents != pack.price_usd_cents):
        return None
    if await s.get(PlayerProfile, user_id) is None:
        return None
    profile = await _locked_profile(s, user_id)
    tx = await _apply(
        s, profile, "diamonds", pack.diamonds, "purchase", f"stripe:{order_id}", "stripe_checkout", order_id
    )
    return {"user_id": user_id, "pack_id": pack.id, "diamonds": pack.diamonds, "balance": tx.balance_after}


# ---------------------------------------------------------------- inventory
async def inventory(s: AsyncSession, user_id: int) -> list[dict[str, Any]]:
    rows = (
        await s.execute(
            select(PlayerInventory, CosmeticItem)
            .join(CosmeticItem, CosmeticItem.id == PlayerInventory.item_id)
            .where(PlayerInventory.user_id == user_id)
            .order_by(PlayerInventory.acquired_at)
        )
    ).all()
    return [{**_item_dict(it), "acquired_at": inv.acquired_at.isoformat(), "source": inv.source} for inv, it in rows]


async def equip(s: AsyncSession, user_id: int, slot: str, item_id: str | None) -> dict[str, Any]:
    if slot not in EQUIP_SLOTS:
        raise EconomyError("bad_slot", "unknown slot")
    profile = await _locked_profile(s, user_id)
    if item_id is not None:
        item = await s.get(CosmeticItem, item_id)
        if item is None or item.kind != EQUIP_SLOTS[slot]:
            raise EconomyError("bad_item", "that item doesn't fit this slot")
        owned = await s.scalar(
            select(PlayerInventory).where(PlayerInventory.user_id == user_id, PlayerInventory.item_id == item_id)
        )
        if owned is None:
            raise EconomyError("not_owned", "you don't own that item", 403)
    equipped = dict(profile.equipped or {})
    equipped[slot] = item_id
    profile.equipped = equipped
    await s.flush()
    return equipped


async def loadout(s: AsyncSession, user_id: int) -> dict[str, Any]:
    """Equipped cosmetics resolved to render data + unlocked chat phrases, for use in matches."""
    profile = await s.get(PlayerProfile, user_id)
    if profile is None:
        return {}
    out: dict[str, Any] = {}
    for slot, item_id in (profile.equipped or {}).items():
        if item_id:
            item = await s.get(CosmeticItem, item_id)
            if item is not None:
                out[slot] = {"id": item.id, "rarity": item.rarity, **item.data}
    phrases: dict[str, str] = {}
    for it in await inventory(s, user_id):
        if it["kind"] == "chat_pack":
            phrases.update(it["data"].get("phrases", {}))
    out["phrases"] = phrases
    return out


async def profile_view(s: AsyncSession, user: User) -> dict[str, Any]:
    p = await s.get(PlayerProfile, user.id)
    assert p is not None
    return {
        "user_id": user.id,
        "display_name": user.display_name,
        "level": p.level,
        "xp": p.xp,
        "game_points": p.game_points,
        "diamonds": p.diamonds,
        "matches_played": p.matches_played,
        "wins": p.wins,
        "units_delivered": p.units_delivered,
        "shrines_awakened": p.shrines_awakened,
        "achievements": [
            {
                "id": a,
                "name": catalog.ACHIEVEMENTS_BY_ID[a].name,
                "description": catalog.ACHIEVEMENTS_BY_ID[a].description,
            }
            for a in p.achievements
            if a in catalog.ACHIEVEMENTS_BY_ID
        ],
        "equipped": p.equipped or {},
        "adult_confirmed": p.adult_confirmed,
    }


async def transactions(s: AsyncSession, user_id: int, limit: int = 50) -> list[dict[str, Any]]:
    rows = (
        await s.scalars(
            select(CurrencyTransaction)
            .where(CurrencyTransaction.user_id == user_id)
            .order_by(CurrencyTransaction.id.desc())
            .limit(limit)
        )
    ).all()
    return [
        {
            "id": t.id,
            "currency": t.currency,
            "amount": t.amount,
            "balance_after": t.balance_after,
            "reason": t.reason,
            "created_at": t.created_at.isoformat(),
        }
        for t in rows
    ]
