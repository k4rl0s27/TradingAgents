export interface Me {
  id: number
  sub: string
  email: string | null
  display_name: string | null
  is_initialized: boolean
}

export interface StatusResponse {
  status: string
  message: string
}

export interface ProviderOption {
  key: string
  display_name: string
  env_var: string | null
}

export interface ModelOption {
  display: string
  value: string
}

export interface ProviderModels {
  provider: string
  deep_models: ModelOption[]
  quick_models: ModelOption[]
}

export interface Settings {
  llm_provider: string
  deep_think_llm: string | null
  quick_think_llm: string | null
  backend_url: string | null
  api_key_masked: string
  temperature: number | null
  google_thinking_level: string | null
  openai_reasoning_effort: string | null
  anthropic_effort: string | null
}

export interface Holding {
  id: number
  ticker: string
  asset_type: string
  quantity: number
  avg_cost: number | null
  source: string
  created_at: string
  updated_at: string
  // present on /portfolio/summary rows
  current_price?: number
  day_change?: number
  market_value?: number
}

export interface Transaction {
  id: number
  ticker: string
  transaction_type: "buy" | "sell"
  quantity: number
  price: number
  total_amount: number
  fees: number
  date: string
  notes: string | null
  source: string
  created_at: string
}

export interface CashBalance {
  id: number
  amount: number
  date: string
  notes: string | null
  created_at: string
}

export interface PortfolioSummary {
  cash: number
  holdings_cost: number
  market_value: number
  total_value: number
  invested: number
  holdings: Holding[]
  recent_transactions: Transaction[]
  cash_history: CashBalance[]
  context_for_agents: string
}

export interface LivePrices {
  prices: Record<string, { price: number; previous_close: number }>
}

export interface AnalysisRun {
  id: number
  ticker: string
  analysis_type: string
  analysis_depth?: string
  analysis_date: string
  status: "running" | "completed" | "failed"
  rating: string | null
  entry_price?: number | null
  stop_loss?: number | null
  position_sizing?: string | null
  error_message: string | null
  created_at: string
  completed_at: string | null
}

export interface AnalysisResult {
  id: number
  agent_name: string
  output_type: string
  content: string
  created_at: string
}

export interface AnalysisDetail {
  run: AnalysisRun
  results: AnalysisResult[]
  options: Record<string, unknown> | null
}

export interface AnalysisHistory {
  items: AnalysisRun[]
  total: number
  page: number
  per_page: number
}

export type AnalysisDepth = "quick" | "medium" | "deep"

export interface SimpleFINStatus {
  connected: boolean
  linked_account: { account_id: string; account_name: string; org_name?: string } | null
}

export interface SimpleFINAccount {
  account_id: string
  name: string
  currency: string
  org_name: string
  org_domain: string
}

export interface SimpleFINSync {
  status: string
  holdings_synced: number
  transactions_synced: number
  cash_balance: number
  last_synced_at: string
}
