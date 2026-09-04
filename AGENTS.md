# AGENTS.md

Personal fork of [TauricResearch/TradingAgents](https://github.com/TauricResearch/TradingAgents) whose main addition is a **webapp** (FastAPI + hand-rolled vanilla-JS SPA: portfolio tracking, per-user LLM keys, OIDC login, SimpleFIN sync). Not intended for upstream contribution. Local `main` = upstream **v0.3.1** (`01477f9`) + webapp commits; `upstream/main` is ~27 commits ahead and `upstream/v0.4.x` tags exist but are unmerged. Pulling upstream will conflict in the core graph files the fork already touched.

## Layout

- `tradingagents/` — core library (LangGraph multi-agent pipeline, LLM clients, dataflows). The webapp drives it directly; it is not a frozen dependency.
- `cli/` — upstream Typer CLI (`tradingagents` console script → `cli.main:app`).
- `webapp/` — the fork's addition. `routers/` = FastAPI routes, `services/` = DB/graph bridging, `database.py` = aiosqlite schema + idempotent migrations, `static/` = plain JS/CSS SPA (no build step, edit files directly).
- `tests/` — unit/integration for the core only; **there are no webapp tests** and CI does not exercise the webapp.
- `ui-reference/` — design mockups, not loaded at runtime.

## Commands

- Install dev deps: `pip install -e ".[dev]"` (Python >=3.10). `pip install -r requirements.txt` is the alternative.
- Run webapp: `python -m uvicorn webapp.main:app --reload` **from the repo root** (also `docker compose up webapp`). Docker default entrypoint is the webapp on :8000.
- CLI: `tradingagents` or `python -m cli.main`.
- Tests: `pytest` (CI runs the whole suite; all markers — including `integration`/`smoke` — run by default). Focused: `pytest -m unit`.
- Lint (the CI gate): `ruff check .` — keep the whole repo clean under the strict select (E501 ignored, line-length 100). Do **not** run `ruff format` repo-wide; formatter adoption is deliberately deferred per the pyproject comment.
- Route inventory helper: `python scripts/check_routes.py`.
- Root `main.py` (hardcoded NVDA sample) and `test.py` (leftover timing script) are scratch; neither is an entrypoint.

## Env loading (gotcha)

`.env` is loaded by `tradingagents/__init__.py` via `find_dotenv(usecwd=True)`, so **cwd must be the repo root** for a bare `uvicorn`/CLI run to see `.env`. `webapp/main.py` reads `SECRET_KEY` and `webapp/auth.py` reads `OIDC_*` at import time, which works because importing the webapp imports `tradingagents` first — but only when cwd finds the right `.env`.

## Webapp auth / data

- Every `/api/*` route (and `/auth/me`) is gated by a session user via `get_current_user` → 401 without login. Login is **OIDC-only**: without `OIDC_ISSUER`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET`/`OIDC_REDIRECT_URI` (+`SECRET_KEY`) set, `/auth/login` returns 501 — there is no local/dev-login fallback. The comment in `static/js/app.js` ("runs without auth") is stale/misleading.
- Per-user API keys are stored encrypted in SQLite (Fernet key derived from `SECRET_KEY` in `webapp/crypto.py`). Rotating `SECRET_KEY` orphans every stored key (decryption then raises).
- Webapp SQLite DB is repo-root `data/trading.db` — it is **committed to git** even though `.gitignore` has `*.db` (ignore only affects untracked files). Don't commit incidental DB churn; schema migrations run idempotently at startup.
- Settings flow: user-selected provider/model/key override `tradingagents.default_config.DEFAULT_CONFIG` (see `analysis_service._depth_config` + `get_user_llm_config`). `TRADINGAGENTS_*` env vars also overlay `DEFAULT_CONFIG` regardless of entrypoint.

## Core-graph integration the webapp relies on

The fork extended `TradingAgentsGraph` for the webapp; preserve these when editing core:
- `propagate()` takes `portfolio_context`; config accepts a per-user `api_key` that bypasses env lookup (`tradingagents/graph/trading_graph.py`).
- `analysis_service.run_analysis_background` calls `ta.graph.stream(...)` in a worker thread (the graph is sync), mapping emitted state keys to agent names, and pushes to a per-run `asyncio.Queue` consumed by the SSE endpoint `/api/analysis/stream/{id}`.
- The `options` analysis type is stubbed (`start_analysis` raises `NotImplementedError`).
