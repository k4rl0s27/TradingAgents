import type {
  AnalysisDepth,
  AnalysisDetail,
  AnalysisHistory,
  AnalysisRun,
  AnalysisResult,
  LivePrices,
  Me,
  PortfolioSummary,
  ProviderModels,
  ProviderOption,
  Settings,
  SimpleFINAccount,
  SimpleFINStatus,
  SimpleFINSync,
  StatusResponse,
  Transaction,
} from "./types"

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, {
    credentials: "same-origin",
    headers: init?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...init,
  })
  if (!resp.ok) {
    let detail = resp.statusText
    try {
      const body = await resp.json()
      detail = body.detail ?? detail
    } catch {
      /* non-JSON error body */
    }
    if (resp.status === 401) {
      // Not authenticated (no dev autologin either): go through the login flow.
      if (!window.location.pathname.startsWith("/auth")) {
        window.location.href = "/auth/login"
      }
    }
    throw new ApiError(resp.status, String(detail))
  }
  return resp.json() as Promise<T>
}

export const api = {
  // ── auth ────────────────────────────────────────────────────────────────
  me: () => request<Me>("/auth/me"),
  logout: () => request<StatusResponse>("/auth/logout", { method: "POST" }),
  loginUrl: () => "/auth/login",

  // ── settings / setup ────────────────────────────────────────────────────
  getSettings: () => request<Settings | null>("/api/settings"),
  updateSettings: (body: Record<string, unknown>) =>
    request<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  initialize: (body: Record<string, unknown>) =>
    request<Settings>("/api/settings/initialize", { method: "POST", body: JSON.stringify(body) }),
  providers: () => request<{ providers: ProviderOption[] }>("/api/settings/providers"),
  providerModels: (provider: string) =>
    request<ProviderModels>(`/api/settings/providers/${encodeURIComponent(provider)}/models`),

  // ── portfolio ───────────────────────────────────────────────────────────
  summary: () => request<PortfolioSummary>("/api/portfolio/summary"),
  prices: () => request<LivePrices>("/api/portfolio/prices"),
  holdings: () => request<Array<Record<string, unknown> & { id: number }>>("/api/portfolio/holdings"),
  addHolding: (body: { ticker: string; asset_type?: string; quantity: number; avg_cost?: number | null }) =>
    request<StatusResponse>("/api/portfolio/holdings", { method: "POST", body: JSON.stringify(body) }),
  deleteHolding: (id: number) =>
    request<StatusResponse>(`/api/portfolio/holdings/${id}`, { method: "DELETE" }),
  transactions: () => request<Transaction[]>("/api/portfolio/transactions"),
  addTransaction: (body: {
    ticker: string
    transaction_type: "buy" | "sell"
    quantity: number
    price: number
    fees?: number
    date: string
    notes?: string | null
  }) => request<StatusResponse>("/api/portfolio/transactions", { method: "POST", body: JSON.stringify(body) }),
  deleteTransaction: (id: number) =>
    request<StatusResponse>(`/api/portfolio/transactions/${id}`, { method: "DELETE" }),
  cashHistory: () => request<CashBalanceLike[]>("/api/portfolio/cash"),
  setCash: (body: { amount: number; date: string; notes?: string | null }) =>
    request<StatusResponse>("/api/portfolio/cash", { method: "POST", body: JSON.stringify(body) }),
  deleteCash: (id: number) => request<StatusResponse>(`/api/portfolio/cash/${id}`, { method: "DELETE" }),

  // ── analysis ────────────────────────────────────────────────────────────
  runAnalysis: (body: { ticker: string; analysis_type: string; analysis_depth: AnalysisDepth; analysis_date: string }) =>
    request<AnalysisRun>("/api/analysis/run", { method: "POST", body: JSON.stringify(body) }),
  analysisStatus: (id: number) => request<AnalysisRun>(`/api/analysis/status/${id}`),
  runningAnalyses: () => request<{ running: AnalysisRun[] }>("/api/analysis/running"),
  analysisHistory: (params: { page?: number; per_page?: number; ticker?: string; type?: string }) => {
    const q = new URLSearchParams()
    if (params.page) q.set("page", String(params.page))
    if (params.per_page) q.set("per_page", String(params.per_page))
    if (params.ticker) q.set("ticker", params.ticker)
    if (params.type) q.set("type", params.type)
    return request<AnalysisHistory>(`/api/analysis/history?${q.toString()}`)
  },
  analysisDetail: (id: number) => request<AnalysisDetail>(`/api/analysis/${id}`),
  analysisStreamUrl: (id: number) => `/api/analysis/stream/${id}`,

  // ── SimpleFIN ───────────────────────────────────────────────────────────
  simplefinStatus: () => request<SimpleFINStatus>("/api/simplefin/status"),
  simplefinConnect: (token: string) =>
    request<{ accounts: SimpleFINAccount[] }>("/api/simplefin/connect", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  simplefinLink: (body: { account_id: string; account_name: string; org_name?: string; org_domain?: string }) =>
    request<StatusResponse>("/api/simplefin/link", { method: "POST", body: JSON.stringify(body) }),
  simplefinSync: () => request<SimpleFINSync>("/api/simplefin/sync", { method: "POST" }),
  simplefinDisconnect: () => request<StatusResponse>("/api/simplefin/disconnect", { method: "DELETE" }),
}

interface CashBalanceLike {
  id: number
  amount: number
  date: string
  notes: string | null
  created_at: string
}

export type { AnalysisResult, AnalysisRun }
