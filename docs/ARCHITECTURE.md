# ARENIX Architecture

ARENIX is a real-time, server-authoritative 2D multiplayer game. Human players and AI
contestants share one simulation. Everything below says which parts **exist today** and which are
**planned**. See [MILESTONES.md](MILESTONES.md) for status.

## Guiding rules

1. **The server is the only source of truth.** Clients and agents send *intents* (a movement
   direction, "interact with X"). The engine checks them (range, cooldown, capacity, phase) and
   only then changes state. Mission outcomes, rewards and purchases are never decided by a client.
2. **The engine is pure.** `backend/arenix/engine` imports no web framework, database or LLM
   SDK. It is deterministic given a map, a seed and an input sequence, which makes it testable
   and replayable.
3. **LLMs choose strategy. They never touch state or move characters frame by frame.**
   Navigation, collision and moment-to-moment actions are ordinary game code. Model output is
   a *proposed action*. The engine validates it, and a deterministic fallback policy runs whenever
   the model is slow, unavailable or invalid.
4. **Agents see only what they are allowed to see.** Each contestant gets a filtered
   `Observation` built on the server. Hidden state is never sent to a prompt with a request to
   ignore it.
5. **Every confirmed change is an event.** The match keeps an append-only `EventLog` with sequential
   per-match numbers. Replays, the Agent Lab and progression rewards all read from it.

## Repository layout

```
backend/                Python 3.12+, FastAPI, Pydantic (managed with uv)
  arenix/engine/        pure game engine (no I/O)
    tiles.py            tile vocabulary + solidity
    map.py              GameMap, MapObject, Region; collision grid; JSON payload
    maps/emerald_isle.py   first map, painted procedurally but deterministically
    physics.py          fixed-tick movement + axis-separated AABB vs tile collision
    pathfinding.py      A* on the collision grid; "path into interaction range"
    missions.py         RepairTowerMission
    events.py           append-only EventLog
    match.py            Match: contestants, input queues, interaction rules, timer, results
    bots.py             rule-based contestant policy (navigation + goal selection)
  arenix/server/
    protocol.py         Pydantic models for every inbound client message and REST body
    rooms.py            Room/RoomManager: codes, seats, lobby, match loop, fan-out, reconnect
    app.py              FastAPI app: REST endpoints, /ws/rooms/{code}, /ws/practice
  scripts/gen_movement_vectors.py   golden physics vectors for the client
  tests/                pytest (engine, bots, server, parity, property-based physics)
frontend/               Next.js 16 + React 19 + TypeScript + Tailwind 4 + Phaser 3
  src/shared/           physics.ts (exact port), prediction.ts, interpolation.ts, protocol.ts
  src/game/art/         procedural pixel art (characters, tiles, objects): original assets
  src/game/net/client.ts   socket + prediction + interpolation + HUD store updates
  src/game/scenes/WorldScene.ts   Phaser rendering, input, prompts, markers
  src/components/       React HUD, minimap, lobby, results, touch controls
  src/app/              routes: / (menu), /play (practice), /room/[code] (join form, lobby, match)
  e2e/                  browser scripts: smoke.cjs (practice), multiplayer.cjs (two players)
shared/test-vectors/    movement.json: Python-generated trajectories the TS port must match exactly
docs/                   this document, milestones
```

## Simulation

* **Units:** positions are in tiles (float). A contestant is a 0.6 × 0.4 "feet box" centred on
  `(x, y)`.
* **Tick:** fixed 20 Hz (`DT = 0.05`). Speed is 4.5 tiles/s. Diagonal input is normalised.
* **Collision:** each axis is resolved separately against the solid tile grid. Solid object
  footprints (houses, nodes, the tower) are baked into the grid. On contact, the box snaps flush
  with `EPS` clearance, so contestants slide along walls. A Hypothesis property test checks that no
  input sequence ever leaves a contestant inside a solid tile.
