"""Database engine/session factory. Persistence is enabled only when ARENIX_DATABASE_URL is set."""

from __future__ import annotations

import os
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine


def normalize_url(url: str) -> str:
    """Accept the plain ``postgres://…?sslmode=require`` URLs hosts like Neon and Render hand out.

    SQLAlchemy needs the asyncpg driver in the scheme, and asyncpg spells ``sslmode`` as ``ssl``
    (and does not know libpq-only options such as ``channel_binding``).
    """
    parts = urlsplit(url)
    scheme = parts.scheme
    if scheme in ("postgres", "postgresql"):
        scheme = "postgresql+asyncpg"
    query = []
    for k, v in parse_qsl(parts.query, keep_blank_values=True):
        if k == "sslmode":
            query.append(("ssl", v))
        elif k != "channel_binding":
            query.append((k, v))
    return urlunsplit((scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


class Database:
    def __init__(self, url: str) -> None:
        url = normalize_url(url)
        self.engine: AsyncEngine = create_async_engine(url, pool_pre_ping=True, pool_size=5, max_overflow=10)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False, class_=AsyncSession)

    async def dispose(self) -> None:
        await self.engine.dispose()


def database_from_env() -> Database | None:
    url = os.environ.get("ARENIX_DATABASE_URL")
    return Database(url) if url else None
