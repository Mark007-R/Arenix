"""Economy against a real PostgreSQL database (skipped when ARENIX_TEST_DATABASE_URL is unreachable)."""

import asyncio
import os
from collections import Counter
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from arenix.db.models import CrateOpening, CurrencyTransaction, GameEventRow, PlayerInventory, PlayerProfile
from arenix.db.session import Database
from arenix.economy import catalog, service
from arenix.economy.records import persist_match
from arenix.economy.service import EconomyError
from arenix.engine.map import GameMap
from arenix.engine.match import Match

URL = os.environ.get("ARENIX_TEST_DATABASE_URL", "postgresql+asyncpg://arenix:arenix@localhost/arenix_test")


def run[T](coro_fn: Callable[[Database], Awaitable[T]]) -> T:
    async def wrapper() -> T:
        db = Database(URL)
        try:
            return await coro_fn(db)
        finally:
            await db.dispose()

    return asyncio.run(wrapper())


@pytest.fixture(scope="module", autouse=True)
def fresh_schema() -> None:
    """Recreate the schema from the Alembic migration, then seed the catalog."""
    import subprocess
    import sys

    async def reset(db: Database) -> None:
        async with db.engine.begin() as conn:
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))

    try:
        run(reset)
    except OSError as e:  # pragma: no cover - depends on environment
        pytest.skip(f"PostgreSQL unavailable: {e}")
    except DBAPIError as e:  # pragma: no cover
        if "connect" in str(e).lower() or "password" in str(e).lower():
            pytest.skip(f"PostgreSQL unavailable: {e}")
        raise
    env = {**os.environ, "ARENIX_DATABASE_URL": URL}
    root = os.path.dirname(os.path.dirname(__file__))
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"], cwd=root, env=env, check=True, capture_output=True
    )

    async def seed(db: Database) -> None:
        async with db.sessions.begin() as s:
            await service.seed_catalog(s)

    run(seed)


async def new_user(db: Database, name: str = "Tester", points: int = 0, diamonds: int = 0) -> int:
    async with db.sessions.begin() as s:
        user, _ = await service.create_guest(s, name)
        if points:
            await service.credit(s, user.id, "game_points", points, "test", f"test-gp:{user.id}")
        if diamonds:
            await service.credit(s, user.id, "diamonds", diamonds, "test", f"test-d:{user.id}")
        return user.id


async def balances(db: Database, uid: int) -> tuple[int, int]:
    async with db.sessions() as s:
        p = await s.get(PlayerProfile, uid)
        assert p is not None
        return p.game_points, p.diamonds


# ------------------------------------------------------------------ catalog & odds
def test_catalog_odds_sum_exactly() -> None:
    catalog.validate_catalog()
    for crate in catalog.CRATES:
        assert sum(w for _, w in crate.entries()) == catalog.WEIGHT_TOTAL


def test_pick_index_assigns_each_entry_exactly_its_weight() -> None:
    for crate in catalog.CRATES:
        weights = [w for _, w in crate.entries()]
        counts = Counter(service.pick_index(weights, r) for r in range(sum(weights)))
        assert [counts[i] for i in range(len(weights))] == weights
    with pytest.raises(ValueError):
        service.pick_index([1, 2], 3)


def test_listing_shows_probabilities_that_sum_to_one() -> None:
    async def body(db: Database) -> list[dict[str, Any]]:
        async with db.sessions() as s:
            return await service.crate_listing(s)

    listing = run(body)
    assert [c["id"] for c in listing] == ["bronze", "silver", "gold", "platinum", "diamond"]
    for c in listing:
        assert sum(i["probability"] for i in c["items"]) == pytest.approx(1.0)
        assert sum(r["probability"] for r in c["odds_by_rarity"]) == pytest.approx(1.0)
    currencies = {c["id"]: c["currency"] for c in listing}
    assert currencies == {
        "bronze": "game_points",
        "silver": "game_points",
        "gold": "game_points",
        "platinum": "diamonds",
        "diamond": "diamonds",
    }


def test_seeding_is_idempotent() -> None:
    async def body(db: Database) -> int:
        async with db.sessions.begin() as s:
            await service.seed_catalog(s)
        async with db.sessions() as s:
            return len((await s.execute(text("select * from crate_reward_tables"))).all())

    assert run(body) == sum(len(c.entries()) for c in catalog.CRATES)


# ------------------------------------------------------------------ ledger
def test_guest_starts_with_welcome_points_and_credit_is_idempotent() -> None:
    async def body(db: Database) -> None:
        uid = await new_user(db)
        assert await balances(db, uid) == (catalog.STARTING_GAME_POINTS, 0)
        for _ in range(3):
            async with db.sessions.begin() as s:
                await service.credit(s, uid, "game_points", 40, "bonus", f"bonus:{uid}")
        assert await balances(db, uid) == (catalog.STARTING_GAME_POINTS + 40, 0)
        async with db.sessions() as s:
            txs = (await s.scalars(select(CurrencyTransaction).where(CurrencyTransaction.user_id == uid))).all()
        assert [t.amount for t in txs] == [catalog.STARTING_GAME_POINTS, 40]
        assert txs[-1].balance_after == catalog.STARTING_GAME_POINTS + 40

    run(body)