* **Determinism and parity:** physics uses only `+ - * /`, `sqrt` and `floor`, so Python and
  TypeScript produce bit-identical results. `shared/test-vectors/movement.json` holds 14
  trajectories (120 ticks each) on the real map. Vitest replays them and asserts exact equality.
  A pytest test fails if the file is stale.

### Input handling and anti-cheat

* Clients send `{seq, dx, dy}` with `dx, dy ∈ [-1, 1]` (validated by Pydantic). Positions are never
  accepted from the client.
* Each human has a token bucket (+1 per tick, max 3). One queued input costs one token, so a client
  that floods inputs still moves at most one step per tick on average. A test checks this.
* Sequence numbers must increase strictly. Replays and duplicates are dropped.
* Interactions are checked server-side: the object must exist and be interactable, range ≤ 1.3
  tiles from the footprint, an 8-tick cooldown, carry capacity 3, node charges, and mission state.
* The WebSocket layer also enforces a 1 KB message cap, at most 60 messages per second, and
  disconnects after 20 invalid messages. Join parameters (name, archetype, bot count) are validated.

### Client prediction and reconciliation

The client runs the same `step()` for its own inputs straight away (`Predictor`). Each snapshot
carries `ack_seq`, the last input the server processed. The client rewinds to the server's
position, drops acknowledged inputs and replays the rest. Because physics is identical,
corrections only happen when the server actually disagreed. Visible corrections are smoothed over
about 250 ms. Other contestants are interpolated 100 ms in the past (`InterpolationBuffer`). The
fixed-step accumulator runs on wall-clock time, so movement speed doesn't depend on frame rate.

## Council mode (Milestone 3)

`Match` runs explore → discuss → vote → reveal cycles. The relevant modules:

* `social.py`: quick-chat phrases, chat sanitising (NFKC, control and bidi stripping, length,
  blocklist), pair `Alliances` with expiring proposals, secret `Objective`s.
* `events.py`: every `GameEvent` has `visible_to` (None means public). Consumers read through
  `visible_since(cursor, viewer)`. Whispers, alliance offers and answers, ally dividends and
  objectives are private. Alliance breaks and betrayals are public.
* `match.snapshot(viewer)` filters contestant positions with `can_see`: self, allies and anyone
  within 13 tiles, while everyone is visible during meetings and to eliminated spectators.
  `roster` (names, scores, alive) is public, and `me` holds the viewer's private state.
* Bots receive `Observation.new_events`, already filtered for them, and return social
  `actions` that the match validates exactly like a human's messages.

## Impostor mode (Milestone 8)

The default mode for rooms and practice (`Match(mode="impostor")`, map `moonfall_isle`). Classic
mode is unchanged and selected with `mode="classic"`.

* `roles.py`: roles, the six skills and every tuning constant (ranges, cooldowns, phase lengths,
  points). `kill_cooldown_ticks(n)` reads a per-field-size table tuned by all-bot simulation
  (`docs/benchmarks/README.md`); two impostors from 7 players.
* `match.py`:
  * `kill()` validates role, phase, range, cooldown and target, then marks the victim dead,
    drops a `Body`, and emits `contestant_killed` (visible to the impostors and the victim),
    `kill_witnessed` (islanders within 6 tiles) and `lookout_alert`.
  * `known_alive(viewer, c)` decides what each viewer believes. It feeds the roster, the bots'
    `Observation.alive_ids` and vote targets.
  * `_start_meeting()` reveals every death (`deaths_revealed`) and clears the bodies.
  * `_check_team_win()` runs after kills, tasks and each reveal phase. `_finish_teams()` reveals
    roles and skills in the standings.
* Information hygiene: positions and bodies are view-filtered; task events go only to observers
  (`_observers`); other players' scores and tower contributions are blanked while the match
  runs; the living never see ghosts; ghost chat is `visible_to` the dead only.
* Physics: `physics.step(..., speed)` takes a multiplier for Swift; 1.0 is bit-identical to the
  old step, and `swift_*` golden vectors pin the faster speed in both languages.
