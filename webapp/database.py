"""
SQLite database setup and migration logic for the TradingAgents webapp.
Uses aiosqlite for async database access.
"""

import aiosqlite
import os
from pathlib import Path

DB_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = DB_DIR / "trading.db"

# Schema version tracking table
SCHEMA_VERSION = 1


async def get_db() -> aiosqlite.Connection:
    """Get an async database connection. Caller must close it."""
    DB_DIR.mkdir(parents=True, exist_ok=True)
    db = await aiosqlite.connect(str(DB_PATH))
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    return db


async def init_db() -> None:
    """Initialize database schema. Safe to call multiple times (idempotent)."""
    db = await get_db()
    try:
        await db.executescript(_SCHEMA_SQL)
        await db.execute(
            "INSERT OR IGNORE INTO schema_version (version) VALUES (?)",
            (SCHEMA_VERSION,),
        )
        await db.commit()
    finally:
        await db.close()


_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
);

-- Current portfolio holdings (manual entry)
CREATE TABLE IF NOT EXISTS holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL UNIQUE,
    asset_type TEXT NOT NULL DEFAULT 'stock',
    quantity REAL NOT NULL DEFAULT 0,
    avg_cost REAL,
    sector TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Record of all buy/sell executions
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    transaction_type TEXT NOT NULL CHECK(transaction_type IN ('buy', 'sell')),
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    total_amount REAL NOT NULL,
    fees REAL DEFAULT 0,
    date TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cash balance history
CREATE TABLE IF NOT EXISTS cash_balance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Analysis runs (each invocation of the agent graph)
CREATE TABLE IF NOT EXISTS analysis_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    analysis_type TEXT NOT NULL DEFAULT 'regular' CHECK(analysis_type IN ('regular', 'options')),
    analysis_date TEXT NOT NULL,
    rating TEXT,
    entry_price REAL,
    stop_loss REAL,
    position_sizing TEXT,
    status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed')),
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
);

-- Individual agent outputs for each analysis run
CREATE TABLE IF NOT EXISTS analysis_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_run_id INTEGER NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    agent_name TEXT NOT NULL,
    output_type TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for fast history lookups
CREATE INDEX IF NOT EXISTS idx_analysis_runs_ticker ON analysis_runs(ticker);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_created ON analysis_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_results_run ON analysis_results(analysis_run_id);

-- Options-specific analysis data (Phase 2)
CREATE TABLE IF NOT EXISTS options_analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_run_id INTEGER NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    option_strategy TEXT,
    contract_type TEXT,
    recommended_strike REAL,
    recommended_expiration TEXT,
    max_profit REAL,
    max_loss REAL,
    breakeven REAL,
    greeks_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""
