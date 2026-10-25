# ARENIX

A real-time 2D multiplayer fantasy game in pixel art. Human players and autonomous AI contestants
explore an island, complete missions, form alliances, betray each other and compete to win.

> **Status: Milestones 1–6 done, 7 partly done.** Play practice matches or multiplayer rooms (share a code; AI fills
> empty seats) in **council mode**: missions, chat, alliances, betrayals, council votes and
> eliminations. AI seats can be driven by strategist agents (offline heuristic planner or an LLM)
> that negotiate over a structured protocol. With a database, players earn Game Points and open
> cosmetic crates (odds always shown). The **Agent Lab** (`/lab`) shows interaction graphs,
> timelines, decision inspection, replays and experiment comparisons. LLM strategists are
> implemented but have not yet been run against the live API. See
> [docs/MILESTONES.md](docs/MILESTONES.md) for exact status and
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design.

## What you can do today

* **Practice** alone against AI, or **create a room** and share its 6-character code or invite
  link. Friends join, everyone readies up, and the host starts. Reloading or a dropped
  connection puts you back into the same contestant.
* Pick one of 8 original pixel-art contestants (cosmetic only, so everyone plays the same).
* Explore a 64×48 island: village plaza, forest, river and bridges, mine, castle arena, shrine
  ruins and a hidden glade.
* Move with **WASD / arrow keys**. Movement is predicted on the client and confirmed by the server.
* Press **E / Space** at a prompt to gather **wood** (forest) or **stone** (mine). Carry up to 3 and
  deliver them to the ruined **Watchtower**. Wake the **Ancient Shrine** with two others inside
  10 seconds.
* Every 75 s, or when someone rings the **Council Bell**, the council meets: discuss in chat, then
  vote someone out (or skip). Click a name to offer an **alliance** (shared bonus, whispers,
  mutual visibility). Betraying your ally in a vote is public.
* Each contestant has a private **secret objective**. When time runs out or two remain, the
  top-scoring survivor wins.
* AI contestants plan routes with A*, keep a trust model of everyone, form and break alliances,
  vote and react in chat, all through the same validated actions as you.
* The HUD shows mission progress, a minimap, a scoreboard, your pack, an event feed and the
  results screen. There is a reduced-motion toggle and touch controls on small screens.

## Run locally

