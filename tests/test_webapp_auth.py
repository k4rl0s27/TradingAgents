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


def test_login_challenge_resolved_server_side(monkeypatch):
    """Each /auth/login gets its own challenge; the callback resolves it.

    The SPA probes /auth/login and auto-redirects to it in quick succession,
    so two concurrent requests must not clobber each other — challenges are
    stored server-side keyed by state, and only the state Authentik honors
    can complete. Unknown, replayed or expired states resolve to None.
    """

    async def fake_discovery() -> dict:
        return {"authorization_endpoint": "https://idp.example/oauth/authorize"}

    monkeypatch.setattr(auth_module, "_fetch_discovery", fake_discovery)

    # Two racing /auth/login calls: both succeed with their own states.
    url1, state1 = asyncio.run(auth_module.start_login())
    url2, state2 = asyncio.run(auth_module.start_login())
    assert state1 != state2
    assert url1.startswith("https://idp.example/oauth/authorize")

    # The callback for either one resolves to the matching verifier.
    verifier1 = asyncio.run(auth_module.resolve_login(state1))
    assert verifier1
    assert asyncio.run(auth_module.resolve_login(state2))

    # A state can complete only once (no replay).
    assert asyncio.run(auth_module.resolve_login(state1)) is None
    # Unknown states are rejected.
    assert asyncio.run(auth_module.resolve_login("bogus-state")) is None

    # Expired challenges are rejected.
    _, state3 = asyncio.run(auth_module.start_login())
    entry = auth_module._pending_login[state3]
    auth_module._pending_login[state3] = (entry[0], time.time() - 1)
    assert asyncio.run(auth_module.resolve_login(state3)) is None