def test_database_rejects_negative_balances() -> None:
    async def body(db: Database) -> None:
        uid = await new_user(db)
        with pytest.raises(IntegrityError):
            async with db.sessions.begin() as s:
                await s.execute(text("update player_profiles set game_points = -1 where user_id = :u"), {"u": uid})

    run(body)


# ------------------------------------------------------------------ crates
def test_open_crate_charges_grants_and_records_roll() -> None:
    async def body(db: Database) -> None:
        uid = await new_user(db, points=1000)
        async with db.sessions.begin() as s:
            r = await service.open_crate(s, uid, "bronze", "open-key-0001", randbelow=lambda n: 0)
        first_item = catalog.CRATES_BY_ID["bronze"].entries()[0][0]
        assert r.item["id"] == first_item and r.roll == 0 and not r.duplicate and not r.replayed
        assert await balances(db, uid) == (catalog.STARTING_GAME_POINTS + 1000 - 100, 0)
        async with db.sessions() as s:
            inv = await service.inventory(s, uid)
            opening = await s.scalar(select(CrateOpening).where(CrateOpening.user_id == uid))
        assert [i["id"] for i in inv] == [first_item]
        assert opening is not None and opening.table_version == catalog.CRATES_BY_ID["bronze"].table_version()

    run(body)


def test_repeated_idempotency_key_never_charges_twice() -> None:
    async def body(db: Database) -> None:
        uid = await new_user(db, points=1000)
        results = []
        for _ in range(3):
            async with db.sessions.begin() as s:
                results.append(await service.open_crate(s, uid, "silver", "same-key-123"))
        assert len({r.opening_id for r in results}) == 1
        assert [r.replayed for r in results] == [False, True, True]
        assert await balances(db, uid) == (catalog.STARTING_GAME_POINTS + 1000 - 250, 0)

    run(body)


def test_concurrent_openings_cannot_overspend() -> None:
    async def body(db: Database) -> None:
        uid = await new_user(db)  # 150 points: exactly one bronze crate

        async def attempt(i: int) -> str:
            try:
                async with db.sessions.begin() as s:
                    await service.open_crate(s, uid, "bronze", f"race-key-{i:04d}")
                return "ok"
            except EconomyError as e:
                return e.code

        outcomes = await asyncio.gather(*(attempt(i) for i in range(6)))
        assert outcomes.count("ok") == 1 and outcomes.count("insufficient_funds") == 5
        assert (await balances(db, uid))[0] == catalog.STARTING_GAME_POINTS - 100

    run(body)


def test_concurrent_same_key_opens_once() -> None:
    async def body(db: Database) -> None:
        uid = await new_user(db, points=1000)

        async def attempt() -> int:
            async with db.sessions.begin() as s:
                return (await service.open_crate(s, uid, "bronze", "dup-race-key")).opening_id

        ids = await asyncio.gather(*(attempt() for _ in range(5)))
        assert len(set(ids)) == 1
        assert (await balances(db, uid))[0] == catalog.STARTING_GAME_POINTS + 1000 - 100

    run(body)


def test_insufficient_funds_changes_nothing() -> None:
    async def body(db: Database) -> None:
        uid = await new_user(db)
        with pytest.raises(EconomyError) as e:
            async with db.sessions.begin() as s:
                await service.open_crate(s, uid, "gold", "poor-key-001")
        assert e.value.code == "insufficient_funds" and e.value.status == 402
        with pytest.raises(EconomyError) as e2:
            async with db.sessions.begin() as s:
                await service.open_crate(s, uid, "platinum", "poor-key-002")  # diamonds crate
        assert e2.value.code == "insufficient_funds"
        assert await balances(db, uid) == (catalog.STARTING_GAME_POINTS, 0)
        async with db.sessions() as s:
            assert (await s.scalar(select(CrateOpening).where(CrateOpening.user_id == uid))) is None

    run(body)


def test_duplicates_are_refunded_in_game_points() -> None:
    async def body(db: Database) -> None:
        uid = await new_user(db, points=1000)
        async with db.sessions.begin() as s:
            await service.open_crate(s, uid, "bronze", "dupe-key-001", randbelow=lambda n: 0)
        async with db.sessions.begin() as s:
            r = await service.open_crate(s, uid, "bronze", "dupe-key-002", randbelow=lambda n: 0)
        assert r.duplicate and r.refund_points == catalog.DUPLICATE_REFUND["common"]
        gp, _ = await balances(db, uid)
        assert gp == catalog.STARTING_GAME_POINTS + 1000 - 200 + catalog.DUPLICATE_REFUND["common"]
        async with db.sessions() as s:
            assert len((await s.scalars(select(PlayerInventory).where(PlayerInventory.user_id == uid))).all()) == 1

    run(body)


