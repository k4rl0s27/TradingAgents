"""
SQLite database setup and migration logic for the TradingAgents webapp.
Uses aiosqlite for async database access.

Migrations are numbered by the schema version they bring the DB to
(``_MIGRATIONS[3]`` brings a DB to version 3). ``init_db`` applies only the
migrations newer than the recorded ``schema_version``, so each runs exactly
once per database, and errors surface instead of being swallowed.
"""

from pathlib import Path

import aiosqlite

DB_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = DB_DIR / "trading.db"

# Current schema version. Bump it when adding an entry to ``_MIGRATIONS``.
SCHEMA_VERSION = 3

# Ordered by target version: {version: [(table, column, full ADD COLUMN ddl)]}.
# Column additions are guarded by a PRAGMA existence check, which makes them
# no-ops on fresh databases (``_SCHEMA_SQL`` already creates the current shape)
# and on databases that predate version tracking but were already upgraded by
# the old boot-loop.
_MIGRATIONS: dict[int, list[tuple[str, str, str]]] = {
    # v1: analysis depth (quick/medium/deep) on runs
    1: [("analysis_runs", "analysis_depth", "analysis_depth TEXT NOT NULL DEFAULT 'medium'")],
    # v2: SimpleFIN source tracking on holdings and transactions
    2: [
        ("holdings", "source", "source TEXT NOT NULL DEFAULT 'manual'"),
        ("holdings", "simplefin_holding_id", "simplefin_holding_id TEXT"),
        ("transactions", "source", "source TEXT NOT NULL DEFAULT 'manual'"),
        ("transactions", "simplefin_transaction_id", "simplefin_transaction_id TEXT"),
    ],
    # v3: schema_version tracking introduced; no DDL
    3: [],
}


async def get_db() -> aiosqlite.Connection:
    """Get an async database connection. Caller must close it."""
    DB_DIR.mkdir(parents=True, exist_ok=True)
    db = await aiosqlite.connect(str(DB_PATH))
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    return db


async def _column_exists(db: aiosqlite.Connection, table: str, column: str) -> bool:
    """Whether ``table`` already has ``column`` (via the table-info pragma)."""
    cursor = await db.execute(
        "SELECT 1 FROM pragma_table_info(?) WHERE name = ?", (table, column)
    )
    return await cursor.fetchone() is not None


async def _apply_migrations(db: aiosqlite.Connection) -> None:
    """Apply pending migrations and record the resulting schema version."""
    cursor = await db.execute("SELECT COALESCE(MAX(version), 0) FROM schema_version")
    row = await cursor.fetchone()
    current = row[0]
    for version, steps in sorted(_MIGRATIONS.items()):
        if version <= current:
            continue
        for table, column, ddl in steps:
            if not await _column_exists(db, table, column):
                await db.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")
        await db.execute(
            "INSERT OR REPLACE INTO schema_version (version) VALUES (?)", (version,)
        )
        current = version


async def init_db() -> None:
    """Initialize the database schema and reconcile runtime state.

    Safe to call multiple times (idempotent): migrations run only when the
    recorded ``schema_version`` is behind ``SCHEMA_VERSION``.
    """
    db = await get_db()
    try:
        await db.executescript(_SCHEMA_SQL)
        await _apply_migrations(db)
        await db.commit()
        # Startup reconciliation: analysis runs and their SSE queues live in
        # memory, so anything still 'running' after a restart can never
        # complete. Mark it failed instead of leaving a zombie.
        await db.execute(
            "UPDATE analysis_runs SET status = 'failed', "
            "error_message = 'Interrupted by server restart', "
            "completed_at = datetime('now') WHERE status = 'running'"
        )
        await db.commit()
    finally:
        await db.close()


_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
);

-- Users (auto-provisioned from OIDC)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    oidc_sub TEXT NOT NULL UNIQUE,
    email TEXT,
    display_name TEXT,
    is_initialized INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-user LLM provider settings (API key encrypted at rest)
CREATE TABLE IF NOT EXISTS user_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    llm_provider TEXT NOT NULL,
    deep_think_llm TEXT,
    quick_think_llm TEXT,
    backend_url TEXT,
    encrypted_api_key TEXT NOT NULL,
    temperature REAL,
    google_thinking_level TEXT,
    openai_reasoning_effort TEXT,
    anthropic_effort TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Current portfolio holdings (manual entry or SimpleFIN sync)
CREATE TABLE IF NOT EXISTS holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    asset_type TEXT NOT NULL DEFAULT 'stock',
    quantity REAL NOT NULL DEFAULT 0,
    avg_cost REAL,
    source TEXT NOT NULL DEFAULT 'manual',
    simplefin_holding_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, ticker)
);

-- Record of all buy/sell executions (manual entry or SimpleFIN sync)
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    transaction_type TEXT NOT NULL CHECK(transaction_type IN ('buy', 'sell')),
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    total_amount REAL NOT NULL,
    fees REAL DEFAULT 0,
    date TEXT NOT NULL,
    notes TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    simplefin_transaction_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cash balance history
CREATE TABLE IF NOT EXISTS cash_balance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Analysis runs (each invocation of the agent graph)
CREATE TABLE IF NOT EXISTS analysis_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    analysis_type TEXT NOT NULL DEFAULT 'regular' CHECK(analysis_type IN ('regular', 'options')),
    analysis_depth TEXT NOT NULL DEFAULT 'medium' CHECK(analysis_depth IN ('quick', 'medium', 'deep')),
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
CREATE INDEX IF NOT EXISTS idx_analysis_runs_user ON analysis_runs(user_id);
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

-- SimpleFIN connection (encrypted Access URL per user)
CREATE TABLE IF NOT EXISTS simplefin_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    access_url_encrypted TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Which SimpleFIN account the user chose to monitor
CREATE TABLE IF NOT EXISTS simplefin_linked_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    simplefin_account_id TEXT NOT NULL,
    account_name TEXT NOT NULL,
    org_name TEXT,
    org_domain TEXT,
    last_synced_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""
