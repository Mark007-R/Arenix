"""Chat moderation, name checks, duplicate spam and Lab privacy."""

from __future__ import annotations

import pytest

from arenix.engine.map import GameMap
from arenix.engine.match import Match
from arenix.engine.social import moderate_chat, name_allowed
from arenix.lab import redact_private_human_chat


@pytest.mark.parametrize(
    "text",
    ["Scunthorpe is lovely", "I fly the cockpit", "reading Dickens", "assassin vibes", "class act", "Brakka is sus"],
)
def test_innocent_words_pass_untouched(text: str) -> None:
    assert moderate_chat(text) == (text, "")


@pytest.mark.parametrize(
    ("text", "reason"),
    [
        ("you are a n i g g e r", "message_rejected"),
        ("kys", "message_rejected"),
        ("just kill yourself", "message_rejected"),
        ("F4GG0T", "message_rejected"),
        ("join discord.gg/abc", "links_not_allowed"),
        ("go to https://x.io", "links_not_allowed"),
        ("mail me at kid@example.com", "contact_not_allowed"),
        ("call +1 (555) 123-4567", "contact_not_allowed"),
    ],
)
def test_harmful_messages_are_rejected_with_a_reason(text: str, reason: str) -> None:
    assert moderate_chat(text) == (None, reason)


@pytest.mark.parametrize("text", ["fuuuuck this", "what the sh1t", "you ass", "b!tch please"])
def test_mild_swearing_is_masked(text: str) -> None:
    clean, why = moderate_chat(text)
    assert why == "" and clean is not None and "*" in clean


def test_shouting_and_stretching_are_toned_down() -> None:
    assert moderate_chat("NOOOOOOOOOOO WAY THATS CRAZY")[0] == "Nooo way thats crazy"


@pytest.mark.parametrize(("name", "ok"), [("Mark", True), ("Sir Aldric", True), ("Fuckface", False), ("N1gger", False)])
def test_display_names(name: str, ok: bool) -> None:
    assert name_allowed(name) is ok


def test_duplicate_messages_are_refused(emerald: GameMap) -> None:
    m = Match("dup", emerald, 1, meetings=False)
    m.add_contestant("p1", "A", "knight", is_bot=False)
    m.add_contestant("p2", "B", "knight", is_bot=False)
    m.start()
    assert m.chat("p1", text="hello").ok
    m.tick += 40  # past the 1.5 s cooldown
    assert m.chat("p1", text="HELLO").reason == "duplicate_message"
    m.tick += 400  # 20 s later it's fine again
    assert m.chat("p1", text="hello").ok


def test_lab_hides_private_messages_involving_humans() -> None:
    payload = {
        "contestants": [{"id": "p1", "is_bot": False}, {"id": "bot1", "is_bot": True}, {"id": "bot2", "is_bot": True}],
        "events": [
            {"type": "chat", "data": {"sender": "p1", "text": "secret plan"}, "visible_to": ["p1", "bot1"]},
            {"type": "chat", "data": {"sender": "bot1", "text": "bot plan"}, "visible_to": ["bot1", "bot2"]},
            {"type": "chat", "data": {"sender": "p1", "text": "hello all"}},
        ],
    }
    out = redact_private_human_chat(payload)
    texts = [e["data"]["text"] for e in out["events"]]
    assert texts == ["[private message hidden]", "bot plan", "hello all"]


def test_bad_names_are_refused_at_join() -> None:
    from fastapi.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect

    from arenix.server.app import create_app

    with TestClient(create_app(db=None)) as c:
        with (
            pytest.raises(WebSocketDisconnect) as exc,
            c.websocket_connect("/ws/practice?name=Fuckface&archetype=knight&bots=4") as ws,
        ):
            ws.receive_text()
        assert exc.value.code == 4400
        r = c.post("/api/rooms", json={"name": "Fuckface", "archetype": "knight"})
        assert r.status_code == 422