def test_paid_random_crates_can_be_disabled_by_region(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ARENIX_PAID_RANDOM_CRATES", "disabled")

    async def body(db: Database) -> None:
        uid = await new_user(db, diamonds=500)
        with pytest.raises(EconomyError) as e:
            async with db.sessions.begin() as s:
                await service.open_crate(s, uid, "diamond", "region-key-01")
        assert e.value.status == 451
        async with db.sessions() as s:
            listing = {c["id"]: c for c in await service.crate_listing(s)}
        assert not listing["diamond"]["available"] and listing["bronze"]["available"]
        async with db.sessions.begin() as s:
            await service.open_crate(s, uid, "bronze", "region-key-02")  # free-currency crates still work

    run(body)


# ------------------------------------------------------------------ purchases
def test_mock_purchase_requires_confirmation_and_adult_and_is_idempotent() -> None:
    async def body(db: Database) -> None:
        uid = await new_user(db)
        with pytest.raises(EconomyError) as e:
            async with db.sessions.begin() as s:
                await service.purchase_diamonds(s, uid, "pack_small", False, "buy-key-0001")
        assert e.value.code == "confirmation_required"
        with pytest.raises(EconomyError) as e:
            async with db.sessions.begin() as s:
                await service.purchase_diamonds(s, uid, "pack_small", True, "buy-key-0001")
        assert e.value.code == "age_restricted"
        async with db.sessions.begin() as s:
            p = await s.get(PlayerProfile, uid)
            assert p is not None
            p.adult_confirmed = True
        for _ in range(2):
            async with db.sessions.begin() as s:
                r = await service.purchase_diamonds(s, uid, "pack_small", True, "buy-key-0001")
        assert r["provider"] == "mock" and r["diamonds"] == 100
        assert await balances(db, uid) == (catalog.STARTING_GAME_POINTS, 100)

    run(body)


# ------------------------------------------------------------------ inventory
def test_equip_requires_ownership_and_matching_slot() -> None:
    async def body(db: Database) -> None:
        uid = await new_user(db, points=1000)
        async with db.sessions.begin() as s:
            r = await service.open_crate(s, uid, "bronze", "equip-key-01", randbelow=lambda n: 0)
        skin = r.item["id"]
        assert r.item["kind"] == "skin"
        async with db.sessions.begin() as s:
            assert (await service.equip(s, uid, "skin", skin))["skin"] == skin
        for slot, item, code in (
            ("hat", skin, "bad_item"),
            ("skin", "skin_starlight", "not_owned"),
            ("weapon", skin, "bad_slot"),
        ):
            with pytest.raises(EconomyError) as e:
                async with db.sessions.begin() as s:
                    await service.equip(s, uid, slot, item)
            assert e.value.code == code
        async with db.sessions() as s:
            loadout = await service.loadout(s, uid)
        assert loadout["skin"]["id"] == skin and "tunic" in loadout["skin"]

    run(body)


# ------------------------------------------------------------------ match persistence & rewards
def test_persist_match_awards_once_and_event_log_is_append_only(emerald: GameMap) -> None:
    m = Match("persist-test-1", emerald, 5, time_limit_seconds=3, meetings=False)
    m.add_contestant("p1", "Human", "knight", is_bot=False)
    m.add_contestant("bot1", "Bot", "rogue", is_bot=True)
    m.start()
    while m.status == "running":
        m.step()

    async def body(db: Database) -> None:
        uid = await new_user(db)
        async with db.sessions.begin() as s:
            rewards = await persist_match(s, m, None, "ROOM01", {"p1": uid})
        assert rewards[uid]["game_points"] > 0
        assert {a["id"] for a in rewards[uid]["achievements"]} >= {"first_match"}
        async with db.sessions.begin() as s:
            again = await persist_match(s, m, None, "ROOM01", {"p1": uid})
        assert again == {}
        gp, _ = await balances(db, uid)
        expected = (
            catalog.STARTING_GAME_POINTS
            + rewards[uid]["game_points"]
            + sum(a["game_points"] for a in rewards[uid]["achievements"])
        )
        assert gp == expected
        async with db.sessions() as s:
            seqs = (
                await s.scalars(
                    select(GameEventRow.seq).where(GameEventRow.match_id == m.id).order_by(GameEventRow.seq)
                )
            ).all()
        assert list(seqs) == list(range(1, len(m.events) + 1))
        with pytest.raises(DBAPIError, match="append-only"):
            async with db.sessions.begin() as s:
                await s.execute(text("update game_events set type = 'tampered' where match_id = :m"), {"m": m.id})
        with pytest.raises(DBAPIError, match="append-only"):
            async with db.sessions.begin() as s:
                await s.execute(text("delete from game_events where match_id = :m"), {"m": m.id})

    run(body)
