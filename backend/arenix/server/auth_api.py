"""Account endpoints: register (or upgrade a guest), sign in, sign out, change password, delete."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from .. import accounts
from ..accounts import AccountError
from ..economy import service
from .economy_api import CurrentUser, Session, bearer
from .protocol import PlayerName

router = APIRouter(prefix="/api")

LOGIN_FAILURES_PER_EMAIL = 5  # per 15 minutes


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RegisterRequest(_Body):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=accounts.MAX_PASSWORD)
    display_name: PlayerName
    over_13: bool


class LoginRequest(_Body):
    email: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=accounts.MAX_PASSWORD)


class PasswordRequest(_Body):
    current_password: str = Field(min_length=1, max_length=accounts.MAX_PASSWORD)
    new_password: str = Field(min_length=1, max_length=accounts.MAX_PASSWORD)


class DeleteRequest(_Body):
    password: str | None = Field(default=None, max_length=accounts.MAX_PASSWORD)
    confirm: bool


def _ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _limited(request: Request, limiter: str, key: str) -> None:
    if not getattr(request.app.state, limiter).allow(key):
        raise HTTPException(429, detail={"code": "rate_limited", "message": "Too many attempts. Try again later."})


def _error(e: AccountError) -> HTTPException:
    return HTTPException(e.status, detail={"code": e.code, "message": str(e)})


def _account(user: Any, token: str) -> dict[str, Any]:
    return {"user_id": user.id, "token": token, "display_name": user.display_name, "email": user.email}


@router.post("/auth/register", status_code=201)
async def register(
    body: RegisterRequest, request: Request, s: Session, authorization: Annotated[str | None, Header()] = None
) -> dict[str, Any]:
    _limited(request, "register_limiter", _ip(request))
    if not body.over_13:
        raise HTTPException(400, detail={"code": "age", "message": "You must be 13 or older to create an account."})
    guest = await service.user_for_token(s, bearer(authorization))
    try:
        user, token = await accounts.register(s, body.email, body.password, body.display_name, guest)
    except AccountError as e:
        raise _error(e) from None
    await s.commit()
    return _account(user, token)


@router.post("/auth/login")
async def login(body: LoginRequest, request: Request, s: Session) -> dict[str, Any]:
    _limited(request, "login_limiter", _ip(request))
    email_key = body.email.strip().lower()
    if not request.app.state.login_failures.allow_check(email_key):
        raise HTTPException(
            429, detail={"code": "locked", "message": "Too many wrong passwords. Try again in 15 minutes."}
        )
    try:
        user, token = await accounts.login(s, body.email, body.password)
    except AccountError as e:
        request.app.state.login_failures.allow(email_key)  # count the failure
        raise _error(e) from None
    await s.commit()
    return _account(user, token)


@router.post("/auth/logout")
async def logout(s: Session, authorization: Annotated[str | None, Header()] = None) -> dict[str, Any]:
    token = bearer(authorization)
    if token:
        await accounts.logout(s, token)
        await s.commit()
    return {"ok": True}


@router.get("/auth/me")
async def whoami(user: CurrentUser) -> dict[str, Any]:
    return {"user_id": user.id, "display_name": user.display_name, "email": user.email, "is_guest": user.is_guest}


@router.post("/auth/password")
async def change_password(
    body: PasswordRequest,
    request: Request,
    user: CurrentUser,
    s: Session,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    _limited(request, "login_limiter", _ip(request))
    try:
        await accounts.change_password(s, user, body.current_password, body.new_password, bearer(authorization))
    except AccountError as e:
        raise _error(e) from None
    await s.commit()
    return {"ok": True, "other_devices_signed_out": True}


@router.delete("/players/me")
async def delete_me(body: DeleteRequest, request: Request, user: CurrentUser, s: Session) -> dict[str, Any]:
    _limited(request, "login_limiter", _ip(request))
    if not body.confirm:
        raise HTTPException(400, detail={"code": "confirm", "message": "Confirm that you want to delete your account."})
    try:
        await accounts.delete_account(s, user, body.password)
    except AccountError as e:
        raise _error(e) from None
    await s.commit()
    return {"ok": True, "deleted": True}
