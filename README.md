# ARENIX

A real-time multiplayer social-deduction game in a clean isometric 3D "drafting table" style.
Human players and autonomous AI contestants explore an island, do tasks, argue in council meetings
and try to find out who among them is the **impostor** — while the impostor quietly picks them off.

> **Status: release-ready.** Impostor mode with secret roles (islander, impostor, sheriff,
> jester), sabotage, random per-match skills, body reports, ghosts and council meetings with a
> real chat room, on two islands (Moonfall and the winter Frostpeak). Play solo practice, **quick
> play** with others, public or private rooms (AI fills empty seats), with accounts, leaderboards,
> public profiles, cosmetic crates (odds always shown), sound and music, moderation and reports.
> One container serves everything; [docs/RELEASE.md](docs/RELEASE.md) walks through free
> hosting (Render + Neon) and earning (Ko-fi donations, Stripe diamond packs, portal ads). The
> **Agent Lab** (`/lab`) shows interaction graphs, replays and experiment comparisons. See
> [docs/MILESTONES.md](docs/MILESTONES.md) for exact status and
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design.

## Screenshots

| | |
|---|---|
| ![Home screen](docs/screenshots/1-home.png) | ![Quick play lobby counting down](docs/screenshots/9-quick-play.png) |
| **Home:** pick a contestant, then quick play, practice, or create / join a room | **Quick play:** one click into a public lobby that starts itself; AI fills the empty seats |
| ![Secret role reveal at the start of a match](docs/screenshots/2-role-reveal.png) | ![The isometric 3D island as the impostor](docs/screenshots/3-exploring.png) |
| **Role reveal:** your secret role and this match's skill | **In a match:** the 3D island, view cones, role card, tasks, minimap, sabotage and kill buttons |
| ![A body on the ground with a report prompt](docs/screenshots/5-body.png) | ![A council meeting with the chat room](docs/screenshots/4-meeting-chat.png) |
| **A body:** walk up and press E to report it | **Council meeting:** vote on the left, a real chat room on the right — the AI answers you |
| ![Team results with every role revealed](docs/screenshots/6-results.png) | ![Crates with their odds](docs/screenshots/7-collection.png) |
| **Results:** winning team, every role and skill revealed | **Collection:** cosmetic crates with all odds shown |
| ![Leaderboard](docs/screenshots/10-leaderboard.png) | ![Agent Lab: interaction graph and replay](docs/screenshots/8-agent-lab.png) |
| **Leaderboard:** wins, level and win rate (registered players) | **Agent Lab:** interaction graph, replay and decision inspector |

## What you can do today

* **Practice** against 4–7 AI contestants, or **create a room** and share its 6-character code
  or invite link (AI fills the field up to at least 5). Friends join, everyone readies up, and the
  host starts. Reloading or a dropped connection puts you back into the same contestant.
* Pick one of 8 original low-poly contestants (cosmetic only, so everyone plays the same).
* Explore **Moonfall Isle** (96×72 tiles): village plaza with the Council Bell, Whispering
  Forest and Moon Lake, the Watchtower, a river, the walled Old Mine, Misty Marsh, Lighthouse
  Point, the Castle Arena, an old quarry, fishing docks, an apple orchard, shrine ruins and a
  hidden glade.
* At the start you secretly learn your **role**: one contestant (two from 7 players) is the
  **impostor**, everyone else is an **islander**. Impostors know each other.
* **Islanders** gather wood and stone for the Watchtower and carry wood to light the **5
  beacons** at the island's far corners. They win by voting out every impostor, or by finishing
  the tower and every beacon.
* **Impostors** eliminate islanders by standing next to them and pressing **K** (with a
  cooldown), fake tasks to blend in and lie in meetings. They win when they equal the islanders
  in number, or when time runs out.
* Anyone near the kill sees it happen. Everyone else finds out only when a **body** is found:
  walk up and press **E** to report it, and the council meets. The Council Bell calls an
  emergency meeting (once per player), and there is a scheduled meeting every 90 s.
* Meetings open a **chat room** next to the ballot: say where you were, accuse, defend, then
  vote someone out or skip. Ejections are confirmed ("…was / was NOT an impostor").
* The dead become **ghosts**: they roam unseen and can only chat with other ghosts.
* Every match each contestant gets a random **skill**: Swift (faster), Scout (sees further),
  Strongback (carries 5), Detective (learns two names when reporting, one is the killer), Medic
  (one shield that blocks an attack) or Lookout (senses nearby kills).
* You only see what's near you (13 tiles, more for Scouts), and only people nearby see you
  complete a task — so "I saw them deliver stone" is real evidence.
* AI contestants plan routes with A*, do tasks, report bodies, remember who they saw where, and
  talk in varied natural sentences built only from what they observed. AI impostors stalk
  people who are alone, strike only when unwatched, and then lie and shift the blame. They read
  your messages too: name one of them and ask "where were you?" and it answers.
* Click a name to offer an **alliance** (shared bonus, whispers, mutual visibility).
* The HUD shows your role and skill, the tasks, a minimap with beacons, a scoreboard, your pack,
  an event feed and the results screen with every role revealed. There is a reduced-motion
  toggle and touch controls on small screens.
