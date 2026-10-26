"""Stripe checkout and webhook, runtime config, static site serving and database URL handling."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from arenix import payments
from arenix.db.session import Database, normalize_url
from arenix.server.app import create_app

from .test_accounts import GOOD, URL, auth, fresh_schema  # noqa: F401 (fixture)

SECRET = "whsec_test_secret"


def test_signature_verification() -> None:
    body = b'{"id":"evt_1"}'
    now = int(time.time())
    good = payments.sign(body, SECRET, now)
    assert payments.verify_signature(body, good, SECRET, now=now)
    assert not payments.verify_signature(body + b" ", good, SECRET, now=now)  # tampered body
    assert not payments.verify_signature(body, good, "whsec_other", now=now)  # wrong secret
    assert not payments.verify_signature(body, good, SECRET, now=now + 3600)  # replayed later
    assert not payments.verify_signature(body, "garbage", SECRET, now=now)
    assert not payments.verify_signature(body, good, "", now=now)  # webhook secret not configured


def test_database_urls_from_hosting_providers() -> None:
    assert (
        normalize_url("postgres://u:p@ep-x.neon.tech/db?sslmode=require&channel_binding=require")
        == "postgresql+asyncpg://u:p@ep-x.neon.tech/db?ssl=require"
    )
    assert normalize_url("postgresql+asyncpg://u:p@h/db") == "postgresql+asyncpg://u:p@h/db"


def test_runtime_config(monkeypatch: pytest.MonkeyPatch) -> None:
    for k in ("STRIPE_SECRET_KEY", "ARENIX_PRODUCTION", "ARENIX_DONATE_URL", "ARENIX_CONTACT_EMAIL"):
        monkeypatch.delenv(k, raising=False)
    with TestClient(create_app(db=None)) as c:
        assert c.get("/api/config").json() == {"payments": "mock", "donate_url": None, "contact_email": None}
        monkeypatch.setenv("ARENIX_PRODUCTION", "1")
        monkeypatch.setenv("ARENIX_DONATE_URL", "javascript:alert(1)")  # never rendered as a link
        assert c.get("/api/config").json()["payments"] == "off"
        assert c.get("/api/config").json()["donate_url"] is None
        monkeypatch.setenv("ARENIX_DONATE_URL", "https://ko-fi.com/example")
        monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_x")
        cfg = c.get("/api/config").json()
        assert cfg["payments"] == "stripe" and cfg["donate_url"] == "https://ko-fi.com/example"
        assert "sk_test" not in json.dumps(cfg)


def test_serves_the_web_client_and_old_invite_links(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("<html>home</html>")
    (tmp_path / "room").mkdir()
    (tmp_path / "room" / "index.html").write_text("<html>room</html>")
    monkeypatch.setenv("ARENIX_STATIC_DIR", str(tmp_path))
    with TestClient(create_app(db=None)) as c:
        assert "home" in c.get("/").text
        assert c.get("/api/health").json()["status"] == "ok"  # API routes win over the site
        r = c.get("/room/abc123", follow_redirects=False)
        assert r.status_code == 308 and r.headers["location"] == "/room/?code=ABC123"
        assert "room" in c.get("/room/?code=ABC123").text
        assert c.get("/room/not-a-code", follow_redirects=False).status_code == 404
        # Pages from this server may open game sockets from the same host.
        with c.websocket_connect(
            "/ws/practice?name=Al&archetype=knight&bots=4", headers={"origin": "http://testserver"}
        ) as ws:
            assert json.loads(ws.receive_text())["type"] in ("welcome", "lobby", "snapshot")


@pytest.fixture
def stripe_api(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_dummy")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", SECRET)
    monkeypatch.setenv("ARENIX_PUBLIC_URL", "https://arenix.example")
    with TestClient(create_app(db=Database(URL))) as c:
        yield c


def buyer(c: TestClient, email: str) -> tuple[int, dict[str, str]]:
    r = c.post("/api/auth/register", json={"email": email, "password": GOOD, "display_name": "Buyer", "over_13": True})
    assert r.status_code == 201, r.text
    h = auth(r.json()["token"])
    return r.json()["user_id"], h


def webhook(c: TestClient, event: dict[str, Any], secret: str = SECRET) -> Any:
    body = json.dumps(event).encode()
    return c.post(
        "/api/stripe/webhook",
        content=body,
        headers={"stripe-signature": payments.sign(body, secret, int(time.time())), "content-type": "application/json"},
    )


def paid(session_id: str, user_id: int, pack: str = "pack_small", amount: int = 99) -> dict[str, Any]:
    return {
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "id": session_id,
                "payment_status": "paid",
                "amount_total": amount,
                "metadata": {"user_id": str(user_id), "pack_id": pack},
            }
        },
    }


def diamonds(c: TestClient, h: dict[str, str]) -> int:
    return int(c.get("/api/players/me/currencies", headers=h).json()["diamonds"])


def test_checkout_requires_account_age_and_confirmation(
    stripe_api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = stripe_api
    seen: dict[str, Any] = {}

    async def fake_checkout(**kw: Any) -> payments.CheckoutSession:
        seen.update(kw)
        return payments.CheckoutSession("cs_test_1", "https://checkout.stripe.com/c/pay/cs_test_1")

    monkeypatch.setattr(payments, "create_checkout", fake_checkout)
    assert c.get("/api/store/packs").json()["provider"] == "stripe"
    guest = auth(c.post("/api/auth/guest", json={"display_name": "Gus"}).json()["token"])
    c.post("/api/players/me/age", headers=guest, json={"is_adult": True})
    r = c.post("/api/store/checkout", headers=guest, json={"pack_id": "pack_small", "confirm": True})
    assert r.json()["detail"]["code"] == "account_required"
    _, h = buyer(c, "pay@example.com")
    assert c.post("/api/store/checkout", headers=h, json={"pack_id": "pack_small", "confirm": True}).status_code == 403
    c.post("/api/players/me/age", headers=h, json={"is_adult": True})
    assert c.post("/api/store/checkout", headers=h, json={"pack_id": "pack_small", "confirm": False}).status_code == 400
    r = c.post("/api/store/checkout", headers=h, json={"pack_id": "pack_small", "confirm": True})
    assert r.status_code == 200 and r.json()["url"].startswith("https://checkout.stripe.com/")
    assert seen["price_usd_cents"] == 99 and seen["return_url"] == "https://arenix.example/collection/"
    # The free mock purchase path is closed once real payments are on.
    hk = {**h, "Idempotency-Key": "buy-http-0002"}
    assert (
        c.post("/api/store/purchases", headers=hk, json={"pack_id": "pack_small", "confirm": True}).status_code == 409
    )


def test_webhook_credits_once_and_only_when_signed_and_paid(stripe_api: TestClient) -> None:
    c = stripe_api
    uid, h = buyer(c, "hook@example.com")
    before = diamonds(c, h)
    assert webhook(c, paid("cs_1", uid), secret="whsec_wrong").status_code == 400
    assert diamonds(c, h) == before
    r = webhook(c, paid("cs_1", uid))
    assert r.status_code == 200 and r.json()["credited"]
    assert diamonds(c, h) == before + 100
    assert webhook(c, paid("cs_1", uid)).status_code == 200  # Stripe retries the same event
    assert diamonds(c, h) == before + 100
    assert not webhook(c, paid("cs_2", uid, amount=1)).json()["credited"]  # paid less than the pack costs
    unpaid = paid("cs_3", uid)
    unpaid["data"]["object"]["payment_status"] = "unpaid"
    webhook(c, unpaid)
    webhook(c, {"type": "customer.created", "data": {"object": {}}})
    assert diamonds(c, h) == before + 100
