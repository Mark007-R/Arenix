"""Leaderboards and public profiles (needs PostgreSQL)."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update

from arenix.db.models import PlayerProfile
from arenix.db.session import Database
from arenix.server.app import create_app
from arenix.server.economy_api import won

from .test_accounts import GOOD, URL, auth, fresh_schema  # noqa: F401 (fixture)


@pytest.fixture
def client() -> Any:
    with TestClient(create_app(db=Database(URL))) as c:
        yield c


def set_stats(user_id: int, **values: int) -> None:
    async def go() -> None:
        db = Database(URL)
        try:
            async with db.sessions.begin() as s:
                await s.execute(update(PlayerProfile).where(PlayerProfile.user_id == user_id).values(**values))
        finally:
            await db.dispose()

    asyncio.run(go())


def register(client: TestClient, email: str, name: str) -> dict[str, Any]:
    r = client.post(
        "/api/auth/register", json={"email": email, "password": GOOD, "display_name": name, "over_13": True}
    )
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def test_leaderboards_rank_registered_players_only(client: TestClient) -> None:
    a = register(client, "ace@example.com", "Ace")
    b = register(client, "bea@example.com", "Bea")
    guest = client.post("/api/auth/guest", json={"display_name": "Ghost"}).json()
    set_stats(a["user_id"], wins=9, matches_played=30, level=3, xp=900)
    set_stats(b["user_id"], wins=6, matches_played=10, level=5, xp=2000)
    set_stats(guest["user_id"], wins=99, matches_played=99)
    by_wins = client.get("/api/leaderboard").json()["entries"]
    names = [e["display_name"] for e in by_wins]
    assert names[:2] == ["Ace", "Bea"] and "Ghost" not in names
    assert by_wins[0]["rank"] == 1 and by_wins[0]["win_rate"] == 0.3
    assert "email" not in str(by_wins)
    assert [e["display_name"] for e in client.get("/api/leaderboard?by=level").json()["entries"]][:2] == ["Bea", "Ace"]
    assert [e["display_name"] for e in client.get("/api/leaderboard?by=win_rate").json()["entries"]][:2] == [
        "Bea",
        "Ace",
    ]
    assert client.get("/api/leaderboard?by=diamonds").status_code == 422


def test_public_profile(client: TestClient) -> None:
    c = register(client, "cy@example.com", "Cy")
    p = client.get(f"/api/players/{c['user_id']}/profile").json()
    assert p["display_name"] == "Cy" and p["recent_matches"] == [] and p["level"] >= 1
    for secret in ("email", "game_points", "diamonds", "cy@example.com"):
        assert secret not in str(p)
    guest = client.post("/api/auth/guest", json={"display_name": "Hidden"}).json()
    assert client.get(f"/api/players/{guest['user_id']}/profile").status_code == 404
    assert client.get("/api/players/999999/profile").status_code == 404
    assert client.get("/api/players/me", headers=auth(c["token"])).status_code == 200  # route order intact


def test_team_wins_count() -> None:
    assert won({"winners": ["p1", "p2"], "winner": "p1"}, "p2")
    assert not won({"winners": [], "winner": None}, "p2")
    assert won({"winner": "p3"}, "p3")
