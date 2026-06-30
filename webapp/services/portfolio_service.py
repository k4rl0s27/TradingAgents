"""
Portfolio business logic — CRUD for holdings, transactions, cash balance.
Also builds the portfolio_context string injected into agent prompts.
"""

from __future__ import annotations

from typing import Optional

from ..database import get_db


# ── Cash Balance ──────────────────────────────────────────────────────────────

async def get_latest_cash() -> float:
    """Get the most recent cash balance, or 0 if none set."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT amount FROM cash_balance ORDER BY created_at DESC LIMIT 1"
        )
        row = await cursor.fetchone()
        return row["amount"] if row else 0.0
    finally:
        await db.close()


async def set_cash(amount: float, date: str, notes: Optional[str] = None) -> dict:
    """Record a new cash balance."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "INSERT INTO cash_balance (amount, date, notes) VALUES (?, ?, ?)",
            (amount, date, notes),
        )
        await db.commit()
        return {"id": cursor.lastrowid, "amount": amount, "date": date, "notes": notes}
    finally:
        await db.close()


async def get_cash_history(limit: int = 20) -> list[dict]:
    """Get cash balance history, most recent first."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM cash_balance ORDER BY created_at DESC LIMIT ?", (limit,)
        )
        return [dict(row) for row in await cursor.fetchall()]
    finally:
        await db.close()


async def delete_cash(cash_id: int) -> bool:
    """Delete a cash balance entry by ID. Returns True if deleted."""
    db = await get_db()
    try:
        cursor = await db.execute("DELETE FROM cash_balance WHERE id = ?", (cash_id,))
        await db.commit()
        return cursor.rowcount > 0
    finally:
        await db.close()


# ── Holdings ──────────────────────────────────────────────────────────────────

async def get_all_holdings() -> list[dict]:
    """Get all current holdings."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM holdings ORDER BY ticker ASC"
        )
        return [dict(row) for row in await cursor.fetchall()]
    finally:
        await db.close()


async def get_holding(ticker: str) -> Optional[dict]:
    """Get a single holding by ticker."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM holdings WHERE ticker = ?", (ticker.upper(),)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def upsert_holding(
    ticker: str,
    quantity: float,
    avg_cost: Optional[float] = None,
    asset_type: str = "stock",
    sector: Optional[str] = None,
) -> dict:
    """Add or update a holding. Uses ticker as unique key."""
    db = await get_db()
    try:
        existing = await db.execute(
            "SELECT id FROM holdings WHERE ticker = ?", (ticker.upper(),)
        )
        row = await existing.fetchone()
        if row:
            await db.execute(
                """UPDATE holdings
                   SET quantity = ?, avg_cost = ?, asset_type = ?, sector = ?,
                       updated_at = datetime('now')
                   WHERE ticker = ?""",
                (quantity, avg_cost, asset_type, sector, ticker.upper()),
            )
        else:
            await db.execute(
                """INSERT INTO holdings (ticker, quantity, avg_cost, asset_type, sector)
                   VALUES (?, ?, ?, ?, ?)""",
                (ticker.upper(), quantity, avg_cost, asset_type, sector),
            )
        await db.commit()
        return await get_holding(ticker.upper())
    finally:
        await db.close()


async def delete_holding(holding_id: int) -> bool:
    """Delete a holding by ID. Returns True if deleted."""
    db = await get_db()
    try:
        cursor = await db.execute("DELETE FROM holdings WHERE id = ?", (holding_id,))
        await db.commit()
        return cursor.rowcount > 0
    finally:
        await db.close()


# ── Transactions ──────────────────────────────────────────────────────────────

async def get_transactions(limit: int = 50) -> list[dict]:
    """Get recent transactions, most recent first."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM transactions ORDER BY date DESC, created_at DESC LIMIT ?",
            (limit,),
        )
        return [dict(row) for row in await cursor.fetchall()]
    finally:
        await db.close()


