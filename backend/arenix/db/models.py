"""ORM models. The schema itself is owned by Alembic migrations (alembic/versions)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    type_annotation_map = {dict[str, Any]: JSONB, list[Any]: JSONB}


def _now() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ---------------------------------------------------------------- accounts & progression
class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    display_name: Mapped[str] = mapped_column(String(20))
    # The guest token (sha256 hex; the raw token is never stored). Registered accounts sign in
    # with email + password and get rows in auth_sessions instead.
    session_token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    is_guest: Mapped[bool] = mapped_column(Boolean, default=True)
    email: Mapped[str | None] = mapped_column(String(254), unique=True, nullable=True)  # stored lowercase
    password_hash: Mapped[str | None] = mapped_column(String(200), nullable=True)  # scrypt, see accounts.py
    created_at: Mapped[datetime] = _now()


class AuthSession(Base):
    """A signed-in device. Tokens expire and can be revoked (logout, password change)."""

    __tablename__ = "auth_sessions"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = _now()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class PlayerReport(Base):
    """A player report. Evidence is copied server-side from the match log, never from the client."""

    __tablename__ = "player_reports"
    __table_args__ = (
        CheckConstraint(
            "reason in ('harassment','hate','cheating','spam','inappropriate_name','other')",
            name="ck_report_reason",
        ),
        CheckConstraint("status in ('open','reviewed','dismissed')", name="ck_report_status"),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    match_id: Mapped[str] = mapped_column(String(64), index=True)
    room_code: Mapped[str | None] = mapped_column(String(8), nullable=True)
    reporter_contestant: Mapped[str] = mapped_column(String(16))
    reporter_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reported_contestant: Mapped[str] = mapped_column(String(16))
    reported_name: Mapped[str] = mapped_column(String(20))
    reported_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reason: Mapped[str] = mapped_column(String(32))
    note: Mapped[str | None] = mapped_column(String(300), nullable=True)
    evidence: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    status: Mapped[str] = mapped_column(String(16), default="open")
    created_at: Mapped[datetime] = _now()


class PlayerProfile(Base):
    __tablename__ = "player_profiles"
    __table_args__ = (
        CheckConstraint("game_points >= 0", name="ck_profile_points_nonneg"),
        CheckConstraint("diamonds >= 0", name="ck_profile_diamonds_nonneg"),
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    level: Mapped[int] = mapped_column(Integer, default=1)
    xp: Mapped[int] = mapped_column(Integer, default=0)
    game_points: Mapped[int] = mapped_column(BigInteger, default=0)
    diamonds: Mapped[int] = mapped_column(BigInteger, default=0)
    matches_played: Mapped[int] = mapped_column(Integer, default=0)
    wins: Mapped[int] = mapped_column(Integer, default=0)
    units_delivered: Mapped[int] = mapped_column(Integer, default=0)
    shrines_awakened: Mapped[int] = mapped_column(Integer, default=0)
    achievements: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    equipped: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    adult_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class CurrencyTransaction(Base):
    """Append-only ledger. idempotency_key makes every credit/debit safe to retry."""

    __tablename__ = "currency_transactions"
    __table_args__ = (
        CheckConstraint("currency in ('game_points','diamonds')", name="ck_tx_currency"),
        CheckConstraint("balance_after >= 0", name="ck_tx_balance_nonneg"),
        Index("ix_tx_user_created", "user_id", "created_at"),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    currency: Mapped[str] = mapped_column(String(16))
    amount: Mapped[int] = mapped_column(BigInteger)
    balance_after: Mapped[int] = mapped_column(BigInteger)
    reason: Mapped[str] = mapped_column(String(32))
    ref_type: Mapped[str | None] = mapped_column(String(32))
    ref_id: Mapped[str | None] = mapped_column(String(64))
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True)
    created_at: Mapped[datetime] = _now()


# ---------------------------------------------------------------- cosmetics & crates
class CosmeticItem(Base):
    __tablename__ = "cosmetic_items"
    __table_args__ = (
        CheckConstraint("rarity in ('common','uncommon','rare','epic','legendary')", name="ck_item_rarity"),
        CheckConstraint("kind in ('skin','hat','chat_pack','effect')", name="ck_item_kind"),
    )
    id: Mapped[str] = mapped_column(String(48), primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(16))
    rarity: Mapped[str] = mapped_column(String(16))
    archetype: Mapped[str | None] = mapped_column(String(20))
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    duplicate_refund_points: Mapped[int] = mapped_column(Integer, default=0)


class CrateDefinition(Base):
    __tablename__ = "crate_definitions"
    __table_args__ = (
        CheckConstraint("currency in ('game_points','diamonds')", name="ck_crate_currency"),
        CheckConstraint("price > 0", name="ck_crate_price"),
    )
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    currency: Mapped[str] = mapped_column(String(16))
    price: Mapped[int] = mapped_column(Integer)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    table_version: Mapped[str] = mapped_column(String(64))  # hash of the current reward table


class CrateRewardEntry(Base):
    """One row per item a crate can drop. weight is in basis points; a crate's weights sum to 10 000."""

    __tablename__ = "crate_reward_tables"
    __table_args__ = (
        UniqueConstraint("crate_id", "item_id", name="uq_reward_crate_item"),
        CheckConstraint("weight > 0", name="ck_reward_weight"),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    crate_id: Mapped[str] = mapped_column(ForeignKey("crate_definitions.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[str] = mapped_column(ForeignKey("cosmetic_items.id"))
    weight: Mapped[int] = mapped_column(Integer)


class CrateOpening(Base):
    __tablename__ = "crate_openings"
    __table_args__ = (UniqueConstraint("user_id", "idempotency_key", name="uq_opening_idem"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    crate_id: Mapped[str] = mapped_column(ForeignKey("crate_definitions.id"))
    idempotency_key: Mapped[str] = mapped_column(String(128))
    currency: Mapped[str] = mapped_column(String(16))
    price: Mapped[int] = mapped_column(Integer)
    roll: Mapped[int] = mapped_column(Integer)  # secrets.randbelow(10000) — the audited draw
    table_version: Mapped[str] = mapped_column(String(64))
    item_id: Mapped[str] = mapped_column(ForeignKey("cosmetic_items.id"))
    duplicate: Mapped[bool] = mapped_column(Boolean, default=False)
    refund_points: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = _now()


class PlayerInventory(Base):
    __tablename__ = "player_inventory"
    __table_args__ = (UniqueConstraint("user_id", "item_id", name="uq_inventory_item"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[str] = mapped_column(ForeignKey("cosmetic_items.id"))
    source: Mapped[str] = mapped_column(String(32))
    acquired_at: Mapped[datetime] = _now()


# ---------------------------------------------------------------- matches & event log
class MatchRow(Base):
    __tablename__ = "matches"
    id: Mapped[str] = mapped_column(String(48), primary_key=True)
    room_code: Mapped[str | None] = mapped_column(String(8))
    map_id: Mapped[str] = mapped_column(String(32))
    seed: Mapped[int] = mapped_column(BigInteger)
    rules_version: Mapped[str] = mapped_column(String(16))
    ai_mode: Mapped[str] = mapped_column(String(16))
    ticks: Mapped[int] = mapped_column(Integer)
    result: Mapped[dict[str, Any]] = mapped_column(JSONB)
    agent_summary: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    finished_at: Mapped[datetime] = _now()


class MatchParticipant(Base):
    __tablename__ = "match_participants"
    __table_args__ = (UniqueConstraint("match_id", "contestant_id", name="uq_participant"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    match_id: Mapped[str] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    contestant_id: Mapped[str] = mapped_column(String(16))
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    name: Mapped[str] = mapped_column(String(20))
    archetype: Mapped[str] = mapped_column(String(20))
    is_bot: Mapped[bool] = mapped_column(Boolean)
    score: Mapped[int] = mapped_column(Integer)
    alive: Mapped[bool] = mapped_column(Boolean)
    placement: Mapped[int] = mapped_column(Integer)
    objective: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


class GamePhase(Base):
    __tablename__ = "game_phases"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    match_id: Mapped[str] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    meeting: Mapped[int] = mapped_column(Integer)
    phase: Mapped[str] = mapped_column(String(16))
    start_tick: Mapped[int] = mapped_column(Integer)
    end_tick: Mapped[int | None] = mapped_column(Integer)


class GameEventRow(Base):
    """The authoritative, append-only event log (UPDATE/DELETE blocked by a trigger)."""

    __tablename__ = "game_events"
    __table_args__ = (UniqueConstraint("match_id", "seq", name="uq_event_seq"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    match_id: Mapped[str] = mapped_column(ForeignKey("matches.id", ondelete="RESTRICT"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    tick: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String(32), index=True)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB)
    visible_to: Mapped[list[Any] | None] = mapped_column(JSONB)  # null = public


class AgentState(Base):
    __tablename__ = "agent_states"
    __table_args__ = (UniqueConstraint("match_id", "agent_id", name="uq_agent_state"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    match_id: Mapped[str] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    agent_id: Mapped[str] = mapped_column(String(16))
    personality: Mapped[dict[str, Any]] = mapped_column(JSONB)
    beliefs: Mapped[dict[str, Any]] = mapped_column(JSONB)
    memory: Mapped[dict[str, Any]] = mapped_column(JSONB)


class AgentMessageRow(Base):
    __tablename__ = "agent_messages"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    match_id: Mapped[str] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    message_id: Mapped[str] = mapped_column(String(16))
    correlation_id: Mapped[str | None] = mapped_column(String(16))
    phase_id: Mapped[str] = mapped_column(String(24))
    sender: Mapped[str] = mapped_column(String(16))
    recipient: Mapped[str | None] = mapped_column(String(16))
    type: Mapped[str] = mapped_column(String(24))
    text: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    tick: Mapped[int] = mapped_column(Integer)
    expires_tick: Mapped[int] = mapped_column(Integer)


class AgentDecisionRow(Base):
    __tablename__ = "agent_decisions"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    match_id: Mapped[str] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    agent_id: Mapped[str] = mapped_column(String(16), index=True)
    record: Mapped[dict[str, Any]] = mapped_column(JSONB)  # DecisionRecord: context, proposal, validation


class LlmTrace(Base):
    __tablename__ = "llm_traces"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    match_id: Mapped[str] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    agent_id: Mapped[str] = mapped_column(String(16))
    provider: Mapped[str] = mapped_column(String(16))
    model: Mapped[str] = mapped_column(String(48))
    latency_ms: Mapped[float] = mapped_column(Float)
    input_tokens: Mapped[int] = mapped_column(Integer)
    output_tokens: Mapped[int] = mapped_column(Integer)
    cost_usd: Mapped[float | None] = mapped_column(Float)
    error: Mapped[str | None] = mapped_column(String(48))


class Experiment(Base):
    __tablename__ = "experiments"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    config: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _now()


class ExperimentRun(Base):
    __tablename__ = "experiment_runs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    experiment_id: Mapped[int] = mapped_column(ForeignKey("experiments.id", ondelete="CASCADE"), index=True)
    condition: Mapped[str] = mapped_column(String(32))
    seed: Mapped[int] = mapped_column(BigInteger)
    metrics: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _now()
