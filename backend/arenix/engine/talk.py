"""Natural-language chat for rule-based contestants (impostor mode). No LLM is involved.

`Talker` turns an intent ("I found a body", "I suspect X", "here is my alibi") into a short,
varied sentence. What a bot says always comes from its own authorised knowledge (or, for an
impostor, a deliberate lie about it); the templates only decide the wording. A bot avoids reusing
a wording until it has cycled through the others, so conversations don't loop.

`parse_claim` does the reverse for human messages: a light keyword reading of free text that
bots treat as an untrusted claim, exactly like other contestants' chat.
"""

from __future__ import annotations

import random
import re
from collections import deque
from typing import Any

TEMPLATES: dict[str, list[str]] = {
    "found_body": [
        "I just found {victim}'s body in {region}!",
        "{victim} is dead. The body's in {region}.",
        "Body! {victim}, near {region}.",
        "I reported {victim} — found them lying in {region}.",
        "Bad news: {victim} is down in {region}.",
    ],
    "saw_kill": [
        "I SAW {target} kill {victim} in {region}!",
        "It's {target}. I watched them take out {victim}.",
        "{target} did it — I was right there in {region}.",
        "No doubt about it: {target} killed {victim}. I saw it.",
    ],
    "saw_kill_explore": [
        "{target} just killed {victim} in {region}!! Everyone run!",
        "HELP — {target} is the impostor, they got {victim}!",
        "I just saw {target} kill {victim}. Reporting now!",
    ],
    "alibi": [
        "I was in {region} the whole time.",
        "I've been around {region}, doing my tasks.",
        "Me? I was over at {region}.",
        "I was busy in {region}, didn't see anything.",
        "Spent the last while in {region}.",
    ],
    "alibi_with": [
        "I was in {region} with {other}.",
        "{other} and I were both in {region}.",
        "I was with {other} near {region} — we can vouch for each other.",
    ],
    "alibi_task": [
        "I was {task}.",
        "Been {task}. Check the progress if you don't believe me.",
        "I was {task} the whole round.",
    ],
    "suspect_near": [
        "{target} was hanging around {region} right before.",
        "I saw {target} near {region}. Kinda sus.",
        "Last time I saw {target}, they were heading to {region}.",
        "{target}, what were you doing near {region}?",
        "Not saying it's {target}, but they were close to {region}.",
    ],
    "suspect_vague": [
        "{target} has been really quiet. I don't trust it.",
        "Something about {target} feels off.",
        "Has anyone actually seen {target} do a task?",
        "I'm keeping my eye on {target}.",
    ],
    "detective": [
        "Detective clue: it was either {a} or {b}.",
        "My skill says one of {a} and {b} did it.",
        "Detective here — it's {a} or {b}. Choose carefully.",
    ],
    "lookout": [
        "I sensed a death near {region} before the meeting.",
        "My lookout sense went off around {region}.",
    ],
    "vision": [
        "The shrine showed me that {target} is innocent.",
        "Shrine vision: {target} is clean.",
    ],
    "shielded": [
        "{target} attacked me! A shield saved me. It's {target}!",
        "I was attacked by {target} — the medic shield blocked it!",
    ],
    "defend": [
        "It wasn't me! I was in {region}.",
        "Why me? I was nowhere near there.",
        "I'm innocent, I swear. I was in {region}.",
        "Wrong person. Look at someone else.",
        "Come on, I've been doing tasks all game.",
    ],
    "counter": [
        "{target} is lying. That's exactly what an impostor would say.",
        "Funny how {target} is so quick to blame me. Sus.",
        "Don't listen to {target}, they're trying to get an innocent voted out.",
    ],
    "agree": [
        "Agreed, {target} is sus.",
        "Yeah, {target} has been acting weird.",
        "I was thinking the same about {target}.",
        "+1 on {target}.",
    ],
    "doubt": [
        "I don't think it's {target}.",
        "{target} was with me earlier, I doubt it's them.",
        "Careful — I'm not convinced about {target}.",
    ],
    "vote_intent": [
        "I'm voting {target}.",
        "My vote's on {target}.",
        "Voting {target} unless someone has better info.",
        "{target} gets my vote.",
    ],
    "skip_intent": [
        "Not enough evidence, I'm skipping.",
        "Let's skip this one, we don't know enough.",
        "No idea yet — skip.",
        "I'd rather skip than vote out an innocent.",
    ],
    "no_info": [
        "I didn't see anything this round.",
        "Nothing to report from me.",
        "All quiet where I was.",
    ],
    "bell": [
        "I called this meeting. We need to talk.",
        "Emergency meeting! Let's compare notes.",
    ],
    "answer_where": [
        "I was in {region}.",
        "Over in {region}, why?",
        "{region}. Doing my job.",
    ],
    "greet": [
        "Hey {target}! Stay safe out there.",
        "Hi {target} 👋",
        "Yo {target}.",
    ],
    "explore_gather": [
        "Heading to {region} for {resource}.",
        "Getting more {resource} for the tower.",
        "I'll grab {resource} from {region}.",
    ],
    "explore_beacon": [
        "Going to light {region} beacon.",
        "I'll take the beacon at {region}.",
    ],
    "explore_misc": [
        "Stick together, people.",
        "Anyone else feel like they're being watched?",
        "Tower's looking better already.",
        "Don't wander off alone!",
        "Whoever it is, we'll find you.",
    ],
    "jester_tease": [
        "Maybe it was me. Maybe it wasn't.",
        "I'm not telling you where I was.",
        "Go on, vote me. I dare you.",
        "I was... around. Somewhere.",
        "Funny, nobody asked what *I* was doing.",
    ],
    "sheriff_reveal": [
        "I'm the sheriff — I shot {target} and they WERE an impostor!",
        "Sheriff here. My bullet found {target}. Impostor down.",
    ],
    "ejected_good": [
        "Got one! Nice work, everyone.",
        "Told you. Good vote.",
    ],
    "ejected_bad": [
        "Oh no... they were innocent.",
        "That was a mistake. The impostor's still out there.",
        "Ugh. Wrong one.",
    ],
}

