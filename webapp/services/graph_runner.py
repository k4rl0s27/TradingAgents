"""
Graph runner — the single seam between the webapp and the tradingagents graph.

This module is the ONLY place in the webapp that imports the tradingagents
graph internals (``TradingAgentsGraph``, its propagator, memory log, and state
keys). The rest of the webapp talks to it through plain dicts and callbacks,
so an upstream core change (renamed attribute, new state key, changed
streaming shape) is fixed here and here only.

Contract of ``run_graph_and_collect``:
- Runs the graph synchronously; call via ``run_in_executor`` (the graph is
  sync and blocking). ``emit`` is invoked from that worker thread, so callers
  must marshal it themselves (e.g. ``loop.call_soon_threadsafe``).
- ``emit`` receives ``{"type": "agent", "agent_name", "content"}`` /
  ``{"type": "status", "content"}`` dicts, already truncated for SSE.
- Returns ``{"rating", "entry_price", "stop_loss", "results"}`` where
  ``results`` is the per-agent output list persisted to the DB.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)

# Graph state keys -> display names, in emission order.
_REPORT_KEYS = [
    ("market_report", "Market Analyst"),
    ("sentiment_report", "Sentiment Analyst"),
    ("news_report", "News Analyst"),
    ("fundamentals_report", "Fundamentals Analyst"),
]
_DEBATE_KEYS = [
    ("investment_debate_state", "Bull/Bear Debate"),
    ("risk_debate_state", "Risk Debate"),
]
_FINAL_KEYS = [
    ("trader_investment_plan", "Trader"),
    ("final_trade_decision", "Portfolio Manager"),
]

# Order mirrors the agent execution flow; used to persist per-agent outputs.
_AGENT_OUTPUT_KEYS = [
    ("portfolio_manager", "final_trade_decision", "structured_decision"),
    ("market_analyst", "market_report", "market"),
    ("sentiment_analyst", "sentiment_report", "sentiment"),
    ("news_analyst", "news_report", "news"),
    ("fundamentals_analyst", "fundamentals_report", "fundamentals"),
    ("bull_researcher", "investment_debate_state", "bull_debate"),
    ("bear_researcher", "investment_debate_state", "bear_debate"),
    ("research_manager", "investment_plan", "structured_decision"),
    ("trader", "trader_investment_plan", "structured_decision"),
    ("aggressive_risk", "risk_debate_state", "risk_debate"),
    ("conservative_risk", "risk_debate_state", "risk_debate"),
    ("neutral_risk", "risk_debate_state", "risk_debate"),
]

# Portfolio context is injected into the Portfolio Manager through the
# upstream-native past_context channel (the PM prompt already renders it), so
# the fork owns no prompt edit in that file. The label is self-describing even
# though the PM prompt introduces it under "Lessons from prior decisions".
_PM_PORTFOLIO_PREFIX = "\n\n**Current Portfolio (from the portfolio tracker):**\n"


def _depth_config(depth: str) -> dict:
    """Return the analyst selection + config overrides for an analysis depth."""
    configs = {
        "quick": {
            "selected_analysts": ("market", "fundamentals"),
            "config_overrides": {
                "max_debate_rounds": 0,
                "max_risk_discuss_rounds": 0,
                "news_article_limit": 5,
                "global_news_article_limit": 3,
            },
        },
        "medium": {
            "selected_analysts": ("market", "social", "news", "fundamentals"),
            "config_overrides": {
                "max_debate_rounds": 1,
                "max_risk_discuss_rounds": 1,
                "news_article_limit": 20,
                "global_news_article_limit": 10,
            },
        },
        "deep": {
            "selected_analysts": ("market", "social", "news", "fundamentals"),
            "config_overrides": {
                "max_debate_rounds": 2,
                "max_risk_discuss_rounds": 2,
                "news_article_limit": 30,
                "global_news_article_limit": 15,
            },
        },
    }
    return configs.get(depth, configs["medium"])


def _build_config(user_llm: dict | None, depth: str) -> tuple[dict, tuple[str, ...]]:
    """Merge user LLM settings over DEFAULT_CONFIG + depth overrides.

    Only provider/model/key/tuning fields come from the user; everything else
    stays at the core defaults or depth overrides.
    """
    from tradingagents.default_config import DEFAULT_CONFIG

    depth_cfg = _depth_config(depth)
    config = {**DEFAULT_CONFIG, **depth_cfg["config_overrides"]}
    if user_llm:
        config["llm_provider"] = user_llm.get("llm_provider", config["llm_provider"])
        for key in (
            "deep_think_llm",
            "quick_think_llm",
            "backend_url",
            "temperature",
            "google_thinking_level",
            "openai_reasoning_effort",
            "anthropic_effort",
        ):
            if user_llm.get(key) is not None:
                config[key] = user_llm[key]
        # The per-user API key flows through config into llm_kwargs via
        # TradingAgentsGraph._get_provider_kwargs (fork(core) hunk).
        if user_llm.get("api_key"):
            config["api_key"] = user_llm["api_key"]
    return config, depth_cfg["selected_analysts"]


def _debate_content(state_value: Any) -> str | None:
    """Pull the first non-empty transcript out of a debate state dict."""
    if isinstance(state_value, str):
        return state_value if state_value.strip() else None
    if isinstance(state_value, dict):
        for sub in (
            "bull_history",
            "bear_history",
            "aggressive_history",
            "conservative_history",
            "neutral_history",
            "history",
            "current_response",
        ):
            val = state_value.get(sub)
            if val and str(val).strip():
                return str(val)
    return None


def _emit_new_keys(final_state: dict, emitted: set[str], emit: Callable[[dict], None]) -> None:
    """Emit an agent event the first time each report/debate/final key fills in."""
    for state_key, agent_name in _REPORT_KEYS + _DEBATE_KEYS + _FINAL_KEYS:
        if state_key in emitted:
            continue
        content = _debate_content(final_state.get(state_key))
        if content:
            emitted.add(state_key)
            emit({"type": "agent", "agent_name": agent_name, "content": content[:3000]})


def _emit_tool_status(final_state: dict, emit: Callable[[dict], None]) -> None:
    """Surface the latest tool call message as a lightweight status event."""
    msgs = final_state.get("messages", [])
    if not msgs:
        return
    last = msgs[-1]
    txt = getattr(last, "content", "")
    if txt and hasattr(last, "tool_calls") and getattr(last, "tool_calls", None):
        emit({"type": "status", "content": str(txt)[:500]})


def _extract_entry_price(text: str) -> float | None:
    """Extract the entry price from the trader's rendered proposal.

    The structured TraderProposal renders as ``**Entry Price**: 123.45``
    (tradingagents.agents.schemas.render_trader_proposal); on a free-text
    fallback the LLM usually keeps a similar ``Entry price: $X`` line, so the
    matcher tolerates markdown bold around the label and an optional dollar
    sign.
    """
    import re

    match = re.search(
        r"[Ee]ntry[\s\*]*[Pp]rice[^\d$]*\$?([\d,]+(?:\.\d+)?)", text
    )
    return float(match.group(1).replace(",", "")) if match else None


def _extract_stop_loss(text: str) -> float | None:
    """Extract the stop loss from the trader's rendered proposal."""
    import re

    match = re.search(
        r"[Ss]top[\s\*]*[Ll]oss[^\d$]*\$?([\d,]+(?:\.\d+)?)", text
    )
    return float(match.group(1).replace(",", "")) if match else None


