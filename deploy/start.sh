#!/bin/sh
# Container entry point: migrate the database (when there is one), then serve the game.
set -e
if [ -n "$ARENIX_DATABASE_URL" ]; then
  .venv/bin/alembic upgrade head
fi
# Access logs stay off: WebSocket URLs carry per-room seat tokens.
# Proxy headers on: hosting platforms terminate TLS in front of the container.
exec .venv/bin/uvicorn arenix.server.app:app --host 0.0.0.0 --port "${PORT:-8000}" \
  --no-access-log --proxy-headers --forwarded-allow-ips="*"
