"""Webapp auth tests: OIDC gating + WEBAPP_DEV_AUTOLOGIN fallback.

These exercise the real FastAPI app (routers, session middleware, lifespan)
against a throwaway SQLite file.
"""

from __future__ import annotations

import asyncio

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
