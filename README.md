# TradingAgents (personal fork — webapp edition)

A personal fork of [TauricResearch/TradingAgents](https://github.com/TauricResearch/TradingAgents),
the multi-agent LLM financial trading framework. It tracks upstream **v0.4.1**
and adds a self-hosted **webapp**: a FastAPI backend + React/shadcn SPA that
lets you run and manage trading analyses from a browser.

## What this fork adds

The core framework (`tradingagents/`) and CLI (`cli/`) are upstream, unmodified
except for a small, documented patch set (see [UPSTREAM.md](UPSTREAM.md)). The
webapp (`webapp/`) is the fork's addition:

- **OIDC/SSO sign-in** — any OpenID Connect provider (e.g. Authentik); a local
  dev fallback (`WEBAPP_DEV_AUTOLOGIN=1`) provisions a fixed dev user when no
  IdP is configured.
- **Portfolio tracking** — holdings, transactions, cash, live Yahoo Finance
  quotes, weighted context fed into analyses.
- **Multi-agent analyses from the UI** — quick/medium/deep runs through the
  full LangGraph pipeline (analysts → trader → portfolio manager debate) with
  live streaming results, ratings, and run history.
- **Per-user LLM settings** — each user picks their own provider/model and API
  key (keys are encrypted at rest; nothing global required).
- **SimpleFIN sync** — import real bank/portfolio accounts automatically.
- Served as an installable PWA with a dark-first shadcn/ui interface.

## Quick start

```bash
cp .env.example .env        # fill in SECRET_KEY; either OIDC_* or dev autologin
pip install -e ".[dev]"     # or: pip install -r requirements.txt
python -m uvicorn webapp.main:app --reload   # http://localhost:8000
```

No IdP handy? Leave the `OIDC_*` vars blank, set `WEBAPP_DEV_AUTOLOGIN=1`, and
the app auto-provisions a "Local Dev" user. With OIDC, point
`OIDC_REDIRECT_URI` at your callback URL and register the app with your IdP.

Docker: `docker compose up --build` runs the webapp on `:8000` (the compose
file builds from source and is also the file used for Coolify deployments —
see below). UI development lives in `webapp/ui` (`npm install && npm run dev`,
Vite proxies `/api` and `/auth` to the backend).

## Deployment

This repository is public and stays free of credentials. `docker-compose.yml`
builds the Dockerfile and interpolates every value (`SECRET_KEY`, `OIDC_*`,
`FRED_API_KEY`) from the deployment environment — e.g. Coolify's
"Environment Variables" or a local `.env`. The webapp container listens on
port 8000; with Coolify, its proxy handles routing and TLS.

## Repository layout

```
tradingagents/   core library — multi-agent LangGraph pipeline (tracks upstream)
cli/             upstream Typer CLI
webapp/          the fork's addition — FastAPI backend, React SPA, SQLite
tests/           core + webapp test suite (pytest)
UPSTREAM.md      full diff of the fork's core changes vs upstream + merge recipe
AGENTS.md        contributor/agent guide (env loading, UI conventions, auth)
CHANGELOG.md     upstream changelog
```

## License

[Apache-2.0](LICENSE), as upstream. Not affiliated with Tauric Research —
for upstream docs, demos and citations, see their [README](https://github.com/TauricResearch/TradingAgents).
