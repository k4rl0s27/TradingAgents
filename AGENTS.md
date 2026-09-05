# AGENTS.md

Personal fork of [TauricResearch/TradingAgents](https://github.com/TauricResearch/TradingAgents) whose main addition is a **webapp** (FastAPI backend + React/shadcn SPA: portfolio tracking, per-user LLM keys, OIDC login, SimpleFIN sync, multi-agent analyses). Not intended for upstream contribution. Local `main` tracks upstream **v0.4.1** (`9dee508`) + webapp commits. **See `UPSTREAM.md` before pulling upstream** — it lists the fork's entire core patch (5 small hunks) and the merge procedure.

## Layout

- `tradingagents/` — core library (LangGraph multi-agent pipeline, LLM clients, dataflows). Tracks upstream closely; the fork's only changes are the `fork(core):`-marked hunks in `UPSTREAM.md`.
- `cli/` — upstream Typer CLI (`tradingagents` console script → `cli.main:app`).
- `webapp/` — the fork's addition. `routers/` = FastAPI routes, `services/` = DB/graph bridging, `database.py` = aiosqlite schema + versioned migrations, `ui/` = the **React + shadcn/ui SPA** (Vite, TypeScript, Tailwind v4) which builds into `webapp/static`, `static/` = committed build output the backend serves at the root (SPA fallback for client routes).
- `tests/` — core unit/integration + the newer `test_webapp_*` unit tests (DB migrations, dev autologin, decision extraction, portfolio context). CI runs `pytest -q`; it does not start the webapp server.
- `ui-reference/` — design mockups, not loaded at runtime.

## Commands

- Install dev deps: `pip install -e ".[dev]"` (Python >=3.10). `pip install -r requirements.txt` is the alternative.
- Run webapp: `python -m uvicorn webapp.main:app --reload` **from the repo root** (also `docker compose up webapp` — `docker-compose.yml` builds from source; env vars interpolate from the local `.env`). Docker default entrypoint is the webapp on :8000.
- Deployments (e.g. Coolify) use the same `docker-compose.yml`: it builds the `Dockerfile` from source (no image to push) and interpolates every value from the deployment env (e.g. the Coolify app's Environment Variables). This repo is **public** — never commit real credentials.
- UI dev server: from `webapp/ui`: `npm install`, then `npm run dev` (Vite on :5173, proxies `/api` + `/auth` to :8000 — keep the uvicorn backend running). **OIDC in dev**: `OIDC_REDIRECT_URI` must point at `http://localhost:5173/auth/callback`; simplest local dev is `WEBAPP_DEV_AUTOLOGIN=1` with OIDC unset.
- UI production build: from `webapp/ui`: `npm run build` → wipes and rewrites `webapp/static` (**commit the result** — pip/Docker serve it without Node). UI lint: `npm run lint` (oxlint; warnings tolerated, keep zero errors).
- Adding shadcn components: `npx shadcn@latest add <name>` — the CLI writes to a literal `@/` folder at `webapp/ui` root (it does not resolve the tsconfig alias); move files into `src/components/ui/`.
- PWA icons are generated (no image toolchain): `python scripts/gen_pwa_icons.py` from the repo root — only needed when changing `webapp/ui/public` branding.
- Demo data for dev (`WEBAPP_DEV_AUTOLOGIN` mode): `python scripts/seed_demo.py` from the repo root (requires `SECRET_KEY` set; wipes and re-seeds only the "Local Dev" user — holdings, cash, transactions, sample analyses). The dev identity constant lives in `webapp/routers/auth.py` (`_DEV_SUB`) and is duplicated in the seeder — keep in sync.
- CLI: `tradingagents` or `python -m cli.main`.
- Tests: `pytest` (CI runs the whole suite; all markers — including `integration`/`smoke` — run by default). Focused: `pytest -m unit`.
- Lint (the CI gate): `ruff check .` — keep the whole repo clean under the strict select (E501 ignored, line-length 100). Do **not** run `ruff format` repo-wide; formatter adoption is deliberately deferred per the pyproject comment.
- Route inventory helper: `python scripts/check_routes.py`.
- Root `main.py` (hardcoded NVDA sample) and `test.py` (leftover timing script) are scratch; neither is an entrypoint.

## UI conventions (`webapp/ui`)

Keep the UI cohesive — these rules encode deliberate choices:
- **Reusable fields**: never use native `<input type="date">` or number spinners — use `@/components/date-field` (calendar popover, local-timezone-safe) and `@/components/number-field` (+/− steppers). App-level wrappers live in `components/`, shadcn primitives in `components/ui/`.
- **Buttons**: primary actions sit directly *below* their inputs, left-aligned (Settings "Save", SimpleFIN "Connect", analysis "Run"). Dialog footers right-align (Save/Record/Disconnect inside `DialogFooter`).
- **Badges**: `RatingBadge`/`StatusBadge` live in `@/components/rating-badge` — never re-define them in pages (import-cycle hazard). Ratings map Buy/Overweight→green, Hold→amber, Under/→Sell red, `REVIEW`→muted.
- **Analysis results** render through `@/components/analysis-results`: the Portfolio Manager card is pinned first and wrapped in `.gradient-border` (uniform CSS-mask gradient ring in `src/index.css`) + glow. `RunStats` shows Rating/Entry/Stop cards above outputs on completed runs.
- **Past analyses open in a Dialog** (max-w-5xl, scrollable body, sticky header that reserves `pr-14` so pills clear the close button); the only analysis *page* is the live/streaming view. Radix autofocus of the close button is disabled globally in `ui/dialog.tsx`.
- **Motion**: view changes key off `location.pathname` in `app-shell` with `.animate-view` (respects `prefers-reduced-motion`); dialog overlays blur (`backdrop-blur-sm` in `ui/dialog.tsx`). Keep at least ~900ms of spinner on async buttons whose real work can be near-instant (SimpleFIN sync).
- **Formatting helpers** (`formatMoney`, `formatNumber`, `formatPercent`, `formatDate`, `prettifyAgentName`) live in `src/lib/utils.ts` — `prettifyAgentName` maps stored snake_case `agent_name`s to display labels.
- Adding shadcn components: `npx shadcn@latest add <name>` (see Commands) — the generated files import from the `cn` package and drop into a literal `@/` folder; move to `src/components/ui/`.

## Env loading (gotcha)

`.env` is loaded by `tradingagents/__init__.py` via `find_dotenv(usecwd=True)`, so **cwd must be the repo root** for a bare `uvicorn`/CLI run to see `.env`. `webapp/main.py` reads `SECRET_KEY` and `webapp/auth.py` reads `OIDC_*` at import time, which works because importing the webapp imports `tradingagents` first — but only when cwd finds the right `.env`.

## Webapp auth / data

- Every `/api/*` route (and `/auth/me`) is gated by a session user via `get_current_user` → 401 without login. Login is **OIDC-only**: without `OIDC_ISSUER`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET`/`OIDC_REDIRECT_URI` (+`SECRET_KEY`) set, `/auth/login` returns 501. The one escape hatch is `WEBAPP_DEV_AUTOLOGIN=1` — **only** with OIDC unconfigured it provisions a fixed "Local Dev" user (see `webapp/routers/auth.py`); it is ignored whenever OIDC is configured.
- Per-user API keys are stored encrypted in SQLite (Fernet key derived from `SECRET_KEY` in `webapp/crypto.py`). Rotating `SECRET_KEY` orphans every stored key (decryption then raises).
- Webapp SQLite DB is repo-root `data/trading.db` — **untracked** (`.gitignore` has `*.db`), created at startup. Deleting it resets users/settings/history; migrations are versioned via the `schema_version` row (`SCHEMA_VERSION` in `webapp/database.py` — bump it when adding a `_MIGRATIONS` entry).
- Settings flow: user-selected provider/model/key override `tradingagents.default_config.DEFAULT_CONFIG` (merge lives in `graph_runner._build_config` + `user_service.get_user_llm_config`). `TRADINGAGENTS_*` env vars also overlay `DEFAULT_CONFIG` regardless of entrypoint.
- Live quotes come from Yahoo Finance and are TTL-cached 30s in `portfolio_service.get_current_prices` (module dict, failures never cached) — dashboard/holdings loads hit it; the first request after a server restart pays the network cost.
- Routes: the SPA lives under `/dashboard`, `/portfolio` (holdings/transactions/cash tabs), `/analysis` (run + history; past analyses open in a dialog), `/analysis/:id` (live run view only), `/settings` (provider settings + SimpleFIN).

## Core-graph integration the webapp relies on

Everything graph-facing lives in **`webapp/services/graph_runner.py`** — the single seam that imports tradingagents (routers/SSE/DB layers never do). Preserve when editing core:
- The Trader prompt reads state key `portfolio_context` (the fork's only prompt edit); the Portfolio Manager receives the portfolio block through the existing `past_context` channel — no PM/debator edits exist anymore.
- Config accepts a per-user `api_key` that bypasses env lookup (`_get_provider_kwargs` + `openai_client`, both `fork(core):`-marked).
- `graph_runner` builds the initial state itself (`ta.propagator.create_initial_state`, memory log fetched with `as_of=analysis_date`) and streams via `ta.graph.stream(...)` in a worker thread (the graph is sync), mapping emitted state keys to agent names and pushing to a per-run `asyncio.Queue` consumed by the SSE endpoint `/api/analysis/stream/{id}`.
- The `options` analysis type is stubbed (`start_analysis` raises `NotImplementedError`).