* Bots: `island_bots.IslandBrain` extends the classic `BotBrain` navigation. It keeps sightings
  (who was seen where, last ~45 s), suspicion, proofs and claims, and produces chat through
  `talk.Talker`. Bots attach a machine-readable `claim` to what they say; for human text,
  `talk.parse_claim` extracts one. Both are treated as claims, never facts.
* Rooms: impostor mode fills the field to at least 5 and does not start the strategist
  coordinator (it drives classic mode).

## Mission and match flow (Milestone 1, extended in 3)

`RepairTowerMission`: deliver `8n+2` wood and `6n+2` stone (n = contestants) to the ruined
watchtower within 4 minutes. The workload scales so that solo practice and full matches both last a
few minutes. All-bot simulations finish in about 75–135 s.
Resource nodes hold 3 charges and regenerate 1 charge every 12 s. Each delivered unit is worth
+10 points, and every contributor gets +50 when the tower is repaired. The match ends when the
mission is completed (the top scorer is MVP) or when time runs out (no winner). Delivering
materials the tower no longer needs empties your pack and earns no points.

## AI contestants

**Today (`bots.py`):** a deterministic, seeded rule-based policy. Each tick it gets an
`Observation` (its own position and pack, public mission progress, public node charges). It then:

1. picks a goal: deliver if the pack is full or holds everything still needed, otherwise gather
   the most-needed resource from a nearby node with charges (each bot has a seeded personality
   bias and reaction delay);
2. plans a route with A* to any walkable tile within interaction range;
3. steers along tile centres using the same physics as humans, and re-plans when stuck or when
   the target is depleted;
4. requests the interaction through `Match.interact`. The bot goes through exactly the same
   validation as a human.

Bots record structured decision summaries (`tick`, `summary`, `goal`), not free-form reasoning.

**Strategist layer (Milestone 4, `backend/arenix/agents`).**

```
match.observe(agent) + match.snapshot(agent)      (server-filtered, authorised only)
        │                        AgentMemory: facts ≠ claims, threads, agreements, refusals
        ▼                        Beliefs: trust per contestant (from BotBrain)
context.build_context ──► SYSTEM_PROMPT + JSON situation (claims in an "untrusted" section)
        │
        ▼
LLMGateway.decide  ── timeout · semaphore · 1 repair retry · call/token/cost budget · breaker
   ├─ AnthropicProvider  (official SDK, output_config json_schema, fallbacks="default")
   ├─ HeuristicProvider  (deterministic planner, same protocol, not an LLM)
   └─ ScriptedProvider   (tests)
        │ StrategicDecision (Pydantic-validated)
        ▼
AgentCoordinator._prevalidate  (phase, targets, offers, thread state)   → DecisionRecord
        │ legal actions only
        ▼
BotBrain.external_actions / goal_hint / shrine_hold_until
        │
        ▼
Match validates again → confirmed GameEvents       (engine verdicts linked back to the record)
```

* The coordinator runs in the room's event loop. `tick()` is synchronous and only launches or
  collects asyncio tasks, so a slow model can never stall the 20 Hz simulation.
* Triggers: alliance offers to the agent, messages addressed to it or plans it can join, shrine
  rituals, discussion and vote openings, and a staggered 15 s beat. There is at most one call in
  flight per agent and at least 4 s between calls.
* Decisions older than 12 s, or vote decisions arriving after voting closed, are recorded as
  `stale` and not applied.
* If no strategist vote arrives with 3 s left, or an offer sits unanswered for 10 s, the bot's
  deterministic policy acts (and records a fallback). Budget exhaustion or a tripped breaker
  switches the whole match to the rule policy.
* The engine-level protocol (`Match.agent_message`) enforces message types, sanitised text,
  payloads ≤ 400 chars, ≤ 6 messages per phase per sender, ≤ 4 rounds per negotiation thread,
  live threads for replies, and private messages only for negotiation types or to allies.