Requirements: Python 3.12+ with [uv](https://docs.astral.sh/uv/), and Node 22+. PostgreSQL 16 is
optional: without it, the game runs and progression and crates are disabled.

```bash
# terminal 1: game server (http://localhost:8000)
cd backend
uv sync
# optional persistence (progression, crates, match history):
export ARENIX_DATABASE_URL=postgresql+asyncpg://arenix:arenix@localhost/arenix
uv run alembic upgrade head
uv run uvicorn arenix.server.app:app --reload --port 8000

# terminal 2: web client (http://localhost:3000)
cd frontend
npm install
npm run dev
```

Open http://localhost:3000, enter a name, choose a contestant and press **Play practice**, or
**Create room** and open the invite link in another browser or tab to play together.

Or with Docker: `docker compose up --build`, then open http://localhost:3000.

### Environment variables

| variable | where | default | purpose |
|---|---|---|---|
| `ARENIX_CORS_ORIGINS` | backend | `http://localhost:3000` | comma-separated allowed origins for REST |
| `NEXT_PUBLIC_ARENIX_WS` | frontend (build time) | `ws://<page host>:8000` | WebSocket base URL of the game server |
| `ARENIX_AGENT_PROVIDER` | backend | `off` | AI seat strategist: `off` (rule-based bots), `heuristic` (offline planner, no LLM), `anthropic` (LLM via the Anthropic API) |
| `ARENIX_AGENT_MODEL` | backend | unset | model ID for strategists; required when the provider is `anthropic` |
| `ARENIX_AGENT_PRICE_PER_MTOK` | backend | unset | `input,output` USD per million tokens (e.g. `4,20`); enables cost estimates and the cost budget |
| `ARENIX_AGENT_EFFORT` | backend | `low` | model effort level (decisions must land within seconds) |
| `ARENIX_AGENT_TIMEOUT_S` | backend | `8` | per-decision deadline; late decisions fall back to the rule policy |
| `ARENIX_AGENT_MAX_CONCURRENCY` | backend | `4` | concurrent model calls per match |
| `ARENIX_AGENT_MAX_CALLS_PER_MATCH` | backend | `300` | call budget per match |
| `ARENIX_AGENT_MAX_COST_USD_PER_MATCH` | backend | `2.0` | estimated-cost budget per match (list prices); then rule-based fallback |
| `ARENIX_DATABASE_URL` | backend | unset | PostgreSQL URL (`postgresql+asyncpg://…`); enables accounts, progression, crates, match history |
| `ARENIX_PAID_RANDOM_CRATES` | backend | `enabled` | set `disabled` where paid random rewards are restricted (Diamond-priced crates become unavailable) |
| `ARENIX_ADMIN_TOKEN` | backend | unset | when set, required (Bearer) to start experiments |
| `ARENIX_ALLOW_LLM_EXPERIMENTS` | backend | unset | `1` allows the costly `llm` condition through the experiments API |
| `ARENIX_TEST_DATABASE_URL` | tests | `postgresql+asyncpg://arenix:arenix@localhost/arenix_test` | database the economy tests reset and use |
| `ANTHROPIC_API_KEY` | backend | — | read by the Anthropic SDK when `ARENIX_AGENT_PROVIDER=anthropic`; never sent to clients |

**Cost note for `anthropic` mode.** Each strategist decision is one request: roughly 2–4K
input tokens plus a short JSON reply. With six AI seats deciding every 15 s plus at each
meeting, a 7-minute match makes on the order of 150–250 calls. That is around $1.5–5 per match
on a large model at list prices (an estimate, not a measurement), so the default
$2 budget usually ends in a rule-based fallback partway through. Set
`ARENIX_AGENT_PRICE_PER_MTOK` so the cost budget can be enforced; without it only the call and
token budgets apply. Raise the budget, or pick a
cheaper model with `ARENIX_AGENT_MODEL`. The game stays fully playable when the provider is off,
slow, out of budget or failing.

## Tests and checks

```bash
cd backend
uv run pytest -q            # engine, bots, physics property tests, WebSocket server, vectors
uv run ruff check . && uv run ruff format --check . && uv run mypy arenix

cd frontend
npm test                    # physics parity (golden vectors), prediction, interpolation, feed
npm run lint && npm run typecheck && npm run build
```

End-to-end smoke test (both servers running, Playwright + Chromium installed): it plays a real
match in a headless browser, gathering, delivering and waiting for the result.

```bash
cd frontend
node e2e/smoke.cjs http://localhost:3000        # practice match: gather, deliver, result
node e2e/multiplayer.cjs http://localhost:3000  # two players: create, join, play, reload
node e2e/economy.cjs http://localhost:3000      # guest account, open a crate, equip (needs DB)
```

If you change `backend/arenix/engine/physics.py`, regenerate the cross-language vectors with
`uv run python scripts/gen_movement_vectors.py`, then port the same change to
`frontend/src/shared/physics.ts`. Both test suites fail until the two match exactly.

## More docs

* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): design and protocols
* [docs/MILESTONES.md](docs/MILESTONES.md): what is done and what is not
* [docs/SECURITY.md](docs/SECURITY.md): security review and open items
* [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): production checklist
* [docs/benchmarks/](docs/benchmarks/): generated benchmark report and how to read it

## Project layout

```
backend/arenix/engine   pure, deterministic game engine (map, physics, A*, missions, bots, events)
backend/arenix/server   FastAPI app, validated WebSocket protocol, practice session loop
frontend/src/game       Phaser scene, procedural pixel art, network client
frontend/src/shared     TS physics port, prediction, interpolation, protocol types
frontend/src/components React HUD, minimap, results, touch controls
shared/test-vectors     golden movement trajectories shared by both test suites
docs/                   architecture and milestone checklist
```

## Known limitations

* Rooms are held in one server process's memory. Running several backend processes needs
  sticky routing first. Server restarts end all rooms.
* LLM strategists (`ARENIX_AGENT_PROVIDER=anthropic`) are implemented and unit-tested against a
  fake SDK client, but have not yet been run against the live API from this repository.
* The chat filter is a small placeholder blocklist, not real moderation.
* Guest accounts only (no login or recovery). Clearing browser storage loses the account.
* Payments are mocked. There is no real payment provider, regional detection or direct-purchase
  shop yet.
* Match events are persisted when the match ends, not continuously.
* There is no audio.
