"""Registered accounts: email + password, device sessions, password changes and deletion.

Passwords are hashed with scrypt (stdlib `hashlib.scrypt`, memory-hard) and a per-password
random salt; only the hash string is stored. Session tokens are 256-bit random values; only
their sha256 is stored (like guest tokens). A guest can upgrade in place, keeping progress.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .db.models import AuthSession, PlayerProfile, User
from .economy import catalog, service

SESSION_DAYS = 30
SCRYPT_N, SCRYPT_R, SCRYPT_P = 2**14, 8, 1
MIN_PASSWORD = 10
MAX_PASSWORD = 128
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,189}\.[a-zA-Z]{2,24}$")
# A tiny list of the most common passwords; length rules catch most of the rest.
COMMON_PASSWORDS = frozenset(
    {
        "password123", "1234567890", "qwertyuiop", "password12", "iloveyou12", "1q2w3e4r5t",
        "qwerty1234", "123456789a", "abcdefghij", "passw0rd123",
    }
)  # fmt: skip


class AccountError(Exception):
    def __init__(self, code: str, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


def normalize_email(email: str) -> str:
    email = email.strip().lower()
    if len(email) > 254 or not EMAIL_RE.match(email):
        raise AccountError("bad_email", "Enter a valid email address.")
    return email


def check_password_rules(password: str, email: str | None = None) -> None:
    if len(password) < MIN_PASSWORD:
        raise AccountError("weak_password", f"Use at least {MIN_PASSWORD} characters.")
    if len(password) > MAX_PASSWORD:
        raise AccountError("weak_password", f"Use at most {MAX_PASSWORD} characters.")
    low = password.lower()
    if low in COMMON_PASSWORDS or len(set(low)) < 4 or (email and email.split("@")[0] in low):
        raise AccountError("weak_password", "That password is too easy to guess.")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=32)
    b64 = base64.b64encode
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${b64(salt).decode()}${b64(digest).decode()}"


def verify_password(password: str, stored: str | None) -> bool:
    """Constant-time check. With stored=None a dummy hash is computed so timing doesn't reveal accounts."""
    if not stored:
        hashlib.scrypt(password.encode(), salt=b"0" * 16, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=32)
        return False
    try:
        _, n, r, p, salt, digest = stored.split("$")
        expected = base64.b64decode(digest)
        got = hashlib.scrypt(
            password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=len(expected)
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(got, expected)


async def new_session(s: AsyncSession, user: User) -> str:
    token = secrets.token_urlsafe(32)
    s.add(
        AuthSession(
            user_id=user.id,
            token_hash=service.hash_token(token),
            expires_at=datetime.now(UTC) + timedelta(days=SESSION_DAYS),
            revoked=False,
        )
    )
    await s.flush()
    return token


async def register(
    s: AsyncSession, email: str, password: str, display_name: str, guest: User | None
) -> tuple[User, str]:
    """Create an account, or upgrade the calling guest in place (keeping progress)."""
    email = normalize_email(email)
    check_password_rules(password, email)
    if await s.scalar(select(User.id).where(User.email == email)) is not None:
        raise AccountError("email_taken", "An account with that email already exists. Sign in instead.", 409)
    if guest is not None and guest.is_guest:
        user = guest
        user.display_name = display_name
    else:
        user = User(display_name=display_name, session_token_hash=service.hash_token(secrets.token_urlsafe(32)))
        s.add(user)
        await s.flush()
        s.add(PlayerProfile(user_id=user.id, achievements=[], equipped={}))
        await s.flush()
        await service.credit(s, user.id, "game_points", catalog.STARTING_GAME_POINTS, "welcome", f"welcome:{user.id}")
    user.email = email
    user.password_hash = hash_password(password)
    user.is_guest = False
    # The guest token stops working: from now on only email + password sessions sign in.
    user.session_token_hash = service.hash_token(secrets.token_urlsafe(32))
    await s.flush()
    return user, await new_session(s, user)


async def login(s: AsyncSession, email: str, password: str) -> tuple[User, str]:
    try:
        email = normalize_email(email)
    except AccountError:
        email = ""
    user = await s.scalar(select(User).where(User.email == email)) if email else None
    if not verify_password(password, user.password_hash if user else None) or user is None:
        raise AccountError("bad_credentials", "Wrong email or password.", 401)
    return user, await new_session(s, user)


async def logout(s: AsyncSession, token: str) -> None:
    await s.execute(update(AuthSession).where(AuthSession.token_hash == service.hash_token(token)).values(revoked=True))


async def change_password(s: AsyncSession, user: User, current: str, new: str, keep_token: str) -> None:
    if user.is_guest or not verify_password(current, user.password_hash):
        raise AccountError("bad_credentials", "Your current password is wrong.", 401)
    check_password_rules(new, user.email)
    user.password_hash = hash_password(new)
    # Sign out every other device.
    await s.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user.id, AuthSession.token_hash != service.hash_token(keep_token))
        .values(revoked=True)
    )


async def delete_account(s: AsyncSession, user: User, password: str | None) -> None:
    """Permanently delete the account and its progression (match history keeps names only)."""
    if not user.is_guest and not verify_password(password or "", user.password_hash):
        raise AccountError("bad_credentials", "Your password is wrong.", 401)
    await s.execute(delete(User).where(User.id == user.id))
