"""Real-money diamond packs through Stripe Checkout, plus the runtime configuration of the store.

Which provider is used:
  * ``stripe`` when ``STRIPE_SECRET_KEY`` is set: players pay on Stripe's hosted page (we never see
    card details), and diamonds are credited only when Stripe's signed webhook confirms payment.
  * ``mock`` in development: purchases "succeed" without charging anything.
  * ``off`` in production without Stripe keys (``ARENIX_PRODUCTION=1``): the store shows packs but
    cannot sell them.

Crediting is idempotent on the Checkout Session id, so Stripe's webhook retries never double-credit.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import time
from dataclasses import dataclass
from typing import Any, Literal

import httpx

Provider = Literal["stripe", "mock", "off"]

STRIPE_API = "https://api.stripe.com/v1"
SIGNATURE_TOLERANCE_S = 300  # reject webhook deliveries older than 5 minutes (replay protection)


def provider() -> Provider:
    if os.environ.get("STRIPE_SECRET_KEY"):
        return "stripe"
    return "off" if os.environ.get("ARENIX_PRODUCTION") == "1" else "mock"


def public_config() -> dict[str, Any]:
    """Settings the web client needs; read at runtime so changing them needs no rebuild."""
    donate = os.environ.get("ARENIX_DONATE_URL", "")
    return {
        "payments": provider(),
        # Only https links: this ends up in an <a href> on every page.
        "donate_url": donate if donate.startswith("https://") else None,
        "contact_email": os.environ.get("ARENIX_CONTACT_EMAIL") or None,
    }


class PaymentError(Exception):
    def __init__(self, code: str, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


@dataclass(frozen=True)
class CheckoutSession:
    id: str
    url: str


async def create_checkout(
    *, user_id: int, pack_id: str, label: str, diamonds: int, price_usd_cents: int, return_url: str
) -> CheckoutSession:
    """Create a Stripe Checkout Session for one diamond pack and return its hosted payment page."""
    key = os.environ.get("STRIPE_SECRET_KEY", "")
    if not key:
        raise PaymentError("payments_disabled", "Payments are not enabled on this server.", 503)
    form = {
        "mode": "payment",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": os.environ.get("ARENIX_CURRENCY", "usd"),
        "line_items[0][price_data][unit_amount]": str(price_usd_cents),
        "line_items[0][price_data][product_data][name]": f"{label} ({diamonds} diamonds)",
        "client_reference_id": str(user_id),
        "metadata[user_id]": str(user_id),
        "metadata[pack_id]": pack_id,
        "success_url": f"{return_url}?purchase=success",
        "cancel_url": f"{return_url}?purchase=cancelled",
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(f"{STRIPE_API}/checkout/sessions", data=form, auth=(key, ""))
    except httpx.HTTPError:
        raise PaymentError("payment_unavailable", "Could not reach the payment provider. Try again.", 502) from None
    if r.status_code != 200:
        raise PaymentError("payment_unavailable", "The payment provider refused the request.", 502)
    body = r.json()
    return CheckoutSession(id=body["id"], url=body["url"])


def verify_signature(payload: bytes, header: str, secret: str, now: float | None = None) -> bool:
    """Check a ``Stripe-Signature`` header (``t=…,v1=…``): HMAC-SHA256 of ``"{t}.{payload}"``."""
    if not secret or not header:
        return False
    parts: dict[str, list[str]] = {}
    for item in header.split(","):
        k, _, v = item.strip().partition("=")
        parts.setdefault(k, []).append(v)
    try:
        ts = int(parts["t"][0])
    except (KeyError, ValueError):
        return False
    now = time.time() if now is None else now
    if abs(now - ts) > SIGNATURE_TOLERANCE_S:
        return False
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, sig) for sig in parts.get("v1", []))


def sign(payload: bytes, secret: str, ts: int) -> str:
    """Build a Stripe-style signature header (used by tests and local webhook replays)."""
    sig = hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    return f"t={ts},v1={sig}"
