"""Webapp graph_runner unit tests: decision extraction from final state.

These test the pure helpers of the single seam between the webapp and the
tradingagents graph — no LLM, no graph run.
"""

from __future__ import annotations

import pytest

from webapp.services.graph_runner import (
    _debate_content,
    _extract_entry_price,
    _extract_results,
    _extract_stop_loss,
)


pytestmark = pytest.mark.unit


def test_entry_price_from_structured_render():
    # render_trader_proposal emits "**Entry Price**: 123.45"
    assert _extract_entry_price("**Action**: Buy\n\n**Entry Price**: 123.45") == 123.45


def test_entry_price_from_free_text_with_dollar():
    assert _extract_entry_price("Suggested entry price is $210.50.") == 210.5


def test_entry_price_thousands_separator():
    assert _extract_entry_price("Entry price: 1,234.56") == 1234.56


def test_no_entry_price_returns_none():
    assert _extract_entry_price("No levels given.") is None


def test_stop_loss_from_structured_render():
    assert _extract_stop_loss("**Stop Loss**: 118.0") == 118.0


def test_stop_loss_from_free_text():
    assert _extract_stop_loss("Place a stop loss at $17.25.") == 17.25


def test_extract_results_flattens_debate_dicts():
    final_state = {
        "market_report": "Market report body.",
        "final_trade_decision": "**Rating**: Buy\nDecision body.",
        "investment_debate_state": {
            "bull_history": "Bull says buy.",
            "bear_history": "Bear says sell.",
        },
        "risk_debate_state": {
            "aggressive_history": "Aggressive: full send.",
            "neutral_history": "Neutral: half.",
        },
    }
    results = {r["agent_name"]: r for r in _extract_results(final_state)}
    assert results["bull_researcher"]["content"] == "Bull says buy."
    assert results["bear_researcher"]["content"] == "Bear says sell."
    assert results["aggressive_risk"]["content"] == "Aggressive: full send."
    # bear_researcher must not pick up the aggressive transcript
    assert "Aggressive" not in results["bear_researcher"]["content"]


def test_debate_content_picks_first_nonempty_transcript():
    assert _debate_content({"bull_history": "", "bear_history": "Bear text"}) == "Bear text"
    assert _debate_content({"history": "Shared history"}) == "Shared history"
    assert _debate_content({"bull_history": ""}) is None
    assert _debate_content("plain text") == "plain text"