def _extract_results(final_state: dict) -> list[dict]:
    """Extract individual agent outputs from the final state for the DB.

    Debate states are shared dicts (one per debate): each row keeps only its
    own agent's transcript — per-agent key first, debate-level ``history`` as
    fallback.
    """
    _DEBATE_KEYS_BY_AGENT = {
        "bull_researcher": ("bull_history", "history"),
        "bear_researcher": ("bear_history", "history"),
        "aggressive_risk": ("aggressive_history", "history"),
        "conservative_risk": ("conservative_history", "history"),
        "neutral_risk": ("neutral_history", "history"),
    }
    results = []
    for agent_name, state_key, output_type in _AGENT_OUTPUT_KEYS:
        value = final_state.get(state_key)
        if not value:
            continue
        if isinstance(value, dict):
            value = next(
                (
                    str(value[k])
                    for k in _DEBATE_KEYS_BY_AGENT.get(agent_name, ("history",))
                    if value.get(k) and str(value[k]).strip()
                ),
                "",
            )
        if value:
            results.append(
                {
                    "agent_name": agent_name,
                    "output_type": output_type,
                    "content": str(value),
                }
            )
    return results


def run_graph_and_collect(
    *,
    ticker: str,
    analysis_date: str,
    analysis_depth: str,
    user_llm: dict | None,
    portfolio_context: str,
    emit: Callable[[dict], None],
) -> dict:
    """Run the agent graph and stream its outputs through ``emit``.

    Returns ``{"rating", "entry_price", "stop_loss", "results"}``. ``rating``
    is one of the 5-tier scale or ``"REVIEW"`` when the decision carried no
    parseable rating (mirrors the core's own signal, #1170).
    """
    from tradingagents.agents.utils.rating import RATING_REVIEW, extract_rating
    from tradingagents.graph.trading_graph import TradingAgentsGraph

    config, selected_analysts = _build_config(user_llm, analysis_depth)
    ta = TradingAgentsGraph(debug=False, selected_analysts=selected_analysts, config=config)

    # Memory lessons are gated point-in-time so a historical run can't learn
    # from outcomes that had not happened yet (#1251). The portfolio is the
    # user's CURRENT book and is labeled as such for the model.
    past_context = ta.memory_log.get_past_context(ticker, as_of=analysis_date)
    if portfolio_context:
        past_context += _PM_PORTFOLIO_PREFIX + portfolio_context

    instrument_context = ta.resolve_instrument_context(ticker, "stock")
    init_state = ta.propagator.create_initial_state(
        ticker,
        analysis_date,
        past_context=past_context,
        instrument_context=instrument_context,
        portfolio_context=portfolio_context,
    )
    args = ta.propagator.get_graph_args()

    final_state: dict[str, Any] = {}
    emitted: set[str] = set()

    def _stream_and_emit():
        for chunk in ta.graph.stream(init_state, **args):
            final_state.update(chunk)
            _emit_new_keys(final_state, emitted, emit)
            _emit_tool_status(final_state, emit)

    _stream_and_emit()

    decision_text = str(final_state.get("final_trade_decision", "") or "")
    trader_plan = str(final_state.get("trader_investment_plan", "") or "")
    rating = extract_rating(decision_text) or RATING_REVIEW
    return {
        "rating": rating,
        "entry_price": _extract_entry_price(trader_plan),
        "stop_loss": _extract_stop_loss(trader_plan),
        "results": _extract_results(final_state),
    }
