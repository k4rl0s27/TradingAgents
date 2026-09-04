"""
Analysis service — runs analyses in background tasks and stores results.

The graph-facing work lives in ``graph_runner`` (the single seam that imports
tradingagents); this module only orchestrates: DB rows, the in-memory task
registry, the per-run SSE event queue, and streaming to the client.
"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import suppress

from ..database import get_db
from .portfolio_service import build_portfolio_context

logger = logging.getLogger(__name__)


# ── Background task runner ────────────────────────────────────────────────────

# In-memory registry of running tasks and SSE event queues. Runs are reconciled
# at startup (database.init_db) so a restart can't leave rows stuck 'running'.
_running_tasks: dict[int, asyncio.Task] = {}
_event_queues: dict[int, asyncio.Queue] = {}


async def run_analysis_background(run_id: int, queue: asyncio.Queue) -> None:
    """Execute an analysis in the background, streaming agent outputs via SSE."""
    from .graph_runner import run_graph_and_collect

    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM analysis_runs WHERE id = ?", (run_id,))
        run = await cursor.fetchone()
        if not run:
            queue.put_nowait({"type": "error", "error": "Analysis run not found"})
            queue.put_nowait(None)
            return
        run = dict(run)

        user_id = run["user_id"]
        portfolio_context = await build_portfolio_context(user_id)

        # Merge user's LLM settings (provider, model, key) — the runner merges
        # them over DEFAULT_CONFIG + the depth config.
        from .user_service import get_user_llm_config

        user_llm = await get_user_llm_config(user_id)

        loop = asyncio.get_event_loop()
        summary = await loop.run_in_executor(
            None,
            lambda: run_graph_and_collect(
                ticker=run["ticker"],
                analysis_date=run["analysis_date"],
                analysis_depth=run["analysis_depth"],
                user_llm=user_llm,
                portfolio_context=portfolio_context,
                emit=lambda event: loop.call_soon_threadsafe(queue.put_nowait, event),
            ),
        )

        # Store per-agent outputs
        for r in summary["results"]:
            await db.execute(
                """INSERT INTO analysis_results (analysis_run_id, agent_name, output_type, content)
                   VALUES (?, ?, ?, ?)""",
                (run_id, r["agent_name"], r["output_type"], r["content"]),
            )

        await db.execute(
            """UPDATE analysis_runs
               SET status = 'completed', rating = ?, entry_price = ?, stop_loss = ?,
                   completed_at = datetime('now')
               WHERE id = ?""",
            (summary["rating"], summary["entry_price"], summary["stop_loss"], run_id),
        )
        await db.commit()

        queue.put_nowait(
            {
                "type": "complete",
                "rating": summary["rating"],
                "entry_price": summary["entry_price"],
                "stop_loss": summary["stop_loss"],
            }
        )

    except Exception as e:
        logger.exception("Analysis run %d failed: %s", run_id, e)
        with suppress(Exception):
            queue.put_nowait({"type": "error", "error": str(e)[:500]})
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
        with suppress(Exception):
            queue.put_nowait(None)  # Sentinel to close SSE
        _event_queues.pop(run_id, None)


async def stream_analysis_events(run_id: int):
    """Async generator that yields SSE-formatted events for an analysis run."""
    queue = _event_queues.get(run_id)
    if queue is None:
        yield f"event: error\ndata: {json.dumps({'error': 'Run not found or already completed'})}\n\n"
        return

    agent_count = 0
    while True:
        try:
            event = await asyncio.wait_for(queue.get(), timeout=600.0)
        except asyncio.TimeoutError:
            yield f"event: error\ndata: {json.dumps({'error': 'Stream timed out'})}\n\n"
            return

        if event is None:  # Sentinel
            return

        event_type = event["type"]
        if event_type == "agent":
            agent_count += 1
            data = json.dumps(
                {
                    "agent_name": event["agent_name"],
                    "content": event["content"],
                    "index": agent_count,
                }
            )
        elif event_type in ("status", "error"):
            data = json.dumps({"content": event["content"]} if event_type == "status" else {"error": event["error"]})
        elif event_type == "complete":
            data = json.dumps(
                {
                    "rating": event["rating"],
                    "entry_price": event["entry_price"],
                    "stop_loss": event["stop_loss"],
                }
            )
        else:
            continue
        yield f"event: {event_type}\ndata: {data}\n\n"
        if event_type == "error":
            return


# ── Public API ────────────────────────────────────────────────────────────────

async def start_analysis(
    user_id: int,
    ticker: str,
    analysis_date: str,
    analysis_type: str = "regular",
    analysis_depth: str = "medium",
) -> int:
    """Create a new analysis run and start it in the background. Returns run_id."""
    if analysis_type == "options":
        raise NotImplementedError("Options analysis is coming in Phase 2.")

    db = await get_db()
    try:
        cursor = await db.execute(
            """INSERT INTO analysis_runs (user_id, ticker, analysis_type, analysis_depth, analysis_date, status)
               VALUES (?, ?, ?, ?, ?, 'running')""",
            (user_id, ticker.upper(), analysis_type, analysis_depth, analysis_date),
        )
        run_id = cursor.lastrowid
        await db.commit()
    finally:
        await db.close()

    # Create event queue before starting background task so SSE connects immediately
    queue: asyncio.Queue = asyncio.Queue()
    _event_queues[run_id] = queue

    # Start background task
    task = asyncio.create_task(run_analysis_background(run_id, queue))
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


async def get_running_analyses(user_id: int) -> dict:
    """Get analyses that are currently running, newest first."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM analysis_runs WHERE user_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 5",
            (user_id,),
        )
        rows = await cursor.fetchall()
        return {"running": [dict(r) for r in rows]}
    finally:
        await db.close()


async def get_analysis_history(
    user_id: int,
    page: int = 1,
    per_page: int = 20,
    ticker_filter: str = "",
    type_filter: str = "",
) -> dict:
    """Get paginated analysis history."""
    db = await get_db()
    try:
        where_clauses = ["user_id = ?"]
        params = [user_id]

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


async def get_analysis_detail(run_id: int) -> dict | None:
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