## Rooms and realtime protocol

**REST**

| method | path | body / result |
|---|---|---|
| GET | `/api/health`, `/api/maps`, `/api/maps/{id}`, `/api/archetypes` | static data |
| POST | `/api/rooms` | `{name, archetype, fill_to}` → `{code, player_id, token}` (rate limited per IP) |
| POST | `/api/rooms/{code}/join` | `{name, archetype}` → `{code, player_id, token}` (409 when full or in progress) |
| GET | `/api/rooms/{code}` | public lobby state (never includes tokens) |

The seat **token** is the player's credential for that room. The client keeps it in
`sessionStorage`, so it survives a reload but not a new tab. Tokens are compared in constant
time.

**WebSockets.** `WS /ws/rooms/{code}?token=…` for rooms. `WS /ws/practice?name=&archetype=&bots=`
is a private one-seat room that starts immediately. Invalid credentials are accepted and then
closed with a code (4401 bad token, 4404 unknown room, 4400 bad practice params, 4408 abuse), so
browsers can show the reason.

| direction | message | notes |
|---|---|---|
| S→C | `lobby` | code, status, seats (name, archetype, ready, connected, host), `fill_to`, `can_start`, `last_result` |
| S→C | `welcome` | on match start or reconnect: `you`, `resume_seq`, `map`, physics `constants`, `snapshot` |
| S→C | `snapshot` | per player at up to 20 Hz: state + own `ack_seq` + events since this connection's cursor |
| S→C | `interact_result` / `error` / `pong` | `error.code`: `not_host`, `not_ready`, `in_progress`, `replaced`, … |
| C→S | `ready`, `set_archetype`, `set_fill`, `start` | lobby actions, validated (host-only where relevant) |
| C→S | `input`, `interact`, `ping` | in match |

**Fan-out.** The room tick loop only marks each connection dirty. Every connection has its own
writer task that, when it gets to send, builds that player's newest snapshot with all events
since its own cursor. A slow client receives fewer snapshots but never loses events, and never
slows the room down.

**Reconnects.** When a socket drops, the contestant stays in the match (disconnected, standing
still) and other players see an event. Reconnecting with the same token resumes the same
contestant. `resume_seq` tells a reloaded client where its input numbering must continue, since
the server rejects older numbers as replays. Lobby seats that stay disconnected for 30 s are
released. A room nobody has been connected to for 2 minutes is removed.

**Scaling note.** Rooms live in the memory of one server process. Running several processes
will need sticky routing by room code, or Redis-backed room ownership.

## Visual style

All art is original and generated in code at load time (`frontend/src/game/art`). There are no
external sprite files. One palette (`palette.ts`) and an automatic one-pixel outline pass keep
proportions and outlines consistent. The terrain is rasterised once into a single canvas
texture, and objects and characters are depth-sorted by their feet. Animation is deliberately
light: a 4-frame walk cycle, a 1 px idle bob, floating "+1" text, and a bouncing mission marker.
With reduced motion (OS preference or the in-game toggle), the bob, bounce, tweens and camera
shake are all turned off.

## Persistence (planned)

PostgreSQL + SQLAlchemy + Alembic with the tables listed in the design brief: an append-only
`game_events` table with a unique `(match_id, seq)`, state changes and events written in one
transaction, and seeds and rules version stored per match. Currency uses an idempotency-keyed
`currency_transactions` ledger. Crate openings are idempotent and record the server-side RNG
draw. Milestone 1 keeps everything in memory, and no persistence is claimed.

## Economy (planned, Milestone 5)

Game Points (earned) buy Bronze, Silver and Gold crates. Diamonds (premium, mock payments in
development) buy Platinum and Diamond crates. Reward tables and odds are configured on the
server and shown before every opening. Rewards come from `secrets`-based randomness on the
server and are written to an audit log. Rewards are cosmetic only. Paid random crates can be
turned off per region in favour of direct purchase.
