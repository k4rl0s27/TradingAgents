"""
Analysis service — bridges the webapp to TradingAgentsGraph.
Runs analyses in background tasks and stores results in SQLite.
"""

from __future__ import annotations

import asyncio
import logging
import traceback
from datetime import datetime

from ..database import get_db
from .portfolio_service import build_portfolio_context

logger = logging.getLogger(__name__)

# We import TradingAgentsGraph lazily so the webapp starts even if
# the tradingagents package has issues (useful for portfolio management only).
_tradingagents_available = True
try:
    from tradingagents.graph.trading_graph import TradingAgentsGraph
except Exception:
    _tradingagents_available = False
    logger.warning("TradingAgentsGraph not available — analysis will be disabled.")


# ── Background task runner ────────────────────────────────────────────────────

# In-memory registry of running tasks (for status polling).
# In production you'd use a proper task queue; this is fine for single-user LAN use.
_running_tasks: dict[int, asyncio.Task] = {}


async def run_analysis_background(run_id: int) -> None:
    """Execute an analysis in the background and store results."""
    db = await get_db()
    try:
        # Load the run details
        cursor = await db.execute("SELECT * FROM analysis_runs WHERE id = ?", (run_id,))
        run = await cursor.fetchone()
        if not run:
            return
        run = dict(run)

        if not _tradingagents_available:
            raise RuntimeError("TradingAgentsGraph is not available.")

        # Build portfolio context from the database
        portfolio_context = await build_portfolio_context()

        # Initialize the graph
        ta = TradingAgentsGraph(debug=False)

        # Run the analysis in a thread (propagate is synchronous)
        loop = asyncio.get_event_loop()
        final_state, signal = await loop.run_in_executor(
            None,
            lambda: ta.propagate(
                run["ticker"],
                run["analysis_date"],
                portfolio_context=portfolio_context,
            ),
        )

        # Extract structured outputs from final_state and store them
        results = _extract_results(final_state)
        for r in results:
            await db.execute(
                """INSERT INTO analysis_results (analysis_run_id, agent_name, output_type, content)
                   VALUES (?, ?, ?, ?)""",
                (run_id, r["agent_name"], r["output_type"], r["content"]),
            )

        # Extract final decision details
        rating = _extract_rating(final_state.get("final_trade_decision", ""))
        entry_price = _extract_entry_price(final_state.get("trader_investment_plan", ""))
        stop_loss = _extract_stop_loss(final_state.get("trader_investment_plan", ""))
        position_sizing = _extract_position_sizing(final_state.get("trader_investment_plan", ""))

        await db.execute(
            """UPDATE analysis_runs
               SET status = 'completed', rating = ?, entry_price = ?, stop_loss = ?,
                   position_sizing = ?, completed_at = datetime('now')
               WHERE id = ?""",
            (rating, entry_price, stop_loss, position_sizing, run_id),
        )
        await db.commit()

    except Exception as e:
        logger.exception("Analysis run %d failed: %s", run_id, e)
        try:
            await db.execute(
                "UPDATE analysis_runs SET status = 'failed', error_message = ?, "
                "completed_at = datetime('now') WHERE id = ?",
                (str(e)[:500], run_id),
            )
            await db.commit()
        except Exception:
            pass
    finally:
        await db.close()
        _running_tasks.pop(run_id, None)


# ── Public API ────────────────────────────────────────────────────────────────

async def start_analysis(
    ticker: str,
    analysis_date: str,
    analysis_type: str = "regular",
) -> int:
    """Create a new analysis run and start it in the background. Returns run_id."""
    if analysis_type == "options":
        raise NotImplementedError("Options analysis is coming in Phase 2.")

    db = await get_db()
    try:
        cursor = await db.execute(
            """INSERT INTO analysis_runs (ticker, analysis_type, analysis_date, status)
               VALUES (?, ?, ?, 'running')""",
            (ticker.upper(), analysis_type, analysis_date),
        )
        run_id = cursor.lastrowid
        await db.commit()
    finally:
        await db.close()

    # Start background task
    task = asyncio.create_task(run_analysis_background(run_id))
    _running_tasks[run_id] = task

    return run_id


