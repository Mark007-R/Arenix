# One container runs the whole game: the web pages, the HTTP API and the WebSocket game server.
# Used by render.yaml; works on any container host. Set ARENIX_DATABASE_URL to keep progression.

FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build:static

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/arenix ./arenix
COPY backend/alembic ./alembic
COPY backend/alembic.ini ./
RUN uv sync --frozen --no-dev
COPY --from=web /web/out ./site
COPY deploy/start.sh ./start.sh
ENV ARENIX_STATIC_DIR=/app/site ARENIX_PRODUCTION=1 PORT=8000
EXPOSE 8000
CMD ["sh", "start.sh"]
