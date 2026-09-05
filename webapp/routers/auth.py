"""
Auth routes — OIDC login, callback, user info, logout.
"""

from __future__ import annotations

import logging
import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

from ..auth import (
    exchange_code,
    is_configured,
    resolve_login,
    start_login,
)
from ..services.user_service import get_user_by_sub, upsert_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# Fixed identity for local development when OIDC is not configured (no
# Authentik/IdP to log in against). Never enabled while OIDC is configured.
_DEV_SUB = "webapp-dev-local"
_DEV_EMAIL = "dev@local"


def dev_autologin_enabled() -> bool:
    """Whether the dev-only autologin fallback is on.

    Set ``WEBAPP_DEV_AUTOLOGIN=1`` in ``.env`` AND leave the OIDC_* vars unset
    to run the app without an identity provider (local development only).
    The fallback is ignored whenever OIDC is configured.
    """
    from ..auth import is_configured

    return os.environ.get("WEBAPP_DEV_AUTOLOGIN") == "1" and not is_configured()


# ── Auth dependency (also imported by other modules) ──────────────────────────

async def _session_user(request: Request) -> dict | None:
    """Return the session's user row, auto-provisioning the dev user in dev mode."""
    user = request.session.get("user")
    if user:
        db_user = await get_user_by_sub(user["sub"])
        if db_user:
            return db_user
        request.session.clear()  # Session references a deleted user

    if dev_autologin_enabled():
        db_user = await upsert_user(_DEV_SUB, email=_DEV_EMAIL, name="Local Dev")
        request.session["user"] = {
            "sub": _DEV_SUB,
            "user_id": db_user["id"],
            "email": _DEV_EMAIL,
            "name": "Local Dev",
        }
        return db_user
    return None


async def get_current_user(request: Request) -> dict:
    """FastAPI dependency: return the current user from session, or 401.

    Usage:
        @router.get("/something")
        async def something(user: dict = Depends(get_current_user)):
            ...
    """
    db_user = await _session_user(request)
    if not db_user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return db_user


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/login")
async def login():
    """Redirect to the OIDC provider for authentication."""
    if not is_configured():
        raise HTTPException(status_code=501, detail="OIDC is not configured")

    # Challenges are registered server-side (auth.start_login), so racing
    # duplicate /auth/login hits — SPA probe + navigation — can't overwrite
    # each other's state in a cookie mid-flight.
    auth_url, _ = await start_login()

    return RedirectResponse(url=auth_url, status_code=302)


@router.get("/callback")
async def callback(request: Request, code: str = "", state: str = ""):
    """Handle the OIDC callback, exchange code, and create a session."""
    if not is_configured():
        raise HTTPException(status_code=501, detail="OIDC is not configured")

    # The state must match a challenge this server handed out (server-side
    # store, not the session cookie — see auth.start_login). A stale or
    # replayed callback bounces back to the app instead of showing raw JSON.
    code_verifier = await resolve_login(state)
    if not code_verifier:
        logger.warning("OIDC callback rejected: unknown or expired state (query=%r)", state)
        return RedirectResponse(url="/", status_code=302)

    # Exchange code for tokens
    try:
        claims = await exchange_code(code, code_verifier)
    except Exception as e:
        logger.exception("Token exchange failed")
        raise HTTPException(status_code=400, detail=f"Authentication failed: {e}") from e

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
    db_user = await _session_user(request)
    if not db_user:
        raise HTTPException(status_code=401, detail="Not authenticated")
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
