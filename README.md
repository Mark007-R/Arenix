# ARENIX

A real-time 2D multiplayer fantasy game in pixel art. Human players and autonomous AI contestants
explore an island, complete missions, form alliances, betray each other and compete to win.

> **Status: Milestone 1 (playable prototype).** You can play a practice match on the Emerald Isle
> against server-driven AI contestants. Rooms with several humans, chat and alliances, voting,
> LLM agents, crates and the Agent Lab are **not built yet**. See
> [docs/MILESTONES.md](docs/MILESTONES.md) for exact status and
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design.

## What you can do today

* Pick one of 8 original pixel-art contestants (cosmetic only, so everyone plays the same).
* Explore a 64×48 island: village plaza, forest, river and bridges, mine, castle arena, shrine
  ruins and a hidden glade.
* Move with **WASD / arrow keys**. Movement is predicted on the client and confirmed by the server.
* Press **E / Space** at a prompt to gather **wood** (forest) or **stone** (mine). Carry up to 3 and
  deliver them to the ruined **Watchtower** before the timer runs out.
* AI contestants plan their own routes with A*, compete for the same nodes and race you for MVP.
* The HUD shows mission progress, a minimap, a scoreboard, your pack, an event feed and the
  results screen. There is a reduced-motion toggle and touch controls on small screens.

## Run locally

Requirements: Python 3.12+ with [uv](https://docs.astral.sh/uv/), and Node 22+.

```bash
# terminal 1: game server (http://localhost:8000)
cd backend
uv sync
uv run uvicorn arenix.server.app:app --reload --port 8000

# terminal 2: web client (http://localhost:3000)
cd frontend
npm install
npm run dev
```

Open http://localhost:3000, enter a name, choose a contestant and press **Play**.

Or with Docker: `docker compose up --build`, then open http://localhost:3000.

### Environment variables

| variable | where | default | purpose |
|---|---|---|---|
| `ARENIX_CORS_ORIGINS` | backend | `http://localhost:3000` | comma-separated allowed origins for REST |
| `NEXT_PUBLIC_ARENIX_WS` | frontend (build time) | `ws://<page host>:8000` | WebSocket base URL of the game server |

No secrets are needed yet. Model credentials (Milestone 4) and the database URL (Milestone 5)
will be read from environment variables only and never sent to the client.

## Tests and checks

```bash
cd backend
uv run pytest -q            # engine, bots, physics property tests, WebSocket server, vectors
uv run ruff check . && uv run ruff format --check . && uv run mypy arenix

cd frontend
npm test                    # physics parity (golden vectors), prediction, interpolation, feed
npm run lint && npm run typecheck && npm run build
```

If you change `backend/arenix/engine/physics.py`, regenerate the cross-language vectors with
`uv run python scripts/gen_movement_vectors.py`, then port the same change to
`frontend/src/shared/physics.ts`. Both test suites fail until the two match exactly.

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

## Known limitations (Milestone 1)

* Practice mode only: one human per match. Rooms, room codes, lobbies and reconnects come in
  Milestone 2.
* AI contestants use the deterministic rule-based policy. There are no LLM calls yet, and no
  negotiation, alliances or voting.
* All state is in memory. There is no database, accounts, progression or currencies yet.
* The minimap shows every contestant, with no visibility rules yet.
* There is no audio.
