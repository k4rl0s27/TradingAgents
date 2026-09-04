"""Webapp database tests: versioned migrations + startup reconciliation."""

from __future__ import annotations

import asyncio

import pytest

import webapp.database as db

pytestmark = pytest.mark.unit


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def tmp_db(tmp_path, monkeypatch):
    """Point the webapp DB at a throwaway file for the duration of the test."""
    monkeypatch.setattr(db, "DB_DIR", tmp_path)
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "trading.db")
    return db.DB_PATH


def test_fresh_db_reaches_current_version(tmp_db):
    async def scenario():
        await db.init_db()
        conn = await db.get_db()
        try:
            cur = await conn.execute("SELECT MAX(version) FROM schema_version")
            assert (await cur.fetchone())[0] == db.SCHEMA_VERSION
            cur = await conn.execute("PRAGMA table_info(analysis_runs)")
            cols = {r["name"] for r in await cur.fetchall()}
            assert "analysis_depth" in cols
        finally:
            await conn.close()

    _run(scenario())


def test_init_db_is_idempotent(tmp_db):
    async def scenario():
        await db.init_db()
        await db.init_db()  # must not raise despite schema_version already set
        conn = await db.get_db()
        try:
            cur = await conn.execute("SELECT COUNT(*) FROM schema_version")
            rows = (await cur.fetchone())[0]
            assert rows <= db.SCHEMA_VERSION
        finally:
            await conn.close()

    _run(scenario())


def test_legacy_db_without_tracked_columns_gets_migrated(tmp_db):
    """A v1-era DB (missing later columns) is upgraded to the current shape."""

    async def scenario():
        conn = await db.get_db()
        try:
            # Recreate only the pre-v1 shape: no schema_version, no
            # analysis_depth / simplefin columns.
            await conn.executescript(
                """
                CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
                CREATE TABLE analysis_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    ticker TEXT NOT NULL,
                    analysis_type TEXT NOT NULL,
                    analysis_date TEXT NOT NULL,
                    rating TEXT,
                    entry_price REAL,
                    stop_loss REAL,
                    position_sizing TEXT,
                    status TEXT NOT NULL DEFAULT 'running',
                    error_message TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    completed_at TEXT
                );
                CREATE TABLE holdings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    ticker TEXT NOT NULL,
                    asset_type TEXT NOT NULL DEFAULT 'stock',
                    quantity REAL NOT NULL DEFAULT 0,
                    avg_cost REAL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                    UNIQUE(user_id, ticker)
                );
                CREATE TABLE transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    ticker TEXT NOT NULL,
                    transaction_type TEXT NOT NULL,
                    quantity REAL NOT NULL,
                    price REAL NOT NULL,
                    total_amount REAL NOT NULL,
                    fees REAL DEFAULT 0,
                    date TEXT NOT NULL,
                    notes TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                """
            )
            await conn.commit()
        finally:
            await conn.close()

        await db.init_db()
        conn = await db.get_db()
        try:
            cur = await conn.execute("SELECT MAX(version) FROM schema_version")
            assert (await cur.fetchone())[0] == db.SCHEMA_VERSION
            for table, column in (
                ("analysis_runs", "analysis_depth"),
                ("holdings", "source"),
                ("holdings", "simplefin_holding_id"),
                ("transactions", "source"),
                ("transactions", "simplefin_transaction_id"),
            ):
                cur = await conn.execute(
                    "SELECT 1 FROM pragma_table_info(?) WHERE name = ?",
                    (table, column),
                )
                assert await cur.fetchone() is not None, f"{table}.{column} missing"
        finally:
            await conn.close()

    _run(scenario())


def test_orphaned_running_runs_failed_after_restart(tmp_db):
    async def scenario():
        await db.init_db()
        conn = await db.get_db()
        try:
            await conn.execute(
                "INSERT INTO users (oidc_sub, email) VALUES ('u1', 'a@b.c')"
            )
            cur = await conn.execute("SELECT id FROM users")
            uid = (await cur.fetchone())[0]
            await conn.execute(
                "INSERT INTO analysis_runs (user_id, ticker, analysis_type, "
                "analysis_date, status) VALUES (?, ?, ?, ?, 'running')",
                (uid, "AAPL", "regular", "2026-01-01"),
            )
            await conn.commit()
        finally:
            await conn.close()

        # Simulated server restart: init_db reconciles the zombie.
        await db.init_db()
        conn = await db.get_db()
        try:
            cur = await conn.execute(
                "SELECT status, error_message FROM analysis_runs"
            )
            row = dict(await cur.fetchone())
            assert row["status"] == "failed"
            assert "restart" in row["error_message"]
        finally:
            await conn.close()

    _run(scenario())
