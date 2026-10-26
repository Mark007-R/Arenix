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

# ---------------------------------------------------------------- chat moderation
# A word filter, not a moderation service: it catches the common cases (including leetspeak,
# stretched letters and spaced-out slurs) without flagging innocent words like "Scunthorpe",
# "cockpit" or "Dickens". Players can also mute and report each other.
_CONTROL = re.compile(r"[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]")
_LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i"})
# Rejected outright (slurs, telling people to harm themselves). Long, distinctive stems are also
# matched across spaces ("n i g g e r").
_SEVERE_SPACED = ("nigger", "nigga", "faggot", "retard", "tranny")
_SEVERE_WORDS = frozenset({"kike", "spic", "chink", "kys", "fag", "fags", "coon", "coons", "gook"})
_SEVERE_PHRASES = ("kill yourself", "killyourself", "go die", "hang yourself")
# Masked with asterisks. "Safe" stems match inside words; "risky" stems only as whole words
# (plus common endings), because they hide inside innocent words.
_MILD_INSIDE = ("fuck", "shit", "bitch", "slut", "whore", "wank", "twat", "bastard", "asshole", "dumbass")
_MILD_WORDS = ("dick", "cock", "cunt", "pussy", "ass", "piss", "crap", "damn", "prick", "tits")
_ENDINGS = ("", "s", "es", "ed", "ing", "er", "ers", "y", "head", "heads", "hole", "holes")
_LINK = re.compile(
    r"(https?://|www\.|discord\.gg|\b[a-z0-9-]{2,}\.(com|net|org|io|gg|xyz|ru|me|ly|co|tv|link|app|dev|info)\b)",
    re.IGNORECASE,
)
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
_PHONE = re.compile(r"(\+?\d[\d\s().-]{7,}\d)")


def _norm_word(word: str) -> str:
    w = word.lower().translate(_LEET)
    w = re.sub(r"[^a-z]", "", w)
    return re.sub(r"(.)\1{2,}", r"\1\1", w)  # "fuuuuck" -> "fuuck"


def _is_mild(w: str) -> bool:
    squeezed = re.sub(r"(.)\1+", r"\1", w)  # "fuuck" -> "fuck", "asss" -> "as"
    for cand in {w, squeezed}:
        if any(stem in cand for stem in _MILD_INSIDE):
            return True
        if any(cand == stem + end for stem in _MILD_WORDS for end in _ENDINGS):
            return True
    return False


def _is_severe_word(w: str) -> bool:
    squeezed = re.sub(r"(.)\1+", r"\1", w)
    return w in _SEVERE_WORDS or squeezed in _SEVERE_WORDS or any(s in w for s in _SEVERE_SPACED)


def moderate_chat(text: str) -> tuple[str | None, str]:
    """Normalise and check free text. Returns (clean text, "") or (None, reason)."""
    text = unicodedata.normalize("NFKC", text)
    text = _CONTROL.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()
    if not text or len(text) > CHAT_MAX_LEN:
        return None, "message_rejected"
    if _EMAIL.search(text) or _PHONE.search(text):
        return None, "contact_not_allowed"
    if _LINK.search(text):
        return None, "links_not_allowed"
    low = text.lower().translate(_LEET)
    joined = re.sub(r"[^a-z]", "", low)
    joined = re.sub(r"(.)\1+", r"\1", joined)
    if any(re.sub(r"(.)\1+", r"\1", p.replace(" ", "")) in joined for p in _SEVERE_PHRASES) or any(
        re.sub(r"(.)\1+", r"\1", s) in joined for s in _SEVERE_SPACED
    ):
        return None, "message_rejected"
    words = text.split(" ")
    out = []
    for word in words:
        w = _norm_word(word)
        if w and _is_severe_word(w):
            return None, "message_rejected"
        out.append("*" * len(word) if w and _is_mild(w) else word)
    text = " ".join(out)
    text = re.sub(r"(.)\1{4,}", r"\1\1\1", text)  # "noooooooo" -> "nooo"
    letters = [c for c in text if c.isalpha()]
    if len(letters) > 12 and sum(c.isupper() for c in letters) > 0.8 * len(letters):
        text = text[:1] + text[1:].lower()  # no shouting
    return text, ""


def sanitize_chat(text: str) -> str | None:
    """Normalise free text. Returns None when it is empty or not allowed (mild swearing is masked)."""
    return moderate_chat(text)[0]


def name_allowed(name: str) -> bool:
    """Display names: no slurs, swearing, links or contact details."""
    clean, _ = moderate_chat(name)
    return clean is not None and "*" not in clean and _norm_word(name.replace(" ", "")) not in _SEVERE_WORDS


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


# ---------------------------------------------------------------- structured messages
MESSAGE_TYPES = frozenset(
    {
        "PLAN_PROPOSAL",
        "ALLIANCE_PROPOSAL",
        "ACCEPT",
        "COUNTER_OFFER",
        "REJECT",
        "INFORMATION_SHARE",
        "ACTION_PROPOSAL",
        "VOTE_INTENT",
        "SYSTEM_EVENT",
    }
)
# Types that may be sent privately to anyone (negotiation). Everything else is public or ally-only.
NEGOTIATION_TYPES = frozenset({"PLAN_PROPOSAL", "ALLIANCE_PROPOSAL", "ACCEPT", "COUNTER_OFFER", "REJECT"})
REPLY_TYPES = frozenset({"ACCEPT", "COUNTER_OFFER", "REJECT"})
MAX_MESSAGES_PER_PHASE = 6
MAX_NEGOTIATION_ROUNDS = 4
MAX_PAYLOAD_CHARS = 400
MESSAGE_TTL_TICKS = 20 * 20


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
