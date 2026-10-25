import json

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from arenix.server.app import create_app


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def test_health_and_maps(client: TestClient) -> None:
    assert client.get("/api/health").json() == {"status": "ok"}
    assert "emerald_isle" in client.get("/api/maps").json()["maps"]
    m = client.get("/api/maps/emerald_isle").json()
    assert m["width"] == 64 and len(m["tiles"]) == 64 * 48
    assert client.get("/api/maps/atlantis").status_code == 404


def recv_until(ws, msg_type: str, limit: int = 200) -> dict:  # type: ignore[no-untyped-def]
    for _ in range(limit):
        msg = json.loads(ws.receive_text())
        if msg["type"] == msg_type:
            return msg
    raise AssertionError(f"no {msg_type} message")


def test_practice_session_welcome_and_movement(client: TestClient) -> None:
    with client.websocket_connect("/ws/practice?name=Tester&archetype=wizard&bots=1") as ws:
        welcome = recv_until(ws, "welcome")
        assert welcome["you"] == "p1"
        assert welcome["map"]["id"] == "emerald_isle"
        assert {c["id"] for c in welcome["snapshot"]["contestants"]} == {"p1", "bot1"}
        # No private/hidden data in public payloads.
        assert all("inputs" not in c for c in welcome["snapshot"]["contestants"])

        start = next(c for c in welcome["snapshot"]["contestants"] if c["id"] == "p1")
        for seq in range(1, 6):
            ws.send_text(json.dumps({"type": "input", "seq": seq, "dx": 1, "dy": 0}))
        snap = None
        for _ in range(100):
            snap = recv_until(ws, "snapshot")
            if snap["ack_seq"] == 5:
                break
        assert snap is not None and snap["ack_seq"] == 5
        me = next(c for c in snap["contestants"] if c["id"] == "p1")
        assert me["x"] > start["x"]


def test_interact_out_of_range_is_rejected(client: TestClient) -> None:
    with client.websocket_connect("/ws/practice?name=Tester&archetype=knight&bots=0") as ws:
        ws.receive_text()
        ws.send_text(json.dumps({"type": "interact", "target_id": "stone_0"}))
        res = recv_until(ws, "interact_result")
        assert res == {"type": "interact_result", "target_id": "stone_0", "ok": False, "reason": "out_of_range"}


def test_ping(client: TestClient) -> None:
    with client.websocket_connect("/ws/practice?name=T&archetype=knight&bots=0") as ws:
        ws.receive_text()
        ws.send_text(json.dumps({"type": "ping", "t": 12.5}))
        assert recv_until(ws, "pong")["t"] == 12.5


def test_invalid_messages_eventually_disconnect(client: TestClient) -> None:
    with client.websocket_connect("/ws/practice?name=T&archetype=knight&bots=0") as ws:
        ws.receive_text()
        bad = [
            "not json",
            json.dumps({"type": "teleport", "x": 1}),
            json.dumps({"type": "input", "seq": 1, "dx": 50, "dy": 0}),
            json.dumps({"type": "interact", "target_id": "../../etc"}),
            "x" * 5000,
        ]
        with pytest.raises(WebSocketDisconnect) as exc:
            for i in range(30):
                ws.send_text(bad[i % len(bad)])
            for _ in range(500):
                ws.receive_text()
        assert exc.value.code == 4408


@pytest.mark.parametrize(
    "query",
    [
        "name=&archetype=knight",
        "name=A&archetype=dragon",
        "name=<b>&archetype=knight",
        "name=A&archetype=knight&bots=99",
    ],
)
def test_bad_join_params(client: TestClient, query: str) -> None:
    with pytest.raises(WebSocketDisconnect) as exc, client.websocket_connect(f"/ws/practice?{query}") as ws:
        ws.receive_text()
    assert exc.value.code == 4400


