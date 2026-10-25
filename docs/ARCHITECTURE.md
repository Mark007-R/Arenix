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
    protocol.py         Pydantic models for every inbound client message
    session.py          PracticeSession: 20 Hz tick loop around a Match
    app.py              FastAPI app: REST endpoints + /ws/practice WebSocket
  scripts/gen_movement_vectors.py   golden physics vectors for the client
  tests/                pytest (engine, bots, server, parity, property-based physics)
frontend/               Next.js 16 + React 19 + TypeScript + Tailwind 4 + Phaser 3
  src/shared/           physics.ts (exact port), prediction.ts, interpolation.ts, protocol.ts
  src/game/art/         procedural pixel art (characters, tiles, objects): original assets
  src/game/net/client.ts   socket + prediction + interpolation + HUD store updates
  src/game/scenes/WorldScene.ts   Phaser rendering, input, prompts, markers
  src/components/       React HUD, minimap, results, touch controls
  src/app/              routes: / (menu + character select), /play
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

## Mission and match flow (Milestone 1)

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

**Planned (Milestone 4):** an asynchronous agent orchestrator layered above this policy.

```
Observation (server-filtered) ─▶ Contestant policy (LLM, structured output)
                                   │  proposes: goal / message / vote
Memory + Beliefs ◀─────────────────┤
                                   ▼
                     Pydantic validation + authorization
                                   ▼
              Match coordinator (deadlines, budgets, retries, cancellation)
                                   ▼
                 Engine validation ─▶ confirmed GameEvent
                                   ▲
         Navigation controller (A*, this module) carries out movement goals
```

* A provider-agnostic LLM gateway with timeouts, concurrency limits, token and cost accounting,
  and a mock provider for tests.
* An agent message protocol (PLAN_PROPOSAL, ALLIANCE_PROPOSAL, ACCEPT, COUNTER_OFFER, REJECT,
  INFORMATION_SHARE, ACTION_PROPOSAL, VOTE_INTENT, SYSTEM_EVENT). Every message carries ids,
  phase, correlation id, expiry, and size and round limits.
* Claims are stored apart from confirmed events. A message is never treated as proof.
* The rule-based policy stays as the fallback, so the game remains playable with no model at all.

## Realtime protocol (current)

`GET /api/health`, `GET /api/maps`, `GET /api/maps/{id}`, `GET /api/archetypes`

`WS /ws/practice?name=&archetype=&bots=`

| direction | message | notes |
|---|---|---|
| S→C | `welcome` | `you`, `map` (tiles, collision, objects, regions, spawns), physics `constants`, first `snapshot` |
| S→C | `snapshot` (20 Hz) | `tick`, `status`, `time_left`, `contestants[]`, `nodes`, `mission`, `ack_seq`, new `events[]` |
| S→C | `interact_result` | `{target_id, ok, reason}` |
| C→S | `input` | `{seq, dx, dy}` |
| C→S | `interact` | `{target_id}` |
| C↔S | `ping` / `pong` | latency display |

Milestone 2 replaces `/ws/practice` with room-based sessions (`POST /api/rooms`, join by code,
lobby and ready states, reconnect tokens) and adds the named events from the design brief
(`player_joined`, `mission_completed`, `vote_started`, and so on) as typed messages.

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
