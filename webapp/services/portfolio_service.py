"""
Portfolio business logic — CRUD for holdings, transactions, cash balance.
Also builds the portfolio_context string injected into agent prompts.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime

import yfinance as yf

from ..database import get_db

logger = logging.getLogger(__name__)


# ── Cash Balance ──────────────────────────────────────────────────────────────

async def get_latest_cash(user_id: int) -> float:
    """Get the most recent cash balance, or 0 if none set."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT amount FROM cash_balance WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
            (user_id,),
        )
        row = await cursor.fetchone()
        return row["amount"] if row else 0.0
    finally:
        await db.close()


async def set_cash(user_id: int, amount: float, date: str, notes: str | None = None) -> dict:
    """Record a new cash balance."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "INSERT INTO cash_balance (user_id, amount, date, notes) VALUES (?, ?, ?, ?)",
            (user_id, amount, date, notes),
        )
        await db.commit()
        return {"id": cursor.lastrowid, "amount": amount, "date": date, "notes": notes}
    finally:
        await db.close()


async def get_cash_history(user_id: int, limit: int = 20) -> list[dict]:
    """Get cash balance history, most recent first."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM cash_balance WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit),
        )
        return [dict(row) for row in await cursor.fetchall()]
    finally:
        await db.close()


async def delete_cash(user_id: int, cash_id: int) -> bool:
    """Delete a cash balance entry by ID. Returns True if deleted."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "DELETE FROM cash_balance WHERE id = ? AND user_id = ?", (cash_id, user_id)
        )
        await db.commit()
        return cursor.rowcount > 0
    finally:
        await db.close()


# ── Holdings ──────────────────────────────────────────────────────────────────

async def get_all_holdings(user_id: int) -> list[dict]:
    """Get all current holdings for a user."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM holdings WHERE user_id = ? ORDER BY ticker ASC",
            (user_id,),
        )
        return [dict(row) for row in await cursor.fetchall()]
    finally:
        await db.close()


async def get_holding(user_id: int, ticker: str) -> dict | None:
    """Get a single holding by ticker."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM holdings WHERE user_id = ? AND ticker = ?",
            (user_id, ticker.upper()),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def get_holding_by_id(user_id: int, holding_id: int) -> dict | None:
    """Get a single holding by its primary key."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM holdings WHERE id = ? AND user_id = ?",
            (holding_id, user_id),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def upsert_holding(
    user_id: int,
    ticker: str,
    quantity: float,
    avg_cost: float | None = None,
    asset_type: str = "stock",
) -> dict:
    """Add or update a holding. Uses (user_id, ticker) as unique key."""
    db = await get_db()
    try:
        existing = await db.execute(
            "SELECT id FROM holdings WHERE user_id = ? AND ticker = ?",
            (user_id, ticker.upper()),
        )
        row = await existing.fetchone()
        if row:
            await db.execute(
                """UPDATE holdings
                   SET quantity = ?, avg_cost = ?, asset_type = ?,
                       updated_at = datetime('now')
                   WHERE user_id = ? AND ticker = ?""",
                (quantity, avg_cost, asset_type, user_id, ticker.upper()),
            )
        else:
            await db.execute(
                """INSERT INTO holdings (user_id, ticker, quantity, avg_cost, asset_type)
                   VALUES (?, ?, ?, ?, ?)""",
                (user_id, ticker.upper(), quantity, avg_cost, asset_type),
            )
        await db.commit()
        return await get_holding(user_id, ticker.upper())
    finally:
        await db.close()


async def delete_holding(user_id: int, holding_id: int) -> bool:
    """Delete a holding by ID. Returns True if deleted."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "DELETE FROM holdings WHERE id = ? AND user_id = ?", (holding_id, user_id)
        )
        await db.commit()
        return cursor.rowcount > 0
    finally:
        await db.close()


# ── Transactions ──────────────────────────────────────────────────────────────

async def get_transactions(user_id: int, limit: int = 50) -> list[dict]:
    """Get recent transactions, most recent first."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC, created_at DESC LIMIT ?",
            (user_id, limit),
        )
        return [dict(row) for row in await cursor.fetchall()]
    finally:
        await db.close()


