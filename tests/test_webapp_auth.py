"""Webapp auth tests: OIDC gating + WEBAPP_DEV_AUTOLOGIN fallback.

These exercise the real FastAPI app (routers, session middleware, lifespan)
against a throwaway SQLite file.
"""

from __future__ import annotations

import asyncio
import time

import pytest
from fastapi.testclient import TestClient

import webapp.auth as auth_module
import webapp.database as db

pytestmark = pytest.mark.unit


@pytest.fixture()
def app(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_DIR", tmp_path)
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "trading.db")
    from webapp.main import app as fastapi_app

    return fastapi_app


def test_oidc_missing_login_returns_501(app, monkeypatch):
    monkeypatch.setattr(auth_module, "is_configured", lambda: False)
    monkeypatch.delenv("WEBAPP_DEV_AUTOLOGIN", raising=False)
    with TestClient(app) as client:
        resp = client.get("/auth/me")
        assert resp.status_code == 401
        assert client.get("/auth/login").status_code == 501


def test_dev_autologin_provisions_local_user(app, monkeypatch):
    monkeypatch.setattr(auth_module, "is_configured", lambda: False)
    monkeypatch.setenv("WEBAPP_DEV_AUTOLOGIN", "1")
    with TestClient(app) as client:
        resp = client.get("/auth/me")
        assert resp.status_code == 200
        body = resp.json()
        assert body["sub"] == "webapp-dev-local"
        assert body["display_name"] == "Local Dev"
        # The dev user is initialized through the same API routes as anyone else.
        assert client.get("/api/analysis/history").status_code == 200


def test_dev_autologin_disabled_when_oidc_configured(app, monkeypatch):
    monkeypatch.setattr(auth_module, "is_configured", lambda: True)
    monkeypatch.setenv("WEBAPP_DEV_AUTOLOGIN", "1")
    with TestClient(app) as client:
        # Even with the env var set, an unauthenticated request is rejected once
        # OIDC is configured — the fallback must never bypass real auth.
        assert client.get("/auth/me").status_code == 401


def test_login_challenge_reused_while_pending(monkeypatch):
    """Duplicate /auth/login hits share one state + PKCE verifier.

    The SPA probes /auth/login on load and the user then clicks "Sign in"; if
    each hit regenerated the challenge, the later one would overwrite the pair
    the Authentik round-trip is using and the callback would 400 with an
    invalid state. A pending (unexpired) challenge must therefore be reused.
    """

    async def fake_discovery() -> dict:
        return {"authorization_endpoint": "https://idp.example/oauth/authorize"}

    monkeypatch.setattr(auth_module, "_fetch_discovery", fake_discovery)

    session: dict = {}
    url1, state1 = asyncio.run(auth_module.start_login(session))
    assert state1
    assert url1.startswith("https://idp.example/oauth/authorize")

    # A second /auth/login within the TTL reuses the same challenge.
    url2, state2 = asyncio.run(auth_module.start_login(session))
    assert state2 == state1
    assert url2 == url1

    # Once the challenge has expired, the next login gets a fresh one.
    session["oidc_pending_at"] = time.time() - auth_module._PENDING_TTL_SECONDS - 1
    _, state3 = asyncio.run(auth_module.start_login(session))
    assert state3 != state1
