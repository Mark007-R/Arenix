"""Multiplayer integration tests: several real WebSocket clients against a live uvicorn server.

A real server (one event loop, like production) is used instead of Starlette's Live,
which gives every WebSocket its own event loop and so cannot host a shared room tick task.
"""

import asyncio
import json
import socket
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager

import httpx
import pytest
import uvicorn
from websockets.exceptions import ConnectionClosed
from websockets.sync.client import ClientConnection, connect

from arenix.server.app import create_app
from arenix.server.rooms import CODE_ALPHABET, LOBBY_SEAT_GRACE_S, MAX_CONTESTANTS, ROOM_IDLE_TTL_S


class Live:
    def __init__(self, port: int) -> None:
        self.http = httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=5)
        self.ws_base = f"ws://127.0.0.1:{port}"

    def post(self, path: str, json: dict) -> httpx.Response:  # type: ignore[type-arg]
        return self.http.post(path, json=json)

    def get(self, path: str) -> httpx.Response:
        return self.http.get(path)

    @contextmanager
    def websocket_connect(self, path: str) -> Iterator[ClientConnection]:
        with connect(self.ws_base + path, open_timeout=5, close_timeout=1) as ws:
            yield ws


@pytest.fixture
def client() -> Iterator[Live]:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(create_app(), host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started:
        assert time.monotonic() < deadline, "server did not start"
        time.sleep(0.02)
    try:
        yield Live(port)
    finally:
        server.should_exit = True
        thread.join(timeout=5)


def create(client: Live, name: str = "Host", fill_to: int = 4) -> dict:  # type: ignore[type-arg]
    r = client.post("/api/rooms", json={"name": name, "archetype": "knight", "fill_to": fill_to})
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def join(client: Live, code: str, name: str = "Guest") -> dict:  # type: ignore[type-arg]
    r = client.post(f"/api/rooms/{code}/join", json={"name": name, "archetype": "wizard"})
    assert r.status_code == 200, r.text
    return r.json()  # type: ignore[no-any-return]


def recv_until(ws, pred, limit: int = 400) -> dict:  # type: ignore[no-untyped-def,type-arg]
    for _ in range(limit):
        msg = json.loads(ws.recv(timeout=5))
        if pred(msg):
            return msg  # type: ignore[no-any-return]
    raise AssertionError("expected message never arrived")


def is_type(t: str):  # type: ignore[no-untyped-def]
    return lambda m: m["type"] == t


def test_create_and_join_codes(client: Live) -> None:
    host = create(client)
    assert len(host["code"]) == 6 and set(host["code"]) <= set(CODE_ALPHABET)
    guest = join(client, host["code"].lower())  # codes are case-insensitive
    assert guest["player_id"] != host["player_id"]
    assert guest["token"] != host["token"]
    lobby = client.get(f"/api/rooms/{host['code']}").json()
    assert [s["name"] for s in lobby["seats"]] == ["Host", "Guest"]
    assert "token" not in json.dumps(lobby)  # never leak credentials
    assert lobby["seats"][0]["is_host"] and not lobby["seats"][1]["is_host"]


def test_unknown_room_and_bad_requests(client: Live) -> None:
    assert client.post("/api/rooms/ZZZZZZ/join", json={"name": "A", "archetype": "knight"}).status_code == 404
    assert client.get("/api/rooms/ZZZZZZ").status_code == 404
    assert client.post("/api/rooms", json={"name": "<script>", "archetype": "knight"}).status_code == 422
    assert client.post("/api/rooms", json={"name": "A", "archetype": "dragon"}).status_code == 422
    assert client.post("/api/rooms", json={"name": "A", "archetype": "knight", "fill_to": 99}).status_code == 422


def test_room_capacity(client: Live) -> None:
    host = create(client)
    for i in range(MAX_CONTESTANTS - 1):
        join(client, host["code"], f"G{i}")
    r = client.post(f"/api/rooms/{host['code']}/join", json={"name": "Late", "archetype": "rogue"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "room_full"


def test_socket_requires_valid_token(client: Live) -> None:
    host = create(client)
    for url in (
        f"/ws/rooms/{host['code']}?token=nope",
        f"/ws/rooms/{host['code']}",
        f"/ws/rooms/QQQQQQ?token={host['token']}",
    ):
        with pytest.raises(ConnectionClosed) as exc, client.websocket_connect(url) as ws:
            ws.recv(timeout=5)
        assert exc.value.rcvd is not None and exc.value.rcvd.code in (4401, 4404)


def test_room_creation_is_rate_limited(client: Live) -> None:
    codes = [client.post("/api/rooms", json={"name": "A", "archetype": "knight"}).status_code for _ in range(12)]
    assert codes.count(201) == 10 and codes[-1] == 429


def test_two_humans_play_one_match(client: Live) -> None:
    host = create(client, fill_to=4)
    guest = join(client, host["code"])
    code = host["code"]
    with (
        client.websocket_connect(f"/ws/rooms/{code}?token={host['token']}") as h,
        client.websocket_connect(f"/ws/rooms/{code}?token={guest['token']}") as g,
    ):
        recv_until(
            h, lambda m: m["type"] == "lobby" and all(s["connected"] for s in m["seats"]) and len(m["seats"]) == 2
        )

        # Host cannot start until everyone is ready; guest cannot start at all.
        h.send(json.dumps({"type": "start"}))
        assert recv_until(h, is_type("error"))["code"] == "not_ready"
        g.send(json.dumps({"type": "start"}))
        assert recv_until(g, is_type("error"))["code"] == "not_host"
        g.send(json.dumps({"type": "set_fill", "fill_to": 8}))
        assert recv_until(g, is_type("error"))["code"] == "not_host"

        g.send(json.dumps({"type": "set_archetype", "archetype": "rogue"}))
        h.send(json.dumps({"type": "ready", "ready": True}))
        g.send(json.dumps({"type": "ready", "ready": True}))
        recv_until(h, lambda m: m["type"] == "lobby" and m["can_start"])
        h.send(json.dumps({"type": "start"}))

        wh = recv_until(h, is_type("welcome"))
        wg = recv_until(g, is_type("welcome"))
        assert wh["you"] == host["player_id"] and wg["you"] == guest["player_id"]
        assert wh["match_id"] == wg["match_id"]
        roster = {c["id"]: c for c in wh["snapshot"]["contestants"]}
        assert len(roster) == 4  # 2 humans + 2 AI fill
        assert sum(c["is_bot"] for c in roster.values()) == 2
        assert roster[guest["player_id"]]["archetype"] == "rogue"

        # The guest moves; the host sees it and the host's own position is unaffected.
        start_g = roster[guest["player_id"]]
        start_h = roster[host["player_id"]]
        for seq in range(1, 6):
            g.send(json.dumps({"type": "input", "seq": seq, "dx": 0, "dy": 1}))
        snap = recv_until(
            h,
            lambda m: (
                m["type"] == "snapshot"
                and next(c for c in m["contestants"] if c["id"] == guest["player_id"])["y"] > start_g["y"] + 1.0
            ),
        )
        me = next(c for c in snap["contestants"] if c["id"] == host["player_id"])
        assert (me["x"], me["y"]) == (start_h["x"], start_h["y"])
        assert snap["ack_seq"] == 0  # host sent no inputs
        gs = recv_until(g, lambda m: m["type"] == "snapshot" and m["ack_seq"] == 5)
        assert gs["ack_seq"] == 5

        # Lobby actions are refused mid-match.
        h.send(json.dumps({"type": "ready", "ready": False}))
        assert recv_until(h, is_type("error"))["code"] == "in_progress"


def test_late_join_refused_while_running(client: Live) -> None:
    host = create(client, fill_to=2)
    with client.websocket_connect(f"/ws/rooms/{host['code']}?token={host['token']}") as h:
        h.send(json.dumps({"type": "ready", "ready": True}))
        recv_until(h, lambda m: m["type"] == "lobby" and m["can_start"])
        h.send(json.dumps({"type": "start"}))
        recv_until(h, is_type("welcome"))
        r = client.post(f"/api/rooms/{host['code']}/join", json={"name": "Late", "archetype": "rogue"})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "in_progress"


def test_reconnect_resumes_same_contestant(client: Live) -> None:
    host = create(client, fill_to=2)
    url = f"/ws/rooms/{host['code']}?token={host['token']}"
    with client.websocket_connect(url) as h:
        h.send(json.dumps({"type": "ready", "ready": True}))
        recv_until(h, lambda m: m["type"] == "lobby" and m["can_start"])
        h.send(json.dumps({"type": "start"}))
        w = recv_until(h, is_type("welcome"))
        for seq in range(1, 4):
            h.send(json.dumps({"type": "input", "seq": seq, "dx": 1, "dy": 0}))
        moved = recv_until(h, lambda m: m["type"] == "snapshot" and m["ack_seq"] == 3)
        x_before = next(c for c in moved["contestants"] if c["id"] == w["you"])["x"]

    with client.websocket_connect(url) as h2:
        w2 = recv_until(h2, is_type("welcome"))
        assert w2["you"] == w["you"] and w2["match_id"] == w["match_id"]
        assert w["resume_seq"] == 0 and w2["resume_seq"] == 3
        me = next(c for c in w2["snapshot"]["contestants"] if c["id"] == w["you"])
        assert me["x"] >= x_before  # same contestant, state preserved
        events = recv_until(
            h2, lambda m: m["type"] == "snapshot" and any(e["type"] == "contestant_connection" for e in m["events"])
        )["events"]
        assert any(
            e["data"] == {"contestant": w["you"], "connected": True}
            for e in events
            if e["type"] == "contestant_connection"
        )
        # Sequence numbers continue: replayed old inputs are ignored, new ones move us.
        h2.send(json.dumps({"type": "input", "seq": 2, "dx": -1, "dy": 0}))
        h2.send(json.dumps({"type": "input", "seq": 4, "dx": 1, "dy": 0}))
        assert recv_until(h2, lambda m: m["type"] == "snapshot" and m["ack_seq"] == 4)["ack_seq"] == 4


def test_second_tab_replaces_first(client: Live) -> None:
    host = create(client)
    url = f"/ws/rooms/{host['code']}?token={host['token']}"
    with client.websocket_connect(url) as a:
        recv_until(a, is_type("lobby"))
        with client.websocket_connect(url) as b:
            recv_until(b, is_type("lobby"))
            err = recv_until(a, is_type("error"))
            assert err["code"] == "replaced"


def test_sweeper_drops_stale_seats_and_rooms() -> None:
    from arenix.server.rooms import RoomManager

    async def scenario() -> None:
        mgr = RoomManager()
        room = mgr.create()
        room.add_seat("A", "knight")
        room.add_seat("B", "rogue")
        now = time.monotonic()
        await mgr.sweep(now + LOBBY_SEAT_GRACE_S + 1)
        assert room.seats == {}
        await mgr.sweep(now + ROOM_IDLE_TTL_S + 1)
        assert room.code not in mgr.rooms

    asyncio.run(scenario())


def test_room_returns_to_lobby_after_match_and_can_replay() -> None:
    from arenix.server.app import encode
    from arenix.server.rooms import Connection, Room

    async def scenario() -> None:
        sent: list[dict] = []  # type: ignore[type-arg]

        async def send_text(text: str) -> None:
            sent.append(json.loads(text))

        room = Room("TEST22", fill_to=2)
        seat = room.add_seat("Solo", "knight")
        conn = Connection(send_text, encode)
        writer = asyncio.create_task(conn.writer())
        room.attach(seat, conn)
        room.set_ready(seat, True)
        room.start(seat)
        match = room.match
        assert match is not None and room.status == "running"
        # Finish the mission through the normal validated interaction path.
        match.mission.delivered = {r: n for r, n in match.mission.required.items()}
        match.mission.delivered["wood"] -= 1
        me = match.contestants[seat.player_id]
        me.carrying["wood"] = 1
        tower = match.map.objects_by_id["watchtower"]
        me.x, me.y = tower.x + 0.5, tower.y + tower.h + 0.5
        assert room.handle_interact(seat, "watchtower")["ok"]
        for _ in range(50):
            await asyncio.sleep(0.01)
            if room.status == "lobby":
                break
        assert room.status == "lobby"
        assert room.last_result is not None and room.last_result["winner"] == seat.player_id
        await asyncio.sleep(0.05)
        assert any(m["type"] == "snapshot" and any(e["type"] == "match_finished" for e in m["events"]) for m in sent)
        assert any(m["type"] == "lobby" and m["last_result"] for m in sent)
        # Ready flags reset; a second match can start.
        assert not seat.ready
        room.set_ready(seat, True)
        room.start(seat)
        assert room.match is not match and room.matches_played == 2
        await room.close()
        conn.closed = True
        conn.wake.set()
        await writer

    asyncio.run(scenario())
