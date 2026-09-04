"""Seed demo data so the webapp UI has something to show in local development.

Targets the dev-autologin user (WEBAPP_DEV_AUTOLOGIN=1 mode): a fresh install
has an empty portfolio and zero analyses, which makes it hard to eyeball the
dashboard, history and detail views. This script gives that user holdings,
transactions, cash history and a handful of completed analyses.

Usage (from the repo root, with the backend stopped or running — it writes the
DB directly):

    set SECRET_KEY=anything        # or have it in your .env
    python scripts/seed_demo.py

Re-running wipes and re-seeds only the dev user's rows. Production users are
never touched.

NOTE: the dev identity is duplicated from webapp/routers/auth.py (_DEV_SUB).
Keep the two in sync.
"""

from __future__ import annotations

import datetime as dt
import os
import sqlite3
from pathlib import Path

DEV_SUB = "webapp-dev-local"
DB_PATH = Path(__file__).resolve().parent.parent / "data" / "trading.db"

HOLDINGS = [
    # (ticker, asset_type, quantity, avg_cost)
    ("NVDA", "stock", 12, 118.4),
    ("AAPL", "stock", 30, 172.3),
    ("MSFT", "stock", 8, 401.2),
    ("BTC-USD", "crypto", 0.25, 62000.0),
]

TRANSACTIONS = [
    # (ticker, type, qty, price, fees, days_ago, notes)
    ("NVDA", "buy", 5, 112.0, 1.0, 90, "opened position"),
    ("NVDA", "buy", 7, 123.0, 1.0, 60, "added after pullback"),
    ("AAPL", "buy", 30, 172.3, 1.0, 45, None),
    ("MSFT", "buy", 8, 401.2, 1.0, 30, None),
    ("BTC-USD", "buy", 0.25, 62000.0, 2.5, 20, "dollar-cost averaging"),
]

CASH_HISTORY = [
    # (amount, days_ago, notes)
    (15000.0, 95, "initial deposit"),
    (8000.0, 45, "paycheck transfer"),
    (6000.0, 5, "trimmed a winner"),
]

# Completed analyses to populate History + Detail views. Content is deliberately
# short but shaped like real agent output. (agent_name matches the snake_case
# keys the graph runner persists.)
def _analysis_sections(ticker: str) -> dict[str, str]:
    return {
        "market_analyst": (
            f"{ticker} trades in a wide range between the 50-day support and recent "
            "resistance. Volume is picking up on up-days, and ATR suggests the move "
            "can continue without overextending."
        ),
        "sentiment_analyst": (
            "Social sentiment is moderately positive: retail chatter skews bullish "
            "after the last earnings print, while StockTwits shows no euphoria extreme."
        ),
        "news_analyst": (
            "Macro backdrop is mixed but supportive: rates are steady, and sector news "
            "has been constructive with no earnings surprises on the calendar."
        ),
        "fundamentals_analyst": (
            "Margins are healthy and the balance sheet carries little net debt. Growth "
            "is decelerating from peak but still above the sector median; valuation "
            "remains reasonable versus forward estimates."
        ),
        "bull_researcher": (
            "Bulls argue the sell-off is overdone: cash flow covers capex, the guidance "
            "beat was broad, and positioning is not crowded. A re-rating to the sector "
            "multiple implies meaningful upside."
        ),
        "bear_researcher": (
            "Bears point to decelerating bookings, an aggressive guide-down risk next "
            "quarter, and an elevated entry price if momentum fades. Their base case "
            "argues for waiting for a lower entry."
        ),
        "research_manager": (
            "**Recommendation**: Overweight\n\n"
            "**Rationale**: Fundamentals are solid, the debate resolves on the bullish "
            "side because downside is protected by cash generation, and technicals "
            "confirm the setup.\n\n"
            "**Strategic Actions**: Scale in on strength above the breakout level; add "
            "again on any test of the 50-day."
        ),
        "trader": (
            "**Action**: Buy\n\n"
            "**Reasoning**: The research plan and market structure agree; enter after "
            "confirmation, keep size moderate given the macro noise.\n\n"
            f"**Entry Price**: {_price_guess(ticker)}\n\n"
            f"**Stop Loss**: {_price_guess(ticker) * 0.92:.2f}\n\n"
            "**Position Sizing**: ~5% of portfolio, scaled in two tranches."
        ),
        "aggressive_risk": (
            "Aggressive desk: fully comfortable with the setup, would take the full "
            "size immediately and trail the stop under the swing low."
        ),
        "conservative_risk": (
            "Conservative desk: wants half size until the first red candle after "
            "entry; flags macro headlines as the main tail risk."
        ),
        "neutral_risk": (
            "Neutral desk: acceptable risk/reward at the proposed entry, suggests "
            "splitting the difference and adding the second tranche on confirmation."
        ),
        "portfolio_manager": (
            "**Rating**: Buy\n\n"
            "**Decision**: Approve the buy with the trader's proposed levels. Existing "
            "cash covers the size without changing overall portfolio risk.\n\n"
            "**Rationale**: Fundamentals, sentiment and technicals align; risk desks "
            "converge on an acceptable risk/reward."
        ),
    }


def _price_guess(ticker: str) -> float:
    guess = {"NVDA": 138.0, "AAPL": 230.0, "MSFT": 460.0, "BTC-USD": 66000.0}.get(ticker, 100.0)
    return round(guess, 2)


