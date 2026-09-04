"""Webapp portfolio context tests: market-price valuation of the prompt block."""

from __future__ import annotations

import asyncio

import pytest

import webapp.database as db
import webapp.services.portfolio_service as svc


pytestmark = pytest.mark.unit

# aiosqlite runs one worker thread per connection bound to the calling event
# loop; spinning a fresh loop per call races those threads on Windows. One
# shared loop keeps connections deterministic.
_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


@pytest.fixture()
def tmp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_DIR", tmp_path)
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "trading.db")
    asyncio.run(db.init_db())
    return tmp_path


@pytest.fixture()
def user_id(tmp_db):
    async def create():
        conn = await db.get_db()
        try:
            await conn.execute(
                "INSERT INTO users (oidc_sub, email) VALUES ('u1', 'a@b.c')"
            )
            await conn.commit()
            cur = await conn.execute("SELECT id FROM users")
            uid = (await cur.fetchone())[0]
            await svc.upsert_holding(uid, "AAPL", 10, avg_cost=100.0)
            await svc.set_cash(uid, 5000.0, "2026-01-01")
            return uid
        finally:
            await conn.close()

    return _run(create())


def test_context_values_holdings_at_market_price(tmp_db, user_id, monkeypatch):
    async def fake_prices(tickers):
        return {"AAPL": {"price": 110.0}}

    monkeypatch.setattr(svc, "get_current_prices", fake_prices)

    context = _run(svc.build_portfolio_context(user_id))
    assert "$6,100.00" in context  # 5000 cash + 10 * $110
    assert "18.0%" in context      # AAPL weight of the total
    assert "10.0%" in context      # unrealized P&L vs $100 avg cost
    assert "$110.00" in context    # the live price column


def test_context_falls_back_to_avg_cost_without_quote(tmp_db, user_id, monkeypatch):
    async def fake_prices(tickers):
        return {}

    monkeypatch.setattr(svc, "get_current_prices", fake_prices)

    context = _run(svc.build_portfolio_context(user_id))
    assert "$6,000.00" in context  # 5000 cash + 10 * $100 (cost fallback)
    assert "valued at cost" in context


def test_empty_portfolio_returns_empty_string(tmp_db, user_id):
    async def clear():
        conn = await db.get_db()
        try:
            await conn.execute("DELETE FROM holdings")
            await conn.execute("DELETE FROM cash_balance")
            await conn.commit()
        finally:
            await conn.close()

    _run(clear())
    assert _run(svc.build_portfolio_context(user_id)) == ""
