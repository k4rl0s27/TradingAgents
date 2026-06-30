"""
Portfolio API routes — holdings, transactions, cash balance.
"""

from fastapi import APIRouter, HTTPException, Depends

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
from ..routers.auth import get_current_user
from ..services import portfolio_service as svc

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"], dependencies=[Depends(get_current_user)])


# ── Cash ──────────────────────────────────────────────────────────────────────

@router.get("/cash", response_model=list[CashBalanceResponse])
async def get_cash_history(user: dict = Depends(get_current_user)):
    """Get cash balance history."""
    return await svc.get_cash_history(user["id"])


@router.post("/cash", response_model=StatusResponse)
async def set_cash(body: CashBalanceCreate, user: dict = Depends(get_current_user)):
    """Set current cash balance."""
    await svc.set_cash(user["id"], body.amount, body.date, body.notes)
    return StatusResponse(status="ok", message=f"Cash balance set to ${body.amount:,.2f}")


@router.delete("/cash/{cash_id}", response_model=StatusResponse)
async def delete_cash(cash_id: int, user: dict = Depends(get_current_user)):
    """Delete a cash balance entry."""
    deleted = await svc.delete_cash(user["id"], cash_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Cash entry not found")
    return StatusResponse(status="ok", message="Cash entry deleted")


# ── Holdings ──────────────────────────────────────────────────────────────────

@router.get("/holdings")
async def get_holdings(user: dict = Depends(get_current_user)):
    """Get all current holdings."""
    return await svc.get_all_holdings(user["id"])


@router.post("/holdings", response_model=StatusResponse)
async def add_holding(body: HoldingCreate, user: dict = Depends(get_current_user)):
    """Add or update a holding."""
    await svc.upsert_holding(
        user_id=user["id"],
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
async def update_holding(holding_id: int, body: HoldingUpdate, user: dict = Depends(get_current_user)):
    """Update an existing holding."""
    existing = await svc.get_holding(user["id"], body.ticker or "")
    if not existing and not body.ticker:
        raise HTTPException(status_code=404, detail="Holding not found")
    ticker = body.ticker or existing["ticker"]
    await svc.upsert_holding(
        user_id=user["id"],
        ticker=ticker,
        quantity=body.quantity if body.quantity is not None else existing["quantity"],
        avg_cost=body.avg_cost if body.avg_cost is not None else existing.get("avg_cost"),
        asset_type=body.asset_type or existing.get("asset_type", "stock"),
        sector=body.sector if body.sector is not None else existing.get("sector"),
    )
    return StatusResponse(status="ok", message=f"Holding {ticker} updated")


@router.delete("/holdings/{holding_id}", response_model=StatusResponse)
async def remove_holding(holding_id: int, user: dict = Depends(get_current_user)):
    """Remove a holding."""
    deleted = await svc.delete_holding(user["id"], holding_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Holding not found")
    return StatusResponse(status="ok", message="Holding removed")


# ── Transactions ──────────────────────────────────────────────────────────────

@router.get("/transactions", response_model=list[TransactionResponse])
async def get_transactions(user: dict = Depends(get_current_user)):
    """Get recent transactions."""
    return await svc.get_transactions(user["id"])


@router.post("/transactions", response_model=StatusResponse)
async def record_transaction(body: TransactionCreate, user: dict = Depends(get_current_user)):
    """Record a buy/sell transaction and auto-update the holding."""
    await svc.record_transaction(
        user_id=user["id"],
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
async def remove_transaction(tx_id: int, user: dict = Depends(get_current_user)):
    """Delete a transaction and rebuild the affected holding."""
    deleted = await svc.delete_transaction(user["id"], tx_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return StatusResponse(status="ok", message="Transaction deleted — holding recalculated")


# ── Summary ───────────────────────────────────────────────────────────────────

@router.get("/summary")
async def get_portfolio_summary(user: dict = Depends(get_current_user)):
    """Get full portfolio summary."""
    from ..services.portfolio_service import build_portfolio_context
    uid = user["id"]
    holdings = await svc.get_all_holdings(uid)
    cash = await svc.get_latest_cash(uid)
    transactions = await svc.get_transactions(uid, limit=10)
    cash_history = await svc.get_cash_history(uid, limit=5)
    context_text = await build_portfolio_context(uid)

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
