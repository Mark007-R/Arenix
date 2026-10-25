"""Database engine/session factory. Persistence is enabled only when ARENIX_DATABASE_URL is set."""

from __future__ import annotations

import os

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine


class Database:
    def __init__(self, url: str) -> None:
        self.engine: AsyncEngine = create_async_engine(url, pool_pre_ping=True, pool_size=5, max_overflow=10)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False, class_=AsyncSession)

    async def dispose(self) -> None:
        await self.engine.dispose()


def database_from_env() -> Database | None:
    url = os.environ.get("ARENIX_DATABASE_URL")
    return Database(url) if url else None
