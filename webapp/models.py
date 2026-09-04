"""
Pydantic models for the TradingAgents webapp API.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

# ── Holdings ──────────────────────────────────────────────────────────────────

class HoldingCreate(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=20, description="Ticker symbol")
    asset_type: str = Field(default="stock", description="Asset type: stock, crypto")
    quantity: float = Field(..., gt=0, description="Number of shares/coins")
    avg_cost: float | None = Field(default=None, ge=0, description="Average cost basis per share")


class HoldingUpdate(BaseModel):
    ticker: str | None = None
    asset_type: str | None = None
    quantity: float | None = Field(default=None, gt=0)
    avg_cost: float | None = Field(default=None, ge=0)


class HoldingResponse(BaseModel):
    id: int
    ticker: str
    asset_type: str
    quantity: float
    avg_cost: float | None
    source: str = "manual"
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
    notes: str | None = Field(default=None)


class TransactionResponse(BaseModel):
    id: int
    ticker: str
    transaction_type: str
    quantity: float
    price: float
    total_amount: float
    fees: float
    date: str
    notes: str | None
    source: str = "manual"
    created_at: str


# ── Cash Balance ──────────────────────────────────────────────────────────────

class CashBalanceCreate(BaseModel):
    amount: float = Field(..., ge=0)
    date: str = Field(..., description="Date YYYY-MM-DD")
    notes: str | None = Field(default=None)


class CashBalanceResponse(BaseModel):
    id: int
    amount: float
    date: str
    notes: str | None
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
    rating: str | None = None
    created_at: str
    completed_at: str | None = None
    error_message: str | None = None


class AnalysisResultItem(BaseModel):
    id: int
    agent_name: str
    output_type: str
    content: str
    created_at: str


class AnalysisDetailResponse(BaseModel):
    run: AnalysisRunResponse
    results: list[AnalysisResultItem]


# ── Auth / User ───────────────────────────────────────────────────────────────

class UserResponse(BaseModel):
    id: int
    sub: str
    email: str | None = None
    display_name: str | None = None
    is_initialized: bool
    options: dict | None = None  # Phase 2


class AnalysisHistoryResponse(BaseModel):
    items: list[AnalysisRunResponse]
    total: int
    page: int
    per_page: int


# ── Status ────────────────────────────────────────────────────────────────────

class StatusResponse(BaseModel):
    status: str
    message: str


# ── SimpleFIN ─────────────────────────────────────────────────────────────────

class SimpleFINConnectRequest(BaseModel):
    token: str = Field(..., min_length=1, description="Base64-encoded SimpleFIN Token")


class SimpleFINAccountOption(BaseModel):
    account_id: str
    name: str
    currency: str
    org_name: str
    org_domain: str


class SimpleFINAccountListResponse(BaseModel):
    accounts: list[SimpleFINAccountOption]


class SimpleFINLinkRequest(BaseModel):
    account_id: str = Field(..., min_length=1)
    account_name: str = Field(..., min_length=1)
    org_name: str = ""
    org_domain: str = ""


class SimpleFINSyncResponse(BaseModel):
    status: str
    holdings_synced: int
    transactions_synced: int
    cash_balance: float
    last_synced_at: str


class SimpleFINStatusResponse(BaseModel):
    connected: bool
    linked_account: dict | None = None
