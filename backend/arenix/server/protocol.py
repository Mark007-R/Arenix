"""Validated wire protocol for the realtime channel.

Every inbound client message is parsed into one of these models; anything else is rejected.
The server never trusts positions, outcomes or rewards from the client — only intents.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

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


ClientMessage = Annotated[InputMsg | InteractMsg | PingMsg, Field(discriminator="type")]
client_message_adapter: TypeAdapter[InputMsg | InteractMsg | PingMsg] = TypeAdapter(ClientMessage)


class JoinParams(_Msg):
    name: str = Field(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9 _\-]+$")
    archetype: str = Field(min_length=1, max_length=20)
    bots: int = Field(default=2, ge=0, le=7)