async def get_transaction_by_id(user_id: int, tx_id: int) -> dict | None:
    """Get a single transaction by its primary key."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM transactions WHERE id = ? AND user_id = ?",
            (tx_id, user_id),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def record_transaction(
    user_id: int,
    ticker: str,
    transaction_type: str,
    quantity: float,
    price: float,
    fees: float = 0,
    date: str = "",
    notes: str | None = None,
) -> dict:
    """Record a buy/sell transaction and automatically update the holding."""
    total = quantity * price
    db = await get_db()
    try:
        # Record the transaction
        cursor = await db.execute(
            """INSERT INTO transactions (user_id, ticker, transaction_type, quantity, price,
               total_amount, fees, date, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (user_id, ticker.upper(), transaction_type, quantity, price, total, fees, date, notes),
        )
        tx_id = cursor.lastrowid

        # Update the holding automatically
        existing = await get_holding(user_id, ticker.upper())
        if existing:
            if transaction_type == "buy":
                # Weighted average cost basis
                old_total_cost = existing["quantity"] * (existing["avg_cost"] or price)
                new_total_cost = total + fees
                new_qty = existing["quantity"] + quantity
                new_avg = (old_total_cost + new_total_cost) / new_qty if new_qty > 0 else None
                await db.execute(
                    """UPDATE holdings SET quantity = ?, avg_cost = ?,
                       updated_at = datetime('now') WHERE user_id = ? AND ticker = ?""",
                    (new_qty, round(new_avg, 4) if new_avg else None, user_id, ticker.upper()),
                )
            elif transaction_type == "sell":
                new_qty = existing["quantity"] - quantity
                if new_qty <= 0:
                    await db.execute(
                        "DELETE FROM holdings WHERE user_id = ? AND ticker = ?",
                        (user_id, ticker.upper()),
                    )
                else:
                    await db.execute(
                        """UPDATE holdings SET quantity = ?,
                           updated_at = datetime('now') WHERE user_id = ? AND ticker = ?""",
                        (new_qty, user_id, ticker.upper()),
                    )
        elif transaction_type == "buy":
            # New position from a buy
            await db.execute(
                """INSERT INTO holdings (user_id, ticker, quantity, avg_cost, asset_type)
                   VALUES (?, ?, ?, ?, 'stock')""",
                (user_id, ticker.upper(), quantity, price + (fees / quantity) if quantity else price),
            )

        await db.commit()
        return {
            "id": tx_id,
            "ticker": ticker.upper(),
            "transaction_type": transaction_type,
            "quantity": quantity,
            "price": price,
            "total_amount": total,
            "fees": fees,
            "date": date,
            "notes": notes,
        }
    finally:
        await db.close()