ANALYSES = [
    # (ticker, depth, days_ago, rating, outcome_status, error)
    ("NVDA", "deep", 4, "Buy", "completed", None),
    ("AAPL", "medium", 10, "Hold", "completed", None),
    ("MSFT", "medium", 20, "Buy", "completed", None),
    ("BTC-USD", "quick", 25, "REVIEW", "completed", None),
    ("TSLA", "medium", 30, "Sell", "completed", None),
    ("NVDA", "quick", 35, None, "failed", "API key for provider 'deepseek' is not set. Please set the DEEPSEEK_API_KEY environment variable."),
]


def _date(days_ago: int) -> str:
    return (dt.date.today() - dt.timedelta(days=days_ago)).isoformat()


def seed() -> None:
    secret = os.environ.get("SECRET_KEY")
    if not secret:
        raise SystemExit(
            "SECRET_KEY is not set — the demo user's settings are stored encrypted. "
            "Set it in your environment or .env first (any value is fine for dev)."
        )

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Ensure the schema exists (a never-booted DB is empty). Idempotent: all
    # statements are CREATE IF NOT EXISTS, and versioned migrations are the
    # app's job at startup.
    from webapp.database import _SCHEMA_SQL

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        conn.executescript(_SCHEMA_SQL)
        # The dev user is auto-provisioned by the app on first /auth/me, but the
        # seeder may run before the app ever has: create it when missing.
        cur = conn.execute("SELECT id FROM users WHERE oidc_sub = ?", (DEV_SUB,))
        row = cur.fetchone()
        if row:
            user_id = row["id"]
        else:
            cur = conn.execute(
                "INSERT INTO users (oidc_sub, email, display_name, is_initialized) "
                "VALUES (?, ?, ?, 1)",
                (DEV_SUB, "dev@local", "Local Dev"),
            )
            user_id = cur.lastrowid

        # Wipe only the demo user's rows so re-runs stay idempotent.
        conn.execute(
            "DELETE FROM analysis_results WHERE analysis_run_id IN "
            "(SELECT id FROM analysis_runs WHERE user_id = ?)",
            (user_id,),
        )
        for table in ("analysis_runs", "cash_balance", "transactions", "holdings", "user_settings"):
            conn.execute(f"DELETE FROM {table} WHERE user_id = ?", (user_id,))

        # Encrypted settings row (provider openai with a placeholder key) so the
        # setup wizard does not block the UI in dev.
        from webapp.crypto import encrypt_api_key

        conn.execute(
            "INSERT INTO user_settings (user_id, llm_provider, deep_think_llm, "
            "quick_think_llm, encrypted_api_key) VALUES (?, ?, ?, ?, ?)",
            (user_id, "openai", "gpt-5.5", "gpt-5.4-mini", encrypt_api_key("sk-demo-placeholder")),
        )
        conn.execute("UPDATE users SET is_initialized = 1 WHERE id = ?", (user_id,))

        for ticker, asset_type, qty, avg_cost in HOLDINGS:
            conn.execute(
                "INSERT INTO holdings (user_id, ticker, asset_type, quantity, avg_cost) "
                "VALUES (?, ?, ?, ?, ?)",
                (user_id, ticker, asset_type, qty, avg_cost),
            )
        for ticker, kind, qty, price, fees, days_ago, notes in TRANSACTIONS:
            total = qty * price
            conn.execute(
                "INSERT INTO transactions (user_id, ticker, transaction_type, quantity, "
                "price, total_amount, fees, date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (user_id, ticker, kind, qty, price, total, fees, _date(days_ago), notes),
            )
        for amount, days_ago, notes in CASH_HISTORY:
            conn.execute(
                "INSERT INTO cash_balance (user_id, amount, date, notes, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (user_id, amount, _date(days_ago), notes, f"{_date(days_ago)} 12:00:00"),
            )

        for ticker, depth, days_ago, rating, status, error in ANALYSES:
            created = _date(days_ago)
            if status == "completed":
                completed_at = _date(days_ago - 1)
                entry = _price_guess(ticker)
                stop = round(entry * 0.92, 2)
            else:
                completed_at = _date(days_ago - 1)
                entry = stop = None
            cur = conn.execute(
                "INSERT INTO analysis_runs (user_id, ticker, analysis_type, analysis_depth, "
                "analysis_date, rating, entry_price, stop_loss, status, error_message, "
                "created_at, completed_at) VALUES (?, ?, 'regular', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (user_id, ticker, depth, created, rating, entry, stop, status, error, created, completed_at),
            )
            run_id = cur.lastrowid
            for agent, content in _analysis_sections(ticker).items():
                output_type = {
                    "portfolio_manager": "structured_decision",
                    "bull_researcher": "bull_debate",
                    "bear_researcher": "bear_debate",
                    "research_manager": "structured_decision",
                    "trader": "structured_decision",
                    "aggressive_risk": "risk_debate",
                    "conservative_risk": "risk_debate",
                    "neutral_risk": "risk_debate",
                }.get(agent, agent.rsplit("_", 1)[0] if "_" in agent else agent)
                conn.execute(
                    "INSERT INTO analysis_results (analysis_run_id, agent_name, output_type, content) "
                    "VALUES (?, ?, ?, ?)",
                    (run_id, agent, output_type, content),
                )

        conn.commit()
        n_runs = conn.execute("SELECT COUNT(*) FROM analysis_runs WHERE user_id = ?", (user_id,)).fetchone()[0]
        print(f"Seeded demo data for user '{DEV_SUB}' (id={user_id}): {len(HOLDINGS)} holdings, "
              f"{len(TRANSACTIONS)} transactions, {len(CASH_HISTORY)} cash entries, {n_runs} analyses.")
        print("Start the webapp with WEBAPP_DEV_AUTOLOGIN=1 and open http://localhost:8000")
    finally:
        conn.close()


if __name__ == "__main__":
    seed()
