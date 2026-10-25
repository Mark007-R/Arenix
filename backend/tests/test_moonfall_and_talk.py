"""The large impostor-mode map and the rule-based chat generator."""

from __future__ import annotations

import math
import random

from arenix.engine import physics
from arenix.engine.maps import get_map
from arenix.engine.match import INTERACT_RANGE
from arenix.engine.pathfinding import path_into_range
from arenix.engine.social import sanitize_chat
from arenix.engine.talk import TEMPLATES, Talker, parse_claim


def test_moonfall_is_much_bigger_and_fully_reachable() -> None:
    big, small = get_map("moonfall_isle"), get_map("emerald_isle")
    assert big.width * big.height >= 2 * small.width * small.height
    assert len(big.spawns) >= 10
    for sx, sy in big.spawns:
        assert not physics.box_blocked(big.is_solid, sx, sy)
    for o in big.objects:
        if o.interactable:
            assert path_into_range(
                big, (math.floor(big.spawns[0][0]), math.floor(big.spawns[0][1])), o.id, INTERACT_RANGE
            )
    assert sum(1 for o in big.objects if o.kind == "beacon") == 5


def test_every_walkable_tile_has_a_region_name() -> None:
    m = get_map("moonfall_isle")
    for y in range(m.height):
        for x in range(m.width):
            if not m.is_solid(x, y):
                assert m.region_at(x + 0.5, y + 0.5) is not None, (x, y)


def test_talker_varies_wording_and_stays_valid() -> None:
    t = Talker(random.Random(1))
    lines = [t.say("alibi", region="Old Mine") for _ in range(len(TEMPLATES["alibi"]))]
    assert len(set(lines)) == len(lines)  # no repeats until every variant was used
    assert all("the the" not in line.lower() for line in lines)
    for intent, options in TEMPLATES.items():
        for _ in options:
            line = t.say(
                intent,
                region="the wilds",
                victim="Lyra",
                target="Brakka",
                other="Quill",
                a="Lyra",
                b="Grub",
                task="gathering wood",
                resource="wood",
            )
            assert sanitize_chat(line) == line, (intent, line)


def test_parse_claim_reads_human_messages() -> None:
    names = {"p1": "Mark", "bot1": "Brakka", "bot2": "Lyra"}
    assert parse_claim("Brakka is sus", names, "p1") == {"type": "accuse", "target": "bot1"}
    assert parse_claim("I think lyra is the impostor!", names, "p1") == {"type": "accuse", "target": "bot2"}
    assert parse_claim("Brakka was with me, he's safe", names, "p1") == {"type": "clear", "target": "bot1"}
    assert parse_claim("Lyra where were you?", names, "p1") == {"type": "ask", "target": "bot2"}
    assert parse_claim("let's skip", names, "p1") == {"type": "skip"}
    assert parse_claim("hello everyone", names, "p1") is None
    assert parse_claim("Mark is sus", names, "p1") is None  # you can't be the subject of your own claim
