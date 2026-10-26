"""Registered accounts, sessions, lockouts, deletion, reports and security headers (needs PostgreSQL)."""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from arenix.accounts import hash_password, verify_password
from arenix.db.session import Database
from arenix.server.app import create_app

URL = os.environ.get("ARENIX_TEST_DATABASE_URL", "postgresql+asyncpg://arenix:arenix@localhost/arenix_test")
GOOD = "correct horse battery"


@pytest.fixture(scope="module", autouse=True)
def fresh_schema() -> None:
    async def reset() -> None:
        db = Database(URL)
        try:
            async with db.engine.begin() as conn:
                await conn.execute(text("DROP SCHEMA public CASCADE"))
                await conn.execute(text("CREATE SCHEMA public"))
        finally:
            await db.dispose()

    try:
        asyncio.run(reset())
    except (OSError, DBAPIError) as e:  # pragma: no cover - depends on environment
        pytest.skip(f"PostgreSQL unavailable: {e}")
    root = os.path.dirname(os.path.dirname(__file__))
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=root,
        env={**os.environ, "ARENIX_DATABASE_URL": URL},
        check=True,
        capture_output=True,
    )


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setenv("ARENIX_ADMIN_TOKEN", "admin-secret-token")
    with TestClient(create_app(db=Database(URL))) as c:
        yield c


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_password_hashing() -> None:
    h = hash_password(GOOD)
    assert h.startswith("scrypt$") and GOOD not in h
    assert verify_password(GOOD, h) and not verify_password("wrong password!", h)
    assert hash_password(GOOD) != h  # salted
    assert not verify_password(GOOD, None) and not verify_password(GOOD, "garbage")


def test_register_login_logout(client: TestClient) -> None:
    r = client.post(
        "/api/auth/register",
        json={"email": "Alice@Example.com", "password": GOOD, "display_name": "Alice", "over_13": True},
    )
    assert r.status_code == 201, r.text
    first = r.json()
    assert first["email"] == "alice@example.com"
    assert client.get("/api/auth/me", headers=auth(first["token"])).json()["is_guest"] is False
    # Same email again is refused; wrong password is generic.
    dup = {"email": "alice@example.com", "password": GOOD, "display_name": "Alice2", "over_13": True}
    assert client.post("/api/auth/register", json=dup).status_code == 409
    bad = client.post("/api/auth/login", json={"email": "alice@example.com", "password": "nope nope nope"})
    assert bad.status_code == 401 and bad.json()["detail"]["code"] == "bad_credentials"
    missing = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": GOOD})
    assert missing.json()["detail"] == bad.json()["detail"]  # no account enumeration
    second = client.post("/api/auth/login", json={"email": "ALICE@example.com", "password": GOOD}).json()
    assert second["token"] != first["token"]
    # Logging out one device leaves the other signed in.
    client.post("/api/auth/logout", headers=auth(first["token"]))
    assert client.get("/api/auth/me", headers=auth(first["token"])).status_code == 401
    assert client.get("/api/auth/me", headers=auth(second["token"])).status_code == 200


@pytest.mark.parametrize(
    ("password", "code"),
    [("short", "weak_password"), ("password123", "weak_password"), ("aaaaaaaaaaaa", "weak_password")],
)
def test_password_rules(client: TestClient, password: str, code: str) -> None:
    r = client.post(
        "/api/auth/register",
        json={"email": "rules@example.com", "password": password, "display_name": "Rules", "over_13": True},
    )
    assert r.status_code == 400 and r.json()["detail"]["code"] == code


def test_under_13_and_bad_names_are_refused(client: TestClient) -> None:
    base = {"email": "kid@example.com", "password": GOOD, "display_name": "Kid"}
    assert client.post("/api/auth/register", json={**base, "over_13": False}).json()["detail"]["code"] == "age"
    assert (
        client.post("/api/auth/register", json={**base, "display_name": "Fuckface", "over_13": True}).status_code == 422
    )


def test_guest_upgrade_keeps_progress(client: TestClient) -> None:
    guest = client.post("/api/auth/guest", json={"display_name": "Gus"}).json()
    points = client.get("/api/players/me", headers=auth(guest["token"])).json()["game_points"]
    r = client.post(
        "/api/auth/register",
        headers=auth(guest["token"]),
        json={"email": "gus@example.com", "password": GOOD, "display_name": "Gus", "over_13": True},
    )
    assert r.status_code == 201 and r.json()["user_id"] == guest["user_id"]
    assert client.get("/api/players/me", headers=auth(r.json()["token"])).json()["game_points"] == points
    assert client.get("/api/auth/me", headers=auth(guest["token"])).status_code == 401  # old guest token retired


