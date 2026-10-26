"""accounts (email + password), sessions and player reports

Revision ID: 7a1c3e9b2f40
Revises: 2d67065edf05
Create Date: 2026-10-26 09:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "7a1c3e9b2f40"
down_revision: str | Sequence[str] | None = "2d67065edf05"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("email", sa.String(length=254), nullable=True))
    op.add_column("users", sa.Column("password_hash", sa.String(length=200), nullable=True))
    op.create_unique_constraint("uq_users_email", "users", ["email"])
    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])
    op.create_table(
        "player_reports",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("match_id", sa.String(length=64), nullable=False),
        sa.Column("room_code", sa.String(length=8), nullable=True),
        sa.Column("reporter_contestant", sa.String(length=16), nullable=False),
        sa.Column("reporter_user_id", sa.BigInteger(), nullable=True),
        sa.Column("reported_contestant", sa.String(length=16), nullable=False),
        sa.Column("reported_name", sa.String(length=20), nullable=False),
        sa.Column("reported_user_id", sa.BigInteger(), nullable=True),
        sa.Column("reason", sa.String(length=32), nullable=False),
        sa.Column("note", sa.String(length=300), nullable=True),
        sa.Column("evidence", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "reason in ('harassment','hate','cheating','spam','inappropriate_name','other')", name="ck_report_reason"
        ),
        sa.CheckConstraint("status in ('open','reviewed','dismissed')", name="ck_report_status"),
        sa.ForeignKeyConstraint(["reporter_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reported_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_player_reports_match_id", "player_reports", ["match_id"])


def downgrade() -> None:
    op.drop_index("ix_player_reports_match_id", table_name="player_reports")
    op.drop_table("player_reports")
    op.drop_index("ix_auth_sessions_user_id", table_name="auth_sessions")
    op.drop_table("auth_sessions")
    op.drop_constraint("uq_users_email", "users", type_="unique")
    op.drop_column("users", "password_hash")
    op.drop_column("users", "email")
