/**
 * API client — wraps fetch calls to the FastAPI backend.
 */

const BASE = '';

async function request(path, options = {}) {
    const url = `${BASE}${path}`;
    const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
    });
    if (!res.ok) {
        // Handle 401 by redirecting to login
        if (res.status === 401) {
            window.location.href = '/auth/login';
            throw new Error('Not authenticated');
        }
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `HTTP ${res.status}`);
    }
    // For 204 No Content or empty responses
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

// ── Auth ─────────────────────────────────────────────────────────────────

export const getMe = () => request('/auth/me');
export const logout = () => request('/auth/logout', { method: 'POST' });

// ── Settings ─────────────────────────────────────────────────────────────

export const getProviders = () => request('/api/settings/providers');
export const getProviderModels = (provider) => request(`/api/settings/providers/${provider}/models`);
export const getSettings = () => request('/api/settings');
export const initializeSettings = (body) => request('/api/settings/initialize', {
    method: 'POST',
    body: JSON.stringify(body),
});

// ── Portfolio ────────────────────────────────────────────────────────────

export const getPortfolioSummary = () => request('/api/portfolio/summary');
export const getHoldings = () => request('/api/portfolio/holdings');

export async function addHolding(ticker, quantity, avgCost, sector) {
    return request('/api/portfolio/holdings', {
        method: 'POST',
        body: JSON.stringify({ ticker, quantity: Number(quantity), avg_cost: avgCost ? Number(avgCost) : null, sector: sector || null, asset_type: 'stock' }),
    });
}

export async function updateHolding(id, ticker, quantity, avgCost, sector) {
    return request(`/api/portfolio/holdings/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ ticker, quantity: Number(quantity), avg_cost: avgCost ? Number(avgCost) : null, sector: sector || null }),
    });
}

export const deleteHolding = (id) => request(`/api/portfolio/holdings/${id}`, { method: 'DELETE' });
export const getTransactions = (limit = 100) => request(`/api/portfolio/transactions`);
export const getCashHistory = () => request('/api/portfolio/cash');
export const deleteCash = (id) => request(`/api/portfolio/cash/${id}`, { method: 'DELETE' });

export async function setCashBalance(amount, date) {
    return request('/api/portfolio/cash', { method: 'POST', body: JSON.stringify({ amount: Number(amount), date }) });
}

export async function recordTransaction(ticker, type, quantity, price, fees, date, notes) {
    return request('/api/portfolio/transactions', {
        method: 'POST',
        body: JSON.stringify({ ticker, transaction_type: type, quantity: Number(quantity), price: Number(price), fees: Number(fees || 0), date, notes: notes || null }),
    });
}

export const deleteTransaction = (id) => request(`/api/portfolio/transactions/${id}`, { method: 'DELETE' });

// ── Analysis ─────────────────────────────────────────────────────────────

export const runAnalysis = (ticker, analysisDate, analysisType = 'regular', analysisDepth = 'medium') =>
    request('/api/analysis/run', { method: 'POST', body: JSON.stringify({ ticker, analysis_date: analysisDate, analysis_type: analysisType, analysis_depth: analysisDepth }) });

export const getAnalysisStatus = (runId) => request(`/api/analysis/status/${runId}`);
export const getAnalysisDetail = (runId) => request(`/api/analysis/${runId}`);

export async function getAnalysisHistory(page = 1, perPage = 20, ticker = '', type = '') {
    const params = new URLSearchParams({ page, per_page: perPage });
    if (ticker) params.set('ticker', ticker);
    if (type) params.set('type', type);
    return request(`/api/analysis/history?${params}`);
}

// ── Health ────────────────────────────────────────────────────────────────

export const healthCheck = () => request('/api/health');