def test_password_change_signs_out_other_devices(client: TestClient) -> None:
    a = client.post(
        "/api/auth/register",
        json={"email": "pat@example.com", "password": GOOD, "display_name": "Pat", "over_13": True},
    ).json()
    b = client.post("/api/auth/login", json={"email": "pat@example.com", "password": GOOD}).json()
    new = "an even better passphrase"
    wrong = client.post(
        "/api/auth/password", headers=auth(a["token"]), json={"current_password": "wrong one!", "new_password": new}
    )
    assert wrong.status_code == 401
    ok = client.post(
        "/api/auth/password", headers=auth(a["token"]), json={"current_password": GOOD, "new_password": new}
    )
    assert ok.status_code == 200
    assert client.get("/api/auth/me", headers=auth(a["token"])).status_code == 200
    assert client.get("/api/auth/me", headers=auth(b["token"])).status_code == 401
    assert client.post("/api/auth/login", json={"email": "pat@example.com", "password": new}).status_code == 200


def test_lockout_after_repeated_failures(client: TestClient) -> None:
    client.post(
        "/api/auth/register",
        json={"email": "lock@example.com", "password": GOOD, "display_name": "Lock", "over_13": True},
    )
    for _ in range(5):
        assert (
            client.post("/api/auth/login", json={"email": "lock@example.com", "password": "x" * 12}).status_code == 401
        )
    r = client.post("/api/auth/login", json={"email": "lock@example.com", "password": GOOD})
    assert r.status_code == 429 and r.json()["detail"]["code"] == "locked"


def test_delete_account(client: TestClient) -> None:
    a = client.post(
        "/api/auth/register",
        json={"email": "del@example.com", "password": GOOD, "display_name": "Del", "over_13": True},
    ).json()
    h = auth(a["token"])
    assert client.request("DELETE", "/api/players/me", headers=h, json={"confirm": False}).status_code == 400
    assert (
        client.request(
            "DELETE", "/api/players/me", headers=h, json={"confirm": True, "password": "wrong!!!!!"}
        ).status_code
        == 401
    )
    assert client.request("DELETE", "/api/players/me", headers=h, json={"confirm": True, "password": GOOD}).json()[
        "deleted"
    ]
    assert client.get("/api/auth/me", headers=h).status_code == 401
    assert client.post("/api/auth/login", json={"email": "del@example.com", "password": GOOD}).status_code == 401


def test_security_headers(client: TestClient) -> None:
    r = client.get("/api/auth/me")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Cache-Control"] == "no-store"


def test_reports_carry_server_side_evidence(client: TestClient) -> None:
    with client.websocket_connect("/ws/practice?name=Rep&archetype=knight&bots=4") as ws:
        while json.loads(ws.receive_text())["type"] != "welcome":
            pass
        ws.send_text(json.dumps({"type": "report", "target": "bot1", "reason": "spam", "note": "kept spamming"}))
        ws.send_text(json.dumps({"type": "report", "target": "bot1", "reason": "spam"}))
        ws.send_text(json.dumps({"type": "report", "target": "p1", "reason": "spam"}))
        got: list[dict[str, Any]] = []
        while len(got) < 3:
            m = json.loads(ws.receive_text())
            if m["type"] in ("report_ack", "error"):
                got.append(m)
    assert got[0] == {"type": "report_ack", "target": "bot1"}
    assert got[1]["code"] == "already_reported" and got[2]["code"] == "invalid_target"
    assert client.get("/api/admin/reports").status_code == 403
    reports = client.get("/api/admin/reports", headers=auth("admin-secret-token")).json()["reports"]
    mine = [r for r in reports if r["reported_name"] == "Brakka"]
    assert mine and mine[0]["reason"] == "spam" and mine[0]["note"] == "kept spamming"
    assert isinstance(mine[0]["evidence"], list)
    rid = mine[0]["id"]
    ok = client.post(f"/api/admin/reports/{rid}", headers=auth("admin-secret-token"), json={"status": "reviewed"})
    assert ok.status_code == 200