async def get_analysis_status(run_id: int) -> dict:
    """Get the current status of an analysis run."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM analysis_runs WHERE id = ?", (run_id,))
        row = await cursor.fetchone()
        if not row:
            return {"error": "Analysis run not found"}
        return dict(row)
    finally:
        await db.close()


async def get_analysis_history(
    page: int = 1,
    per_page: int = 20,
    ticker_filter: str = "",
    type_filter: str = "",
) -> dict:
    """Get paginated analysis history."""
    db = await get_db()
    try:
        where_clauses = []
        params = []

        if ticker_filter:
            where_clauses.append("ticker = ?")
            params.append(ticker_filter.upper())
        if type_filter:
            where_clauses.append("analysis_type = ?")
            params.append(type_filter)

        where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

        # Count total
        cursor = await db.execute(
            f"SELECT COUNT(*) as cnt FROM analysis_runs {where_sql}", params
        )
        total = (await cursor.fetchone())["cnt"]

        # Fetch page
        offset = (page - 1) * per_page
        cursor = await db.execute(
            f"SELECT * FROM analysis_runs {where_sql} ORDER BY created_at DESC LIMIT ? OFFSET ?",
            params + [per_page, offset],
        )
        items = [dict(row) for row in await cursor.fetchall()]

        return {"items": items, "total": total, "page": page, "per_page": per_page}
    finally:
        await db.close()


async def get_analysis_detail(run_id: int) -> Optional[dict]:
    """Get full analysis detail with all agent outputs."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM analysis_runs WHERE id = ?", (run_id,))
        run = await cursor.fetchone()
        if not run:
            return None

        cursor = await db.execute(
            "SELECT * FROM analysis_results WHERE analysis_run_id = ? ORDER BY id ASC",
            (run_id,),
        )
        results = [dict(row) for row in await cursor.fetchall()]

        # Check for options analysis data (Phase 2)
        cursor = await db.execute(
            "SELECT * FROM options_analysis WHERE analysis_run_id = ?", (run_id,)
        )
        options_row = await cursor.fetchone()

        return {
            "run": dict(run),
            "results": results,
            "options": dict(options_row) if options_row else None,
        }
    finally:
        await db.close()


# ── Helpers ───────────────────────────────────────────────────────────────────

# Order mirrors the agent execution flow
_AGENT_OUTPUT_KEYS = [
    ("market_analyst", "market_report", "report"),
    ("sentiment_analyst", "sentiment_report", "report"),
    ("news_analyst", "news_report", "report"),
    ("fundamentals_analyst", "fundamentals_report", "report"),
    ("bull_researcher", "investment_debate_state", "bull_debate"),
    ("bear_researcher", "investment_debate_state", "bear_debate"),
    ("research_manager", "investment_plan", "structured_decision"),
    ("trader", "trader_investment_plan", "structured_decision"),
    ("aggressive_risk", "risk_debate_state", "risk_debate"),
    ("conservative_risk", "risk_debate_state", "risk_debate"),
    ("neutral_risk", "risk_debate_state", "risk_debate"),
    ("portfolio_manager", "final_trade_decision", "structured_decision"),
]


def _extract_results(final_state: dict) -> list[dict]:
    """Extract individual agent outputs from the final state."""
    results = []
    for agent_name, state_key, output_type in _AGENT_OUTPUT_KEYS:
        content = final_state.get(state_key, "")
        if not content:
            continue

        # For debate states, extract the relevant history
        if output_type == "bull_debate":
            debate = content if isinstance(content, dict) else {}
            content = debate.get("bull_history", "") or debate.get("history", "")
        elif output_type == "bear_debate":
            debate = content if isinstance(content, dict) else {}
            content = debate.get("bear_history", "") or debate.get("history", "")
        elif output_type == "risk_debate":
            debate = content if isinstance(content, dict) else {}
            # Determine which risk analyst based on agent_name
            if "aggressive" in agent_name:
                content = debate.get("aggressive_history", "") or debate.get("history", "")
            elif "conservative" in agent_name:
                content = debate.get("conservative_history", "") or debate.get("history", "")
            elif "neutral" in agent_name:
                content = debate.get("neutral_history", "") or debate.get("history", "")
            else:
                content = debate.get("history", "")

        if content:
            results.append({
                "agent_name": agent_name,
                "output_type": output_type,
                "content": str(content),
            })

    return results


def _extract_rating(text: str) -> str:
    """Extract 5-tier rating from final decision text."""
    import re
    for rating in ["Buy", "Overweight", "Hold", "Underweight", "Sell"]:
        if re.search(rf"\b{rating}\b", text, re.IGNORECASE):
            return rating
    return "Unknown"


def _extract_entry_price(text: str) -> Optional[float]:
    """Extract entry price from trader plan."""
    import re
    match = re.search(r"[Ee]ntry\s*[Pp]rice[:\s]*\$?([\d,.]+)", text)
    return float(match.group(1).replace(",", "")) if match else None


def _extract_stop_loss(text: str) -> Optional[float]:
    """Extract stop loss from trader plan."""
    import re
    match = re.search(r"[Ss]top\s*[Ll]oss[:\s]*\$?([\d,.]+)", text)
    return float(match.group(1).replace(",", "")) if match else None


def _extract_position_sizing(text: str) -> Optional[str]:
    """Extract position sizing guidance from trader plan."""
    import re
    match = re.search(r"[Pp]osition\s*[Ss]iz(?:e|ing)[:\s]*(.+?)(?:\n|$)", text)
    return match.group(1).strip()[:200] if match else None