async def delete_transaction(user_id: int, tx_id: int) -> bool:
    """Delete a transaction and rebuild the affected holding from remaining txns."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM transactions WHERE id = ? AND user_id = ?", (tx_id, user_id)
        )
        tx = await cursor.fetchone()
        if not tx:
            return False
        ticker = tx["ticker"]

        await db.execute("DELETE FROM transactions WHERE id = ?", (tx_id,))

        cursor = await db.execute(
            "SELECT * FROM transactions WHERE user_id = ? AND ticker = ? ORDER BY date ASC, id ASC",
            (user_id, ticker),
        )
        remaining = [dict(r) for r in await cursor.fetchall()]

        await db.execute(
            "DELETE FROM holdings WHERE user_id = ? AND ticker = ?", (user_id, ticker)
        )

        total_qty = 0.0
        total_cost = 0.0
        for t in remaining:
            if t["transaction_type"] == "buy":
                total_cost += t["total_amount"] + (t["fees"] or 0)
                total_qty += t["quantity"]
            elif t["transaction_type"] == "sell":
                if total_qty > 0:
                    avg = total_cost / total_qty
                    total_cost -= t["quantity"] * avg
                total_qty -= t["quantity"]

        if total_qty > 0.001:
            avg_cost = round(total_cost / total_qty, 4) if total_cost > 0 else None
            await db.execute(
                "INSERT INTO holdings (user_id, ticker, quantity, avg_cost, asset_type) VALUES (?, ?, ?, ?, 'stock')",
                (user_id, ticker, total_qty, avg_cost),
            )

        await db.commit()
        return True
    finally:
        await db.close()


# ── Portfolio Context Builder ─────────────────────────────────────────────────

# A Yahoo Finance batch fetch takes seconds, and every dashboard/portfolio
# request used to trigger one. Quotes barely move intra-minute, so memoize the
# last successful fetch per ticker set for a short window. Failures are never
# cached (an empty result would otherwise linger).
_PRICE_CACHE_TTL_SECONDS = 30.0
_price_cache: dict[str, tuple[float, dict[str, dict]]] = {}


async def get_current_prices(tickers: list[str]) -> dict[str, dict]:
    """Fetch current market prices from Yahoo Finance (TTL-cached).

    Returns a dict mapping ticker → {price, previous_close}.
    Returns an empty dict if no data is available.
    """
    if not tickers:
        return {}
    unique = list(dict.fromkeys(t.upper() for t in tickers if t))
    if not unique:
        return {}

    cache_key = ",".join(sorted(unique))
    cached = _price_cache.get(cache_key)
    if cached and time.monotonic() - cached[0] < _PRICE_CACHE_TTL_SECONDS:
        return cached[1]

    prices: dict[str, dict] = {}
    try:
        # Use yfinance Tickers for batch fetching
        tickers_obj = yf.Tickers(" ".join(unique))
        for ticker in unique:
            try:
                t = tickers_obj.tickers.get(ticker)
                if t is None:
                    continue
                info = t.fast_info
                price = (
                    info.get("lastPrice")
                    or info.get("regularMarketPreviousClose")
                    or info.get("previousClose")
                )
                prev = info.get("previousClose") or price
                if price:
                    prices[ticker] = {
                        "price": round(float(price), 2),
                        "previous_close": round(float(prev), 2),
                    }
            except Exception:
                logger.debug("Failed to fetch price for %s", ticker, exc_info=True)
    except Exception:
        logger.warning("Yahoo Finance batch fetch failed", exc_info=True)

    if prices:
        _price_cache[cache_key] = (time.monotonic(), prices)
    return prices


async def build_portfolio_context(user_id: int) -> str:
    """Build a markdown summary of the user's portfolio for agent prompts.

    Holdings are valued at the latest Yahoo Finance price (falling back to
    avg cost when a quote is unavailable), so the agent sees real weights and
    unrealized P&L rather than cost-basis proxies.

    Returns an empty string if no holdings or cash are recorded.
    """
    holdings = await get_all_holdings(user_id)
    cash = await get_latest_cash(user_id)

    if not holdings and cash == 0:
        return ""

    # Snapshot date: the context reflects the CURRENT book even when the
    # analysis date is historical — the agent manages the live portfolio.
    today = datetime.now().strftime("%Y-%m-%d")

    prices = await get_current_prices([h["ticker"] for h in holdings])

    lines = [f"- **Portfolio snapshot**: {today} (cash + holdings at market price)"]
    lines.append(f"- **Cash Available**: ${cash:,.2f}")

    # Total portfolio value at market prices; missing quotes fall back to cost.
    valued = []
    total_value = cash
    for h in holdings:
        quote = prices.get(h["ticker"].upper(), {})
        price = quote.get("price")
        qty = h["quantity"]
        value = qty * (price if price else (h["avg_cost"] or 0))
        total_value += value
        valued.append((h, price, value))

    lines.append(f"- **Total Portfolio Value**: ${total_value:,.2f}")

    if valued:
        lines.append("\n### Current Holdings (market value)")
        lines.append("| Ticker | Shares | Last Price | Avg Cost | Value | Unrealized | Weight |")
        lines.append("|--------|--------|-----------|----------|-------|------------|--------|")
        for h, price, value in valued:
            weight_pct = (value / total_value * 100) if total_value > 0 else 0
            cost = h["avg_cost"] or 0
            if price:
                unrealized = f"{((price / cost) - 1) * 100:.1f}%" if cost else "—"
                price_txt = f"${price:,.2f}"
            else:
                unrealized = "n/a (valued at cost)"
                price_txt = "n/a"
            lines.append(
                f"| {h['ticker']} | {h['quantity']:,.2f} | {price_txt} | "
                f"${cost:,.2f} | ${value:,.2f} | {unrealized} | {weight_pct:.1f}% |"
            )

    # Recent transactions context
    recent_txs = await get_transactions(user_id, limit=5)
    if recent_txs:
        lines.append("\n### Recent Transactions")
        for tx in recent_txs:
            direction = "Bought" if tx["transaction_type"] == "buy" else "Sold"
            lines.append(
                f"- {tx['date']}: {direction} {tx['quantity']:,.2f} {tx['ticker']} "
                f"@ ${tx['price']:,.2f}"
            )

    return "\n".join(lines)