def test_chat_over_socket_and_action_errors(client: TestClient) -> None:
    with client.websocket_connect("/ws/practice?name=Talker&archetype=knight&bots=1") as ws:
        recv_until(ws, "welcome")
        ws.send_text(json.dumps({"type": "chat", "quick": "gg"}))
        found = None
        for _ in range(100):
            m = json.loads(ws.receive_text())
            if m["type"] == "snapshot" and any(e["type"] == "chat" for e in m["events"]):
                found = next(e for e in m["events"] if e["type"] == "chat")
                break
        assert found is not None and found["data"]["text"] == "GG, everyone!" and found["data"]["sender"] == "p1"
        # Whisper without an alliance is refused with a reason.
        ws.send_text(json.dumps({"type": "chat", "text": "hi", "to": "bot1"}))
        err = recv_until(ws, "error")
        assert err["code"] in ("not_allied", "chat_cooldown")
        # Voting outside a meeting is refused.
        ws.send_text(json.dumps({"type": "vote", "target": "bot1"}))
        assert recv_until(ws, "error")["code"] == "wrong_phase"


def test_chat_message_shape_is_validated() -> None:
    from pydantic import ValidationError

    from arenix.server.protocol import client_message_adapter

    for bad in (
        {"type": "chat"},
        {"type": "chat", "text": "a", "quick": "gg"},
        {"type": "chat", "quick": "GG!"},
        {"type": "vote"},
        {"type": "propose", "target": "../x"},
    ):
        with pytest.raises(ValidationError):
            client_message_adapter.validate_python(bad)
    assert client_message_adapter.validate_python({"type": "vote", "target": None}).target is None  # type: ignore[union-attr]


def test_experiment_api_runs_in_background() -> None:
    import time as _time

    with TestClient(create_app(db=None)) as c:
        bad = c.post("/api/experiments", json={"conditions": ["llm"], "seeds": "1-2"})
        assert bad.status_code == 422  # costly condition disabled by default
        assert c.post("/api/experiments", json={"conditions": ["teleport"]}).status_code == 422
        r = c.post(
            "/api/experiments",
            json={
                "name": "t",
                "conditions": ["independent", "negotiate"],
                "seeds": "1-2",
                "contestants": 4,
                "time_limit_seconds": 60,
            },
        )
        assert r.status_code == 202, r.text
        exp_id = r.json()["id"]
        assert c.post("/api/experiments", json={"conditions": ["independent"], "seeds": "1"}).status_code == 409
        assert c.get("/api/health").status_code == 200  # server stays responsive
        for _ in range(200):
            res = c.get(f"/api/experiments/{exp_id}/results").json()
            if res["status"] != "running":
                break
            _time.sleep(0.1)
        assert res["status"] == "finished", res
        assert set(res["results"]["conditions"]) == {"independent", "negotiate"} and res["progress"] == 4


def test_foreign_websocket_origins_are_rejected(client: TestClient) -> None:
    with (
        pytest.raises(WebSocketDisconnect) as exc,
        client.websocket_connect(
            "/ws/practice?name=T&archetype=knight&bots=0", headers={"origin": "https://evil.example"}
        ) as ws,
    ):
        ws.receive_text()
    assert exc.value.code == 4403
    with client.websocket_connect(
        "/ws/practice?name=T&archetype=knight&bots=0", headers={"origin": "http://localhost:3000"}
    ) as ws:
        assert json.loads(ws.receive_text())["type"] == "lobby"


def test_experiments_require_admin_token_when_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ARENIX_ADMIN_TOKEN", "s3cret-admin")
    with TestClient(create_app(db=None)) as c:
        body = {"conditions": ["independent"], "seeds": "1", "contestants": 3, "time_limit_seconds": 60}
        assert c.post("/api/experiments", json=body).status_code == 403
        assert c.post("/api/experiments", json=body, headers={"Authorization": "Bearer nope"}).status_code == 403
        assert (
            c.post("/api/experiments", json=body, headers={"Authorization": "Bearer s3cret-admin"}).status_code == 202
        )
