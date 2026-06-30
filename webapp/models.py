"""
Pydantic models for the TradingAgents webapp API.
"""

from __future__ import annotations

from datetime import date as Date
from typing import Optional

from pydantic import BaseModel, Field


# ── Holdings ──────────────────────────────────────────────────────────────────

class HoldingCreate(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=20, description="Ticker symbol")
    asset_type: str = Field(default="stock", description="Asset type: stock, crypto")
    quantity: float = Field(..., gt=0, description="Number of shares/coins")
    avg_cost: Optional[float] = Field(default=None, ge=0, description="Average cost basis per share")
    sector: Optional[str] = Field(default=None, description="Sector classification")


class HoldingUpdate(BaseModel):
    ticker: Optional[str] = None
    asset_type: Optional[str] = None
    quantity: Optional[float] = Field(default=None, gt=0)
    avg_cost: Optional[float] = Field(default=None, ge=0)
    sector: Optional[str] = None


class HoldingResponse(BaseModel):
    id: int
    ticker: str
    asset_type: str
    quantity: float
    avg_cost: Optional[float]
    sector: Optional[str]
    created_at: str
    updated_at: str


# ── Transactions ──────────────────────────────────────────────────────────────

class TransactionCreate(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=20)
    transaction_type: str = Field(..., pattern="^(buy|sell)$")
    quantity: float = Field(..., gt=0)
    price: float = Field(..., gt=0)
    fees: float = Field(default=0, ge=0)
    date: str = Field(..., description="Trade date YYYY-MM-DD")
    notes: Optional[str] = Field(default=None)


class TransactionResponse(BaseModel):
    id: int
    ticker: str
    transaction_type: str
    quantity: float
    price: float
    total_amount: float
    fees: float
    date: str
    notes: Optional[str]
    created_at: str


# ── Cash Balance ──────────────────────────────────────────────────────────────

class CashBalanceCreate(BaseModel):
    amount: float = Field(..., ge=0)
    date: str = Field(..., description="Date YYYY-MM-DD")
    notes: Optional[str] = Field(default=None)


class CashBalanceResponse(BaseModel):
    id: int
    amount: float
    date: str
    notes: Optional[str]
    created_at: str


# ── Portfolio Summary ─────────────────────────────────────────────────────────

class PortfolioSummary(BaseModel):
    cash: float
    holdings_value: float
    total_value: float
    holdings: list[HoldingResponse]
    recent_transactions: list[TransactionResponse]
    cash_history: list[CashBalanceResponse]


# ── Analysis ──────────────────────────────────────────────────────────────────

class AnalysisRunRequest(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=20)
    analysis_type: str = Field(default="regular", pattern="^(regular|options)$")
    analysis_depth: str = Field(default="medium", pattern="^(quick|medium|deep)$", description="Analysis depth: quick, medium, or deep")
    analysis_date: str = Field(..., description="Target analysis date YYYY-MM-DD")


class AnalysisRunResponse(BaseModel):
    id: int
    ticker: str
    analysis_type: str
    analysis_date: str
    status: str
    rating: Optional[str] = None
    created_at: str
    completed_at: Optional[str] = None
    error_message: Optional[str] = None


class AnalysisResultItem(BaseModel):
    id: int
    agent_name: str
    output_type: str
    content: str
    created_at: str


class AnalysisDetailResponse(BaseModel):
    run: AnalysisRunResponse
    results: list[AnalysisResultItem]
    options: Optional[dict] = None  # Phase 2


class AnalysisHistoryResponse(BaseModel):
    items: list[AnalysisRunResponse]
    total: int
    page: int
    per_page: int


# ── Status ────────────────────────────────────────────────────────────────────

class StatusResponse(BaseModel):
    status: str
    message: str
