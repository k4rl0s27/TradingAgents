"""
Portfolio API routes — holdings, transactions, cash balance.
"""

from fastapi import APIRouter, HTTPException

from ..models import (
    CashBalanceCreate,
    CashBalanceResponse,
    HoldingCreate,
    HoldingUpdate,
    PortfolioSummary,
    TransactionCreate,
    TransactionResponse,
    StatusResponse,
)
from ..services import portfolio_service as svc

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


# ── Cash ──────────────────────────────────────────────────────────────────────

@router.get("/cash", response_model=list[CashBalanceResponse])
async def get_cash_history():
    """Get cash balance history."""
    return await svc.get_cash_history()


@router.post("/cash", response_model=StatusResponse)
async def set_cash(body: CashBalanceCreate):
    """Set current cash balance."""
    await svc.set_cash(body.amount, body.date, body.notes)
    return StatusResponse(status="ok", message=f"Cash balance set to ${body.amount:,.2f}")


# ── Holdings ──────────────────────────────────────────────────────────────────

@router.get("/holdings")
async def get_holdings():
    """Get all current holdings."""
    return await svc.get_all_holdings()


@router.post("/holdings", response_model=StatusResponse)
async def add_holding(body: HoldingCreate):
    """Add or update a holding."""
    await svc.upsert_holding(
        ticker=body.ticker,
        quantity=body.quantity,
        avg_cost=body.avg_cost,
        asset_type=body.asset_type,
        sector=body.sector,
    )
    return StatusResponse(
        status="ok",
        message=f"Holding {body.ticker.upper()} updated: {body.quantity:,.2f} shares",
    )


@router.put("/holdings/{holding_id}", response_model=StatusResponse)
async def update_holding(holding_id: int, body: HoldingUpdate):
    """Update an existing holding."""
    existing = await svc.get_holding(body.ticker or "")
    if not existing and not body.ticker:
        raise HTTPException(status_code=404, detail="Holding not found")
    ticker = body.ticker or existing["ticker"]
    await svc.upsert_holding(
        ticker=ticker,
        quantity=body.quantity if body.quantity is not None else existing["quantity"],
        avg_cost=body.avg_cost if body.avg_cost is not None else existing.get("avg_cost"),
        asset_type=body.asset_type or existing.get("asset_type", "stock"),
        sector=body.sector if body.sector is not None else existing.get("sector"),
    )
    return StatusResponse(status="ok", message=f"Holding {ticker} updated")


@router.delete("/holdings/{holding_id}", response_model=StatusResponse)
async def remove_holding(holding_id: int):
    """Remove a holding."""
    deleted = await svc.delete_holding(holding_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Holding not found")
    return StatusResponse(status="ok", message="Holding removed")


# ── Transactions ──────────────────────────────────────────────────────────────

@router.get("/transactions", response_model=list[TransactionResponse])
async def get_transactions():
    """Get recent transactions."""
    return await svc.get_transactions()


@router.post("/transactions", response_model=StatusResponse)
async def record_transaction(body: TransactionCreate):
    """Record a buy/sell transaction and auto-update the holding."""
    await svc.record_transaction(
        ticker=body.ticker,
        transaction_type=body.transaction_type,
        quantity=body.quantity,
        price=body.price,
        fees=body.fees,
        date=body.date,
        notes=body.notes,
    )
    direction = "Bought" if body.transaction_type == "buy" else "Sold"
    return StatusResponse(
        status="ok",
        message=f"{direction} {body.quantity:,.2f} {body.ticker.upper()} @ ${body.price:,.2f}",
    )


@router.delete("/transactions/{tx_id}", response_model=StatusResponse)
async def remove_transaction(tx_id: int):
    """Delete a transaction and rebuild the affected holding."""
    deleted = await svc.delete_transaction(tx_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return StatusResponse(status="ok", message="Transaction deleted — holding recalculated")


# ── Summary ───────────────────────────────────────────────────────────────────

@router.get("/summary")
async def get_portfolio_summary():
    """Get full portfolio summary."""
    from ..services.portfolio_service import build_portfolio_context
    holdings = await svc.get_all_holdings()
    cash = await svc.get_latest_cash()
    transactions = await svc.get_transactions(limit=10)
    cash_history = await svc.get_cash_history(limit=5)
    context_text = await build_portfolio_context()

    holdings_value = sum(
        h["quantity"] * (h["avg_cost"] or 0) for h in holdings
    )

    return {
        "cash": cash,
        "holdings_value": round(holdings_value, 2),
        "total_value": round(cash + holdings_value, 2),
        "holdings": holdings,
        "recent_transactions": transactions,
        "cash_history": cash_history,
        "context_for_agents": context_text,
    }
