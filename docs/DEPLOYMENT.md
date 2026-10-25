# Deployment

ARENIX is two services plus PostgreSQL:

| Service | Build | Runs |
|---|---|---|
| backend | `backend/Dockerfile` | `uvicorn arenix.server.app:app` (FastAPI + WebSockets), access logs off |
| frontend | `frontend/Dockerfile` | Next.js standalone server on port 3000 |
| database | managed PostgreSQL 16 | migrated with `alembic upgrade head` |

## Local, all-in-one

```bash
docker compose up --build    # db → migrate → backend (heuristic AI strategists) → frontend
```

## Production checklist

1. **Database:** provision managed PostgreSQL, then set
   `ARENIX_DATABASE_URL=postgresql+asyncpg://USER:PASS@HOST/DB`. Run
   `uv run python -m alembic upgrade head` from `backend/` as a release step, before starting new backends.
2. **Backend environment:**
   * `ARENIX_CORS_ORIGINS=https://your-frontend.example`. This also restricts WebSocket origins.
   * `ARENIX_ADMIN_TOKEN=<random>` to protect experiment runs
   * `ARENIX_AGENT_PROVIDER=off|heuristic|anthropic`. For `anthropic`, also set
     `ANTHROPIC_API_KEY`, and review `ARENIX_AGENT_MAX_COST_USD_PER_MATCH` and
     `ARENIX_AGENT_MODEL` (see the cost note in the README).
   * `ARENIX_PAID_RANDOM_CRATES=disabled` in regions where paid random rewards are restricted
3. **Frontend build arg:** `NEXT_PUBLIC_ARENIX_WS=wss://your-backend.example`. HTTP API calls use
   the same host over https.
4. **TLS:** terminate TLS at your load balancer or platform. Serve the backend over `wss://` and
   `https://`.
5. **One backend process per deployment for now.** Rooms and their tick loops live in process
   memory, so all players in a room must reach the same process. To scale out, add sticky routing
   by room code (or Redis-backed room ownership) first. Running several uvicorn workers *without*
   sticky routing will break rooms.
6. **Health check:** `GET /api/health`.

## Suitable hosts

* Frontend: any Node host or platform that runs a Next.js standalone server.
* Backend: any container host with long-lived WebSocket support (no serverless functions — the
  20 Hz room loop must keep running).
* Database: any managed PostgreSQL 16 or newer.

## Operational notes

* A server restart ends all live matches. Finished matches are already persisted; in-progress
  ones are lost, because events are written when a match ends.
* Seed the catalog by starting the backend: it upserts cosmetics, crates and odds on every start.
  Changing prices or odds means editing `backend/arenix/economy/catalog.py` and redeploying.
* Benchmarks: `uv run python -m arenix.sim.runner --help`.
