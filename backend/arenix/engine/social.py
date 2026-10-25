"""Social rules: chat validation, quick-chat phrases, alliances and secret objectives.

Messages are *claims*. Nothing here treats what a contestant says as evidence that something
happened; only Match events are facts.
"""

from __future__ import annotations

import random
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any

CHAT_MAX_LEN = 140
CHAT_COOLDOWN_TICKS = 30  # 1.5 s
ALLIANCE_PROPOSAL_TTL_TICKS = 15 * 20

# The free base pack. Cosmetic packs (Milestone 5) add phrases; they never bypass validation.
QUICK_CHAT: dict[str, str] = {
    "trust_me": "Trust me, I have a plan!",
    "alliance": "Alliance?",
    "suspicious": "That was suspicious.",
    "saw_nothing": "I saw nothing!",
    "meet_castle": "Meet me near the castle.",
    "never_friends": "We were never friends.",
    "betrayal": "The betrayal is crazy.",
    "vote_wisely": "Vote wisely.",
    "well_played": "Well played!",
    "gg": "GG, everyone!",
    "need_stone": "We need more stone.",
    "need_wood": "We need more wood.",
    "protect": "I will protect the team.",
    "promised": "You promised!",
    "who_trust": "Who can we trust?",
    "mission_complete": "Mission complete!",
    "shrine_help": "Help me at the shrine!",
}

# Deliberately small placeholder list; a real deployment plugs in a moderation service here.
_BLOCKLIST = ("fuck", "shit", "cunt", "nigger", "faggot", "retard")
_CONTROL = re.compile(r"[\u0000-\u001f\u007f-\u009f​-‏ -‮⁦-⁩]")


def sanitize_chat(text: str) -> str | None:
    """Normalise free text. Returns None when it is empty or not allowed."""
    text = unicodedata.normalize("NFKC", text)
    text = _CONTROL.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()
    if not text or len(text) > CHAT_MAX_LEN:
        return None
    lowered = re.sub(r"[^a-z]", "", text.lower())
    if any(word in lowered for word in _BLOCKLIST):
        return None
    return text


@dataclass
class Proposal:
    proposer: str
    target: str
    expires_tick: int


@dataclass
class Alliances:
    """Pair alliances. A contestant can be in at most one alliance at a time."""

    partner: dict[str, str] = field(default_factory=dict)
    proposals: list[Proposal] = field(default_factory=list)

    def ally_of(self, cid: str) -> str | None:
        return self.partner.get(cid)

    def allied(self, a: str, b: str) -> bool:
        return self.partner.get(a) == b

    def pending_for(self, target: str, tick: int) -> list[Proposal]:
        return [p for p in self.proposals if p.target == target and p.expires_tick > tick]

    def expire(self, tick: int) -> list[Proposal]:
        expired = [p for p in self.proposals if p.expires_tick <= tick]
        self.proposals = [p for p in self.proposals if p.expires_tick > tick]
        return expired

    def form(self, a: str, b: str) -> None:
        self.partner[a] = b
        self.partner[b] = a
        self.proposals = [p for p in self.proposals if {p.proposer, p.target}.isdisjoint({a, b})]

    def dissolve(self, a: str) -> str | None:
        b = self.partner.pop(a, None)
        if b is not None:
            self.partner.pop(b, None)
        return b


# ---------------------------------------------------------------- secret objectives
OBJECTIVE_BONUS = 60


@dataclass(frozen=True)
class Objective:
    kind: str  # deliver_wood | deliver_stone | survive | eliminate | ally_at_end | shrine
    amount: int = 0
    target: str | None = None

    def describe(self, names: dict[str, str]) -> str:
        if self.kind == "deliver_wood":
            return f"Personally deliver at least {self.amount} wood."
        if self.kind == "deliver_stone":
            return f"Personally deliver at least {self.amount} stone."
        if self.kind == "survive":
            return "Survive every council vote."
        if self.kind == "eliminate":
            return f"Make sure {names.get(self.target or '', self.target)} is voted out."
        if self.kind == "ally_at_end":
            return "Be in an alliance when the match ends."
        return "Take part in activating the Ancient Shrine."

    def to_dict(self, names: dict[str, str]) -> dict[str, Any]:
        return {"kind": self.kind, "amount": self.amount, "target": self.target, "text": self.describe(names)}


def assign_objectives(ids: list[str], rng: random.Random) -> dict[str, Objective]:
    out: dict[str, Objective] = {}
    for cid in ids:
        kinds = ["deliver_wood", "deliver_stone", "survive", "ally_at_end", "shrine"]
        if len(ids) >= 3:
            kinds.append("eliminate")
        kind = rng.choice(kinds)
        if kind == "deliver_wood":
            out[cid] = Objective(kind, amount=4)
        elif kind == "deliver_stone":
            out[cid] = Objective(kind, amount=3)
        elif kind == "eliminate":
            out[cid] = Objective(kind, target=rng.choice([o for o in ids if o != cid]))
        else:
            out[cid] = Objective(kind)
    return out