* **Classic mode** (the original council game on the 64×48 Emerald Isle) is still in the engine;
  the simulation runner and the strategist agents use it.

## Run locally

Requirements: Python 3.12+ with [uv](https://docs.astral.sh/uv/), and Node 22+. PostgreSQL 16 is
optional: without it, the game runs and progression and crates are disabled.

```bash
# terminal 1: game server (http://localhost:8000)
cd backend
uv sync
# optional persistence (progression, crates, match history):
export ARENIX_DATABASE_URL=postgresql+asyncpg://arenix:arenix@localhost/arenix
uv run python -m alembic upgrade head
uv run python -m uvicorn arenix.server.app:app --reload --port 8000

# terminal 2: web client (http://localhost:3000)
cd frontend
npm install
npm run dev
```

Open http://localhost:3000, enter a name, choose a contestant and press **Play practice**, or
**Create room** and open the invite link in another browser or tab to play together.

Or with Docker: `docker compose up --build`, then open http://localhost:3000.

**Windows notes.** Use PowerShell syntax for variables (`$env:ARENIX_DATABASE_URL = "..."`, not
`export`), and run the server and the web client in separate windows. Commands are written as
`uv run python -m <tool>` on purpose: Smart App Control can block the small `.exe` launchers uv
creates in `.venv\Scripts` ("An Application Control policy has blocked this file"), while
`python -m` runs the same tool through the signed-off interpreter. The backend is pinned to
Python 3.13 (`backend/.python-version`); uv downloads it automatically.

### Environment variables

| variable | where | default | purpose |
|---|---|---|---|
| `ARENIX_CORS_ORIGINS` | backend | `http://localhost:3000` | comma-separated allowed origins for REST |
| `NEXT_PUBLIC_ARENIX_WS` | frontend (build time) | `ws://<page host>:8000` | WebSocket base URL of the game server |
| `ARENIX_AGENT_PROVIDER` | backend | `off` | classic-mode AI strategist: `off` (rule-based bots), `heuristic` (offline planner, no LLM), `anthropic` (LLM via the Anthropic API). Impostor mode always uses its rule-based bots |
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
| `ARENIX_STATIC_DIR` | backend | unset | serve the statically exported web client from this folder (one-service hosting; set in the Docker image) |
| `ARENIX_PRODUCTION` | backend | unset | `1` turns the mock store off when Stripe isn't configured |
| `ARENIX_PUBLIC_URL` | backend | request host | public site address; Stripe returns buyers here |
| `ARENIX_DONATE_URL` | backend | unset | `https://` donation link shown as "Support ARENIX" (hidden on portals) |
| `ARENIX_CONTACT_EMAIL` | backend | unset | contact address on the Privacy and Terms pages |
| `STRIPE_SECRET_KEY` | backend | unset | enables real diamond purchases through Stripe Checkout |
| `STRIPE_WEBHOOK_SECRET` | backend | unset | verifies Stripe's payment webhooks (`/api/stripe/webhook`) |
| `ARENIX_CURRENCY` | backend | `usd` | Stripe checkout currency |
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
uv run python -m pytest -q  # engine, bots, physics property tests, WebSocket server, vectors
uv run python -m ruff check . && uv run python -m ruff format --check . && uv run python -m mypy arenix

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
* [docs/RELEASE.md](docs/RELEASE.md): **put the game online for free and start earning**, step by step
* [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): production checklist
* [docs/benchmarks/](docs/benchmarks/): generated benchmark report and how to read it

## Project layout

```
backend/arenix/engine   pure, deterministic game engine (map, physics, A*, missions, bots, events)
backend/arenix/server   FastAPI app, validated WebSocket protocol, practice session loop
frontend/src/game       Three.js isometric world, low-poly figures, network client
frontend/src/shared     TS physics port, prediction, interpolation, protocol types
frontend/src/components React HUD, minimap, results, touch controls
shared/test-vectors     golden movement trajectories shared by both test suites
docs/                   architecture and milestone checklist
```

## Known limitations

* Rooms are held in one server process's memory. Running several backend processes needs
  sticky routing first. Server restarts end all rooms.
* LLM strategists (`ARENIX_AGENT_PROVIDER=anthropic`) are implemented and unit-tested against a
  fake SDK client, but have not yet been run against the live API from this repository. They
  drive classic mode only; in impostor mode every AI seat uses the rule-based deduction bots.
* AI chat in impostor mode is generated from templates (many wordings per intent, grounded in
  what the bot saw). It reacts to names, accusations and "where were you?", but it can't hold
  an open-ended conversation.
* The chat filter is rule-based (blocklist with leetspeak and spacing tricks, link and contact
  blocking, spam limits), not a trained moderation model. Reports go to admins for review.
* Password reset by email is not available yet.
* Stripe payments are unit-tested against signed fake webhooks, not yet run against a live
  Stripe account from this repository. Test in Stripe's test mode first (docs/RELEASE.md).
* Portal SDK calls follow the CrazyGames v3 and Poki v2 SDKs; check them in each portal's QA
  tool before submitting.
* Match events are persisted when the match ends, not continuously.
