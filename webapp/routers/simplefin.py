"""
SimpleFIN API routes — connection setup, account selection, and sync.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..models import (
    SimpleFINAccountListResponse,
    SimpleFINConnectRequest,
    SimpleFINLinkRequest,
    SimpleFINSyncResponse,
    SimpleFINStatusResponse,
    StatusResponse,
)
from ..routers.auth import get_current_user
from ..services import simplefin_service as sfin

router = APIRouter(
    prefix="/api/simplefin",
    tags=["simplefin"],
    dependencies=[Depends(get_current_user)],
)


# ── Connection ────────────────────────────────────────────────────────────────

@router.post("/connect", response_model=SimpleFINAccountListResponse)
async def connect(body: SimpleFINConnectRequest, user: dict = Depends(get_current_user)):
    """Claim a SimpleFIN Token and return the list of available accounts."""
    # 1. Claim the token → Access URL
    try:
        access_url = await sfin.claim_token(body.token)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to claim token: {exc}")

    # 2. Store encrypted Access URL
    await sfin.store_access_url(user["id"], access_url)

    # 3. Fetch available accounts
    try:
        accounts = await sfin.fetch_accounts(access_url)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch accounts: {exc}")

    if not accounts:
        raise HTTPException(
            status_code=404,
            detail="No accounts found. Make sure your SimpleFIN token has connected institutions.",
        )

    return SimpleFINAccountListResponse(
        accounts=[
            {
                "account_id": a["account_id"],
                "name": a["name"],
                "currency": a["currency"],
                "org_name": a.get("org_name", ""),
                "org_domain": a.get("org_domain", ""),
            }
            for a in accounts
        ]
    )


# ── Link account ──────────────────────────────────────────────────────────────

@router.post("/link", response_model=StatusResponse)
async def link_account(
    body: SimpleFINLinkRequest, user: dict = Depends(get_current_user)
):
    """Select which SimpleFIN account to monitor."""
    # Verify connection exists
    access_url = await sfin.get_access_url(user["id"])
    if not access_url:
        raise HTTPException(status_code=400, detail="Connect to SimpleFIN first.")

    await sfin.link_account(
        user["id"],
        body.account_id,
        body.account_name,
        body.org_name,
        body.org_domain,
    )
    return StatusResponse(
        status="ok",
        message=f"Linked to {body.account_name} — ready to sync.",
    )


# ── Sync ──────────────────────────────────────────────────────────────────────

@router.post("/sync", response_model=SimpleFINSyncResponse)
async def sync(user: dict = Depends(get_current_user)):
    """Pull latest portfolio data from SimpleFIN (manual trigger)."""
    try:
        result = await sfin.sync_portfolio(user["id"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Sync failed: {exc}")

    return SimpleFINSyncResponse(
        status="ok",
        holdings_synced=result["holdings_synced"],
        transactions_synced=result["transactions_synced"],
        cash_balance=result["cash_balance"],
        last_synced_at=result["last_synced_at"],
    )


# ── Status ────────────────────────────────────────────────────────────────────

@router.get("/status", response_model=SimpleFINStatusResponse)
async def get_status(user: dict = Depends(get_current_user)):
    """Get current SimpleFIN connection and link status."""
    status = await sfin.get_connection_status(user["id"])
    return SimpleFINStatusResponse(**status)


# ── Disconnect ────────────────────────────────────────────────────────────────

@router.delete("/disconnect", response_model=StatusResponse)
async def disconnect(user: dict = Depends(get_current_user)):
    """Remove SimpleFIN connection and linked account."""
    deleted = await sfin.delete_connection(user["id"])
    if not deleted:
        raise HTTPException(status_code=404, detail="No SimpleFIN connection found.")
    return StatusResponse(status="ok", message="SimpleFIN connection removed.")
