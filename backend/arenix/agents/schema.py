"""Structured strategist output.

`DECISION_JSON_SCHEMA` is sent to the model as its output format; `StrategicDecision` re-validates
whatever comes back (never trust a model's output just because a schema was requested).
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Goal = Literal["gather_wood", "gather_stone", "deliver", "shrine", "idle", "keep"]
ActionKind = Literal["message", "vote", "propose_alliance", "respond_alliance", "break_alliance"]
MessageType = Literal[
    "PLAN_PROPOSAL",
    "ALLIANCE_PROPOSAL",
    "ACCEPT",
    "COUNTER_OFFER",
    "REJECT",
    "INFORMATION_SHARE",
    "ACTION_PROPOSAL",
    "VOTE_INTENT",
]
MAX_ACTIONS = 4


class DecisionAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: ActionKind
    msg_type: MessageType | None = None
    to: str | None = Field(default=None, max_length=16)
    text: str | None = Field(default=None, max_length=140)
    reply_to: str | None = Field(default=None, max_length=16)
    plan: str | None = Field(default=None, max_length=200)
    target: str | None = Field(default=None, max_length=16)
    accept: bool | None = None

    @model_validator(mode="after")
    def _fields_for_kind(self) -> DecisionAction:
        if self.kind == "message" and (self.msg_type is None or not self.text):
            raise ValueError("message needs msg_type and text")
        if self.kind == "propose_alliance" and not self.target:
            raise ValueError("propose_alliance needs target")
        if self.kind == "respond_alliance" and (not self.target or self.accept is None):
            raise ValueError("respond_alliance needs target (the proposer) and accept")
        return self


class StrategicDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str = Field(max_length=300)
    goal: Goal
    shrine_meet_in_s: int | None = Field(default=None, ge=0, le=60)
    actions: list[DecisionAction] = Field(default_factory=list, max_length=MAX_ACTIONS)


def _nullable(t: str, **extra: Any) -> dict[str, Any]:
    return {"type": [t, "null"], **extra}


DECISION_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["summary", "goal", "shrine_meet_in_s", "actions"],
    "properties": {
        "summary": {"type": "string", "description": "One or two sentences: what you decided and why."},
        "goal": {"type": "string", "enum": ["gather_wood", "gather_stone", "deliver", "shrine", "idle", "keep"]},
        "shrine_meet_in_s": _nullable("integer", description="With goal=shrine: seconds until the agreed start."),
        "actions": {
            "type": "array",
            "maxItems": MAX_ACTIONS,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["kind", "msg_type", "to", "text", "reply_to", "plan", "target", "accept"],
                "properties": {
                    "kind": {"type": "string", "enum": list(ActionKind.__args__)},  # type: ignore[attr-defined]
                    "msg_type": _nullable("string", enum=[*MessageType.__args__, None]),  # type: ignore[attr-defined]
                    "to": _nullable("string", description="Contestant id for a private message; null = public."),
                    "text": _nullable("string", description="What the message says (max 140 chars)."),
                    "reply_to": _nullable("string", description="correlation_id of the thread you are answering."),
                    "plan": _nullable("string", description="Machine-readable plan detail, e.g. 'shrine in 20s'."),
                    "target": _nullable("string", description="Contestant id for vote/propose/respond; null = skip."),
                    "accept": _nullable("boolean"),
                },
            },
        },
    },
}
