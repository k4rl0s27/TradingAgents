"""
TradingAgents Webapp — FastAPI application with MD3 frontend.
"""

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from starlette.middleware.sessions import SessionMiddleware

from .database import init_db
from .routers import portfolio, analysis, auth, settings

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
app.include_router(portfolio.router)
app.include_router(analysis.router)

# Static files (frontend)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
async def index():
    """Serve the main SPA."""
    return FileResponse(str(STATIC_DIR / "index.html"))


@app.get("/api/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "version": "0.4.0"}
