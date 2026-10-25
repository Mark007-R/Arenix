"""Validated wire protocol for the realtime channel.

Every inbound client message is parsed into one of these models; anything else is rejected.
The server never trusts positions, outcomes or rewards from the client — only intents.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

MAX_MESSAGE_BYTES = 1024


class _Msg(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class InputMsg(_Msg):
    type: Literal["input"]
    seq: int = Field(ge=1, le=2**31)
    dx: float = Field(ge=-1.0, le=1.0, allow_inf_nan=False)
    dy: float = Field(ge=-1.0, le=1.0, allow_inf_nan=False)


class InteractMsg(_Msg):
    type: Literal["interact"]
    target_id: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9_]+$")


class PingMsg(_Msg):
    type: Literal["ping"]
    t: float = Field(allow_inf_nan=False)


class ReadyMsg(_Msg):
    type: Literal["ready"]
    ready: bool


class SetArchetypeMsg(_Msg):
    type: Literal["set_archetype"]
    archetype: str = Field(min_length=1, max_length=20, pattern=r"^[a-z]+$")


class SetFillMsg(_Msg):
    type: Literal["set_fill"]
    fill_to: int = Field(ge=1, le=10)


class StartMsg(_Msg):
    type: Literal["start"]


ContestantId = Annotated[str, Field(min_length=1, max_length=16, pattern=r"^[a-z0-9]+$")]


class ChatMsg(_Msg):
    """Exactly one of text (free text, sanitised server-side) or quick (a phrase id)."""

    type: Literal["chat"]
    text: str | None = Field(default=None, max_length=200)
    quick: str | None = Field(default=None, max_length=32, pattern=r"^[a-z_]+$")
    to: ContestantId | None = None

    @model_validator(mode="after")
    def _one_body(self) -> ChatMsg:
        if (self.text is None) == (self.quick is None):
            raise ValueError("send either text or quick")
        return self


class VoteMsg(_Msg):
    type: Literal["vote"]
    target: ContestantId | None  # None = skip


class ProposeMsg(_Msg):
    type: Literal["propose"]
    target: ContestantId


class RespondMsg(_Msg):
    type: Literal["respond"]
    proposer: ContestantId
    accept: bool


class BreakMsg(_Msg):
    type: Literal["break_alliance"]


AnyClientMessage = (
    InputMsg
    | InteractMsg
    | PingMsg
    | ReadyMsg
    | SetArchetypeMsg
    | SetFillMsg
    | StartMsg
    | ChatMsg
    | VoteMsg
    | ProposeMsg
    | RespondMsg
    | BreakMsg
)
ClientMessage = Annotated[AnyClientMessage, Field(discriminator="type")]
client_message_adapter: TypeAdapter[AnyClientMessage] = TypeAdapter(ClientMessage)

PlayerName = Annotated[str, Field(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9 _\-]+$")]
Archetype = Annotated[str, Field(min_length=1, max_length=20, pattern=r"^[a-z]+$")]


class JoinParams(_Msg):
    name: PlayerName
    archetype: Archetype
    bots: int = Field(default=2, ge=0, le=7)


class CreateRoomRequest(_Msg):
    name: PlayerName
    archetype: Archetype
    fill_to: int = Field(default=6, ge=1, le=10)


class JoinRoomRequest(_Msg):
    name: PlayerName
    archetype: Archetype


class SeatGrant(BaseModel):
    """Returned once to the joining player. The token is the reconnect credential; keep it private."""

    code: str
    player_id: str
    token: str
