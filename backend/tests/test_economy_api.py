"""HTTP economy API + room persistence against PostgreSQL (shares the schema prepared by test_economy)."""

import asyncio
import json
import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from arenix.db.models import GameEventRow, MatchRow
from arenix.db.session import Database
from arenix.economy import catalog
from arenix.server.app import create_app

from .test_economy import URL, fresh_schema  # noqa: F401  (module fixture: migrated + seeded schema)


@pytest.fixture
def api() -> TestClient:
    with TestClient(create_app(db=Database(URL))) as client:
        yield client  # type: ignore[misc]


def guest(api: TestClient, name: str = "Buyer") -> dict[str, str]:
    r = api.post("/api/auth/guest", json={"display_name": name})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_auth_required_and_profile(api: TestClient) -> None:
    assert api.get("/api/players/me").status_code == 401
    assert api.get("/api/players/me", headers={"Authorization": "Bearer nope"}).status_code == 401
    h = guest(api, "Alice")
    me = api.get("/api/players/me", headers=h).json()
    assert me["display_name"] == "Alice" and me["game_points"] == catalog.STARTING_GAME_POINTS
    assert "token" not in json.dumps(me) and "hash" not in json.dumps(me)


def test_crate_listing_is_public_and_shows_odds(api: TestClient) -> None:
    body = api.get("/api/crates").json()
    assert len(body["crates"]) == 5
    gold = next(c for c in body["crates"] if c["id"] == "gold")
    assert gold["price"] == 600 and gold["currency"] == "game_points"
    assert abs(sum(i["probability"] for i in gold["items"]) - 1) < 1e-9


def test_open_crate_over_http_is_idempotent(api: TestClient) -> None:
    h = guest(api)
    assert api.post("/api/crates/bronze/open", headers=h).status_code == 422  # Idempotency-Key required
    key = {**h, "Idempotency-Key": "http-open-0001"}
    first = api.post("/api/crates/bronze/open", headers=key)
    assert first.status_code == 200, first.text
    again = api.post("/api/crates/bronze/open", headers=key).json()
    assert again["opening_id"] == first.json()["opening_id"] and again["replayed"]
    assert again["balance"]["game_points"] == catalog.STARTING_GAME_POINTS - 100
    poor = api.post("/api/crates/bronze/open", headers={**h, "Idempotency-Key": "http-open-0002"})
    assert poor.status_code == 402 and poor.json()["detail"]["code"] == "insufficient_funds"
    inv = api.get("/api/players/me/inventory", headers=h).json()
    assert [i["id"] for i in inv["items"]] == [first.json()["item"]["id"]]


def test_purchase_flow_requires_confirmation_and_adult(api: TestClient) -> None:
    h = guest(api)
    packs = api.get("/api/store/packs").json()
    assert packs["provider"] == "mock" and "nothing is charged" in packs["notice"]
    hk = {**h, "Idempotency-Key": "buy-http-0001"}
    assert (
        api.post("/api/store/purchases", headers=hk, json={"pack_id": "pack_small", "confirm": False}).json()["detail"][
            "code"
        ]
        == "confirmation_required"
    )
    assert (
        api.post("/api/store/purchases", headers=hk, json={"pack_id": "pack_small", "confirm": True}).status_code == 403
    )
    api.post("/api/players/me/age", headers=h, json={"is_adult": True})
    r = api.post("/api/store/purchases", headers=hk, json={"pack_id": "pack_small", "confirm": True})
    assert r.status_code == 200 and r.json()["diamonds"] == 100
    r2 = api.post("/api/store/purchases", headers=hk, json={"pack_id": "pack_small", "confirm": True})
    assert r2.json()["order_id"] == r.json()["order_id"]
    assert api.get("/api/players/me/currencies", headers=h).json()["diamonds"] == 100
    assert api.post("/api/crates/platinum/open", headers={**h, "Idempotency-Key": "plat-open-01"}).status_code == 200


def test_equip_and_loadout_reaches_room_seat(api: TestClient) -> None:
    h = guest(api)
    item = api.post("/api/crates/bronze/open", headers={**h, "Idempotency-Key": "equip-http-01"}).json()["item"]
    slot = {"skin": "skin", "hat": "hat", "effect": "effect"}.get(item["kind"])
    if slot is None:
        pytest.skip("drew a chat pack")
    assert api.post("/api/players/me/equip", headers=h, json={"slot": slot, "item_id": item["id"]}).status_code == 200
    assert api.post("/api/players/me/equip", headers=h, json={"slot": "hat", "item_id": "hat_horns"}).status_code in (
        400,
        403,
    )
    grant = api.post("/api/rooms", headers=h, json={"name": "Styled", "archetype": "knight"}).json()
    lobby = api.get(f"/api/rooms/{grant['code']}").json()
    assert lobby["seats"][0]["cosmetics"][slot]["id"] == item["id"]  # loaded from DB, visible to others


def test_finished_room_match_is_persisted_and_rewarded() -> None:
    from arenix.server.app import encode
    from arenix.server.rooms import Connection, Room

    async def scenario() -> None:
        db = Database(URL)
        sent: list[dict] = []  # type: ignore[type-arg]

        async def send_text(text: str) -> None:
            sent.append(json.loads(text))

        from arenix.economy import service

        async with db.sessions.begin() as s:
            user, _ = await service.create_guest(s, "Winner")
        room = Room("PERSI2", fill_to=2, db=db)
        seat = room.add_seat("Winner", "knight", user_id=user.id)
        conn = Connection(send_text, encode)
        writer = asyncio.create_task(conn.writer())
        room.attach(seat, conn)
        room.set_ready(seat, True)
        room.start(seat)
        match = room.match
        assert match is not None
        match.time_limit_ticks = match.tick + 3
        for _ in range(100):
            await asyncio.sleep(0.05)
            if any(m["type"] == "rewards" for m in sent):
                break
        rewards = next(m for m in sent if m["type"] == "rewards")
        assert rewards["match_id"] == match.id and rewards["game_points"] > 0
        async with db.sessions() as s:
            assert await s.get(MatchRow, match.id) is not None
            n = len((await s.scalars(select(GameEventRow).where(GameEventRow.match_id == match.id))).all())
        assert n == len(match.events)
        conn.closed = True
        conn.wake.set()
        await writer
        await db.dispose()

    if not os.environ.get("CI_SKIP_DB"):
        asyncio.run(scenario())
