"""Alembic environment (async). Database URL comes from ARENIX_DATABASE_URL."""

import asyncio
import os
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context
from arenix.db.models import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)
url = os.environ.get("ARENIX_DATABASE_URL") or config.get_main_option("sqlalchemy.url")
config.set_main_option("sqlalchemy.url", url or "")
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=url, target_metadata=target_metadata, literal_binds=True, dialect_opts={"paramstyle": "named"}
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:  # type: ignore[no-untyped-def]
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.", poolclass=pool.NullPool
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async_migrations())
