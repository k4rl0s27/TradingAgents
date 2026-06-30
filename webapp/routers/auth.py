"""
Auth routes — OIDC login, callback, user info, logout.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

from ..auth import (
    exchange_code,
    get_authorization_url_simple,
    is_configured,
)
from ..services.user_service import upsert_user, get_user_by_sub

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


# ── Auth dependency (also imported by other modules) ──────────────────────────

async def get_current_user(request: Request) -> dict:
    """FastAPI dependency: return the current user from session, or 401.

    Usage:
        @router.get("/something")
        async def something(user: dict = Depends(get_current_user)):
            ...
    """
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    # Refresh from DB to get latest is_initialized state
    db_user = await get_user_by_sub(user["sub"])
    if not db_user:
        request.session.clear()
        raise HTTPException(status_code=401, detail="User not found")
    return db_user


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/login")
async def login(request: Request):
    """Redirect to the OIDC provider for authentication."""
    if not is_configured():
        raise HTTPException(status_code=501, detail="OIDC is not configured")

    auth_url, code_verifier, state = await get_authorization_url_simple()

    # Stash PKCE verifier + state in session
    request.session["oidc_code_verifier"] = code_verifier
    request.session["oidc_state"] = state

    return RedirectResponse(url=auth_url, status_code=302)


@router.get("/callback")
async def callback(request: Request, code: str = "", state: str = ""):
    """Handle the OIDC callback, exchange code, and create a session."""
    if not is_configured():
        raise HTTPException(status_code=501, detail="OIDC is not configured")

    # Verify state to prevent CSRF
    expected_state = request.session.pop("oidc_state", None)
    if not expected_state or expected_state != state:
        raise HTTPException(status_code=400, detail="Invalid state parameter")

    code_verifier = request.session.pop("oidc_code_verifier", None)
    if not code_verifier:
        raise HTTPException(status_code=400, detail="Missing PKCE verifier")

    # Exchange code for tokens
    try:
        claims = await exchange_code(code, code_verifier)
    except Exception as e:
        logger.exception("Token exchange failed")
        raise HTTPException(status_code=400, detail=f"Authentication failed: {e}")

    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status_code=400, detail="Missing sub claim in id_token")

    email = claims.get("email")
    name = claims.get("name") or claims.get("preferred_username") or email

    # Auto-provision user
    user = await upsert_user(sub, email=email, name=name)

    # Store minimal user info in session
    request.session["user"] = {
        "sub": sub,
        "user_id": user["id"],
        "email": email,
        "name": name,
    }

    logger.info("User %s (id=%d) logged in, initialized=%s", sub, user["id"], user["is_initialized"])

    # Redirect to app
    return RedirectResponse(url="/", status_code=302)


@router.get("/me")
async def me(request: Request):
    """Return the current authenticated user's info."""
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    db_user = await get_user_by_sub(user["sub"])
    if not db_user:
        request.session.clear()
        raise HTTPException(status_code=401, detail="User not found")
    return {
        "id": db_user["id"],
        "sub": db_user["oidc_sub"],
        "email": db_user["email"],
        "display_name": db_user["display_name"],
        "is_initialized": bool(db_user["is_initialized"]),
    }


@router.post("/logout")
async def logout(request: Request):
    """Clear the session."""
    request.session.clear()
    return {"status": "ok", "message": "Logged out"}