MAX_LEN = 140


def place(region: str) -> str:
    """'Old Mine' -> 'the Old Mine'; 'the wilds' stays as it is."""
    return region if region.startswith("the ") else f"the {region}"


class Talker:
    def __init__(self, rng: random.Random) -> None:
        self.rng = rng
        self.recent: dict[str, deque[int]] = {}

    def say(self, intent: str, **kw: Any) -> str:
        options = TEMPLATES[intent]
        used = self.recent.setdefault(intent, deque(maxlen=max(1, len(options) - 1)))
        fresh = [i for i in range(len(options)) if i not in used] or list(range(len(options)))
        i = self.rng.choice(fresh)
        used.append(i)
        if "region" in kw:
            kw = {**kw, "region": place(str(kw["region"]))}
        text = options[i].format(**kw)
        text = text[:1].upper() + text[1:]
        return text if len(text) <= MAX_LEN else text[: MAX_LEN - 1] + "..."


ACCUSE_WORDS = re.compile(r"\b(sus|suspicious|impostor|imposter|killer|kill|killed|murder|did it|vote|lying|liar)\b")
CLEAR_WORDS = re.compile(r"\b(safe|clear|clean|innocent|trust|with me|vouch|not (the )?(impostor|imposter))\b")
WHERE_WORDS = re.compile(r"\b(where|what were you|wyd|doing)\b")
SKIP_WORDS = re.compile(r"\bskip\b")


def parse_claim(text: str, names: dict[str, str], sender: str) -> dict[str, Any] | None:
    """Best-effort reading of a human message: who it is about and whether it accuses or clears."""
    low = text.lower()
    mentioned = [
        cid for cid, name in names.items() if cid != sender and re.search(rf"\b{re.escape(name.lower())}\b", low)
    ]
    if not mentioned:
        return {"type": "skip"} if SKIP_WORDS.search(low) else None
    target = mentioned[0]
    if CLEAR_WORDS.search(low):
        return {"type": "clear", "target": target}
    if ACCUSE_WORDS.search(low):
        return {"type": "accuse", "target": target}
    if WHERE_WORDS.search(low) or low.rstrip().endswith("?"):
        return {"type": "ask", "target": target}
    return {"type": "mention", "target": target}