async def record_transaction(
    ticker: str,
    transaction_type: str,
    quantity: float,
    price: float,
    fees: float = 0,
    date: str = "",
    notes: Optional[str] = None,
) -> dict:
    """Record a buy/sell transaction and automatically update the holding."""
    total = quantity * price
    db = await get_db()
    try:
        # Record the transaction
        cursor = await db.execute(
            """INSERT INTO transactions (ticker, transaction_type, quantity, price,
               total_amount, fees, date, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (ticker.upper(), transaction_type, quantity, price, total, fees, date, notes),
        )
        tx_id = cursor.lastrowid

        # Update the holding automatically
        existing = await get_holding(ticker.upper())
        if existing:
            if transaction_type == "buy":
                # Weighted average cost basis
                old_total_cost = existing["quantity"] * (existing["avg_cost"] or price)
                new_total_cost = total + fees
                new_qty = existing["quantity"] + quantity
                new_avg = (old_total_cost + new_total_cost) / new_qty if new_qty > 0 else None
                await db.execute(
                    """UPDATE holdings SET quantity = ?, avg_cost = ?,
                       updated_at = datetime('now') WHERE ticker = ?""",
                    (new_qty, round(new_avg, 4) if new_avg else None, ticker.upper()),
                )
            elif transaction_type == "sell":
                new_qty = existing["quantity"] - quantity
                if new_qty <= 0:
                    await db.execute("DELETE FROM holdings WHERE ticker = ?", (ticker.upper(),))
                else:
                    await db.execute(
                        """UPDATE holdings SET quantity = ?,
                           updated_at = datetime('now') WHERE ticker = ?""",
                        (new_qty, ticker.upper()),
                    )
        elif transaction_type == "buy":
            # New position from a buy
            await db.execute(
                """INSERT INTO holdings (ticker, quantity, avg_cost, asset_type)
                   VALUES (?, ?, ?, 'stock')""",
                (ticker.upper(), quantity, price + (fees / quantity) if quantity else price),
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


async def delete_transaction(tx_id: int) -> bool:
    """Delete a transaction and rebuild the affected holding from remaining txns."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM transactions WHERE id = ?", (tx_id,))
        tx = await cursor.fetchone()
        if not tx:
            return False
        ticker = tx["ticker"]

        await db.execute("DELETE FROM transactions WHERE id = ?", (tx_id,))

        cursor = await db.execute(
            "SELECT * FROM transactions WHERE ticker = ? ORDER BY date ASC, id ASC",
            (ticker,),
        )
        remaining = [dict(r) for r in await cursor.fetchall()]

        await db.execute("DELETE FROM holdings WHERE ticker = ?", (ticker,))

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
                "INSERT INTO holdings (ticker, quantity, avg_cost, asset_type) VALUES (?, ?, ?, 'stock')",
                (ticker, total_qty, avg_cost),
            )

        await db.commit()
        return True
    finally:
        await db.close()


# ── Portfolio Context Builder ─────────────────────────────────────────────────

async def build_portfolio_context() -> str:
    """Build a markdown summary of the user's portfolio for agent prompts.

    Returns an empty string if no holdings or cash are recorded.
    """
    holdings = await get_all_holdings()
    cash = await get_latest_cash()

    if not holdings and cash == 0:
        return ""

    lines = ["## Your Current Portfolio"]

    # Cash position
    lines.append(f"- **Cash Available**: ${cash:,.2f}")

    # Calculate total portfolio value
    total_value = cash
    holding_summaries = []
    for h in holdings:
        # We use avg_cost as a proxy for current value since we don't have live prices here.
        # The agent will see real prices from the data tools.
        position_value = h["quantity"] * (h["avg_cost"] or 0)
        total_value += position_value
        if position_value > 0 or h["quantity"] > 0:
            holding_summaries.append((h, position_value))

    lines.append(f"- **Total Portfolio Value**: ${total_value:,.2f}")

    if holding_summaries:
        lines.append("\n### Current Holdings")
        lines.append("| Ticker | Shares | Avg Cost | Est. Value | Weight |")
        lines.append("|--------|--------|----------|------------|--------|")
        for h, val in holding_summaries:
            weight_pct = (val / total_value * 100) if total_value > 0 else 0
            lines.append(
                f"| {h['ticker']} | {h['quantity']:,.2f} | "
                f"${h['avg_cost']:,.2f} | ${val:,.2f} | {weight_pct:.1f}% |"
            )

        # Sector concentration warning
        sectors = {}
        for h, val in holding_summaries:
            sector = h.get("sector") or "Unknown"
            sectors[sector] = sectors.get(sector, 0) + val
        if sectors:
            lines.append("\n### Sector Exposure")
            for sector, val in sorted(sectors.items(), key=lambda x: x[1], reverse=True):
                pct = (val / total_value * 100) if total_value > 0 else 0
                lines.append(f"- {sector}: {pct:.1f}%")
                if pct > 30:
                    lines.append(f"  ⚠️ **Concentration Risk**: {sector} exceeds 30% of portfolio")

    # Recent transactions context
    recent_txs = await get_transactions(limit=5)
    if recent_txs:
        lines.append("\n### Recent Transactions")
        for tx in recent_txs:
            direction = "Bought" if tx["transaction_type"] == "buy" else "Sold"
            lines.append(
                f"- {tx['date']}: {direction} {tx['quantity']:,.2f} {tx['ticker']} "
                f"@ ${tx['price']:,.2f}"
            )

    return "\n".join(lines)
