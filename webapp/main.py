"""
TradingAgents Webapp — FastAPI application serving the React SPA (shadcn/ui).

The SPA is built by the Vite project in ``webapp/ui`` into ``webapp/static``
(``npm run build``), which this app serves at the root. ``/api`` and ``/auth``
routes are registered before the static catch-all and therefore win.
"""

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from starlette.middleware.sessions import SessionMiddleware

from .database import init_db
from .routers import analysis, auth, portfolio, settings, simplefin

logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).resolve().parent / "static"

# Session secret key — must be set in .env for production
_SECRET_KEY = os.environ.get("SECRET_KEY", "")
if not _SECRET_KEY:
    logger.warning("SECRET_KEY not set — sessions will use an ephemeral key (not suitable for production)")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle."""
    logger.info("Initializing database...")
    await init_db()
    logger.info("Database ready.")
    yield


app = FastAPI(
    title="TradingAgents Portfolio",
    description="Multi-agent trading analysis with portfolio-aware agents",
    version="0.4.0",
    lifespan=lifespan,
)

# Session middleware (cookie-based, required for OIDC auth)
app.add_middleware(
    SessionMiddleware,
    secret_key=_SECRET_KEY or "tradingagents-dev-ephmeral-key-change-me",
    session_cookie="tradingagents_session",
    max_age=86400,  # 24 hours
    same_site="lax",
    https_only=False,  # Set True behind a TLS-terminating proxy
)

# API routes
app.include_router(auth.router)
app.include_router(settings.router)
app.include_router(simplefin.router)
app.include_router(portfolio.router)
app.include_router(analysis.router)


@app.get("/api/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "version": "0.4.0"}


# ── SPA / static serving ──────────────────────────────────────────────────────

def _static_file(relative: str) -> Path | None:
    """Resolve a path inside STATIC_DIR, or None on any traversal attempt."""
    candidate = (STATIC_DIR / relative).resolve()
    if candidate == STATIC_DIR:
        return STATIC_DIR / "index.html"  # "/" -> the app shell
    try:
        candidate.relative_to(STATIC_DIR)
    except ValueError:
        return None
    return candidate if candidate.is_file() else None


@app.get("/manifest.webmanifest", include_in_schema=False)
async def manifest():
    """PWA manifest (must be served with the manifest MIME type)."""
    file = _static_file("manifest.webmanifest")
    if not file:
        raise HTTPException(status_code=404)
    return FileResponse(file, media_type="application/manifest+json")


@app.get("/{full_path:path}", include_in_schema=False)
async def spa(full_path: str):
    """Serve the built SPA.

    Only reaches here when no /api or /auth route matched, so unknown API
    paths still 404 instead of returning the index page. Existing files are
    served as-is; extensionless paths (client-side routes) fall back to the
    app shell; missing files with an extension (broken asset references) 404.
    """
    if full_path.startswith(("api/", "auth/")):
        raise HTTPException(status_code=404)
    file = _static_file(full_path)
    if file is not None:
        return FileResponse(file)
    if Path(full_path).suffix:
        raise HTTPException(status_code=404)
    return FileResponse(STATIC_DIR / "index.html")
