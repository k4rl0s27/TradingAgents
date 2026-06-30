/**
 * Portfolio tab logic — Dashboard + Portfolio Manager (full CRUD).
 * No framework dependencies. Uses Chart.js for allocation donut.
 */

import * as api from './api.js';
import { showToast, setStatus } from './app.js';

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

export const fmtCurrency = (v) => (v == null || isNaN(v)) ? '--' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtNum = (v) => (v == null || isNaN(v)) ? '--' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
export const escHtml = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };

function g(id) { return document.getElementById(id); }
function fv(id) { const el = g(id); return el ? el.value : ''; }
function fs(id, v) { const el = g(id); if (el) el.value = v; }

let allocationChart = null;

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════════════════

export async function loadDashboard() {
    try {
        const s = await api.getPortfolioSummary();
        renderSummaryCards(s);
        renderHoldingsTable(s.holdings, s.total_value);
        renderAllocationChart(s.holdings, s.total_value, s.cash);
        renderDashboardTransactions(s.recent_transactions);
        setStatus('idle');
    } catch (err) {
        setStatus('failed');
        showToast('Failed to load portfolio: ' + err.message, 'error');
    }
}

function renderSummaryCards(s) {
    g('sum-total').textContent = fmtCurrency(s.total_value);
    g('sum-cash').textContent = fmtCurrency(s.cash);
    g('sum-holdings').textContent = fmtCurrency(s.holdings_value);
    g('sum-positions').textContent = s.holdings.length;
    g('sum-positions-sub').textContent = s.holdings.length + ' active holding' + (s.holdings.length !== 1 ? 's' : '');
}

function renderHoldingsTable(holdings, totalValue) {
    const tbody = g('holdings-tbody');
    if (!holdings.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No holdings yet. Add positions in Portfolio Manager.</td></tr>';
        g('holdings-count').textContent = '0 positions';
        return;
    }
    g('holdings-count').textContent = holdings.length + ' position' + (holdings.length !== 1 ? 's' : '');

    tbody.innerHTML = holdings.map(h => {
        const val = h.quantity * (h.avg_cost || 0);
        const w = totalValue > 0 ? (val / totalValue * 100).toFixed(1) : '0.0';
        return `<tr>
            <td><strong>${escHtml(h.ticker)}</strong></td>
            <td class="num">${fmtNum(h.quantity)}</td>
            <td class="num">${h.avg_cost ? fmtCurrency(h.avg_cost) : '--'}</td>
            <td class="num">${fmtCurrency(val)}</td>
            <td class="num">${w}%</td></tr>`;
    }).join('');
}

function renderAllocationChart(holdings, totalValue, cash) {
    const canvas = g('allocation-chart');
    const empty = g('chart-empty');
    if (allocationChart) { allocationChart.destroy(); allocationChart = null; }

    const segs = [], labels = [];
    const colors = ['#D0BCFF','#7ADDA0','#FFB4AB','#A8C7FA','#FFD699','#CCC2DC','#B4E5F9','#F2B8B5','#C5E1A5','#FFE082','#FFAB91','#80CBC4'];
    if (cash > 0) { segs.push(cash); labels.push('Cash'); }
    for (const h of holdings) {
        const v = h.quantity * (h.avg_cost || 0);
        if (v > 0) { segs.push(v); labels.push(h.ticker); }
    }
    if (!segs.length) { canvas.style.display = 'none'; g('chart-legend').classList.add('hidden'); empty.classList.remove('hidden'); return; }
    canvas.style.display = 'block'; empty.classList.add('hidden');

    const isDark = document.documentElement.classList.contains('dark');
    allocationChart = new Chart(canvas, {
        type: 'doughnut',
        data: { labels, datasets: [{ data: segs, backgroundColor: colors.slice(0, segs.length), borderColor: isDark ? '#2d2d2d' : '#ffffff', borderWidth: 2 }] },
        options: {
            responsive: true, maintainAspectRatio: true,
            plugins: { legend: { display: false } },
        },
    });

    // Render custom HTML legend with proper circles
    const legendEl = g('chart-legend');
    legendEl.innerHTML = labels.map((label, i) => `
        <div class="chart-legend-item">
            <span class="chart-legend-swatch" style="background:${colors[i]}"></span>
            <span class="chart-legend-label">${escHtml(label)}</span>
        </div>`).join('');
    legendEl.classList.remove('hidden');
}

function renderDashboardTransactions(txs) {
    const container = g('tx-mini-list');
    container.innerHTML = '';
    if (!txs || !txs.length) {
        container.innerHTML = '<p class="empty-state">No transactions yet.</p>';
        return;
    }
    for (const tx of txsslice(0, 10)) {
        const isBuy = tx.transaction_type === 'buy';
        const dateStr = tx.date ? new Date(tx.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '--';
        container.innerHTML += `<div class="tx-mini-item">
            <span class="tx-mini-ticker">${escHtml(tx.ticker)}</span>
            <span class="tx-mini-type ${tx.transaction_type}">${isBuy ? 'Buy' : 'Sell'}</span>
            <span class="tx-mini-details">${fmtNum(tx.quantity)} @ ${fmtCurrency(tx.price)}</span>
            <span class="tx-mini-date">${dateStr}</span>
        </div>`;
    }
}

function txsslice(arr, n) { return arr ? arr.slice(0, n) : []; }

// ═══════════════════════════════════════════════════════════════════════════
// Portfolio Manager
// ═══════════════════════════════════════════════════════════════════════════

export async function loadPortfolioManager() {
    await Promise.all([loadCashTable(), loadPMHoldings(), loadPMTransactions()]);
    setStatus('idle');
}

// ── Cash ──────────────────────────────────────────────────────────────────

async function loadCashTable() {
    try {
        const history = await api.getCashHistory();
        const tbody = g('pm-cash-tbody');
        const count = g('pm-cash-count');
        tbody.innerHTML = '';
        if (!history || !history.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No cash records.</td></tr>';
            count.textContent = '0 entries';
            return;
        }
        count.textContent = history.length + ' entr' + (history.length !== 1 ? 'ies' : 'y');

        for (const h of history) {
            const createdStr = h.created_at ? new Date(h.created_at + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '--';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escHtml(h.date)}</td>
                <td class="num">${fmtCurrency(h.amount)}</td>
                <td>${escHtml(h.notes || '--')}</td>
                <td>${createdStr}</td>
                <td>
                    <button class="btn-delete-row" title="Delete entry" data-delete-cash="${h.id}">
                        <span class="material-symbols-outlined">delete</span>
                    </button>
                </td>`;
            tbody.appendChild(tr);
        }

        tbody.querySelectorAll('[data-delete-cash]').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Delete this cash entry?')) return;
                try {
                    await api.deleteCash(Number(btn.dataset.deleteCash));
                    showToast('Cash entry deleted', 'success');
                    await loadCashTable();
                    await loadDashboard();
                } catch (err) { showToast(err.message, 'error'); }
            });
        });
    } catch (e) { /* ignore */ }
}

export function initCashForm() {
    const form = g('cash-form');
    if (!form) return;
    fs('cash-date', new Date().toISOString().split('T')[0]);
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await api.setCashBalance(fv('cash-amount'), fv('cash-date'));
            showToast('Cash balance updated', 'success');
            fs('cash-amount', '');
            await loadCashTable();
            await loadDashboard();
        } catch (err) { showToast(err.message, 'error'); }
    });
}

// ── Holdings CRUD ─────────────────────────────────────────────────────────

async function loadPMHoldings() {
    try {
        const holdings = await api.getHoldings();
        const tbody = g('pm-holdings-tbody');
        const count = g('pm-holdings-count');
        tbody.innerHTML = '';
        if (!holdings.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No holdings.</td></tr>';
            count.textContent = '0 positions';
            return;
        }
        count.textContent = holdings.length + ' position' + (holdings.length !== 1 ? 's' : '');

        for (const h of holdings) {
            const val = h.quantity * (h.avg_cost || 0);
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${escHtml(h.ticker)}</strong></td>
                <td class="num">${fmtNum(h.quantity)}</td>
                <td class="num">${h.avg_cost ? fmtCurrency(h.avg_cost) : '--'}</td>
                <td class="num">${fmtCurrency(val)}</td>
                <td>${escHtml(h.sector || '--')}</td>
                <td>
                    <button class="btn-delete-row" title="Delete ${escHtml(h.ticker)}" data-delete-holding="${h.id}" data-ticker="${escHtml(h.ticker)}">
                        <span class="material-symbols-outlined">delete</span>
                    </button>
                </td>`;
            tbody.appendChild(tr);
        }

        // Attach delete handlers
        tbody.querySelectorAll('[data-delete-holding]').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm(`Delete holding ${btn.dataset.ticker}? This cannot be undone.`)) return;
                try {
                    await api.deleteHolding(Number(btn.dataset.deleteHolding));
                    showToast(`Deleted ${btn.dataset.ticker}`, 'success');
                    await loadPMHoldings();
                    await loadDashboard();
                } catch (err) { showToast(err.message, 'error'); }
            });
        });
    } catch (err) { showToast('Failed to load holdings: ' + err.message, 'error'); }
}

export function initHoldingForm() {
    const form = g('holding-form');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const ticker = fv('hold-ticker').trim().toUpperCase();
        const qty = fv('hold-qty');
        const cost = fv('hold-cost');
        const sector = fv('hold-sector').trim();
        if (!ticker || !qty) { showToast('Ticker and quantity are required', 'error'); return; }
        try {
            await api.addHolding(ticker, qty, cost || null, sector || null);
            showToast(`Holding ${ticker} saved`, 'success');
            fs('hold-ticker', ''); fs('hold-qty', ''); fs('hold-cost', ''); fs('hold-sector', '');
            await loadPMHoldings();
            await loadDashboard();
        } catch (err) { showToast(err.message, 'error'); }
    });
}

// ── Transactions CRUD ─────────────────────────────────────────────────────

async function loadPMTransactions() {
    try {
        const txs = await api.getTransactions();
        const tbody = g('pm-tx-tbody');
        const count = g('pm-tx-count');
        tbody.innerHTML = '';
        if (!txs || !txs.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No transactions.</td></tr>';
            count.textContent = '0 transactions';
            return;
        }
        count.textContent = txs.length + ' transaction' + (txs.length !== 1 ? 's' : '');

        for (const tx of txs) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escHtml(tx.date)}</td>
                <td><strong>${escHtml(tx.ticker)}</strong></td>
                <td><span class="tx-mini-type ${tx.transaction_type}">${tx.transaction_type === 'buy' ? 'Buy' : 'Sell'}</span></td>
                <td class="num">${fmtNum(tx.quantity)}</td>
                <td class="num">${fmtCurrency(tx.price)}</td>
                <td class="num">${fmtCurrency(tx.total_amount)}</td>
                <td class="num">${fmtCurrency(tx.fees)}</td>
                <td>
                    <button class="btn-delete-row" title="Delete transaction" data-delete-tx="${tx.id}" data-ticker="${escHtml(tx.ticker)}">
                        <span class="material-symbols-outlined">delete</span>
                    </button>
                </td>`;
            tbody.appendChild(tr);
        }

        tbody.querySelectorAll('[data-delete-tx]').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm(`Delete ${btn.dataset.ticker} transaction? This will recalculate the holding.`)) return;
                try {
                    await api.deleteTransaction(Number(btn.dataset.deleteTx));
                    showToast('Transaction deleted — holding recalculated', 'success');
                    await loadPMTransactions();
                    await loadPMHoldings();
                    await loadDashboard();
                } catch (err) { showToast(err.message, 'error'); }
            });
        });
    } catch (err) { showToast('Failed to load transactions: ' + err.message, 'error'); }
}

export function initTxForm() {
    const form = g('tx-form');
    if (!form) return;
    fs('tx-date', new Date().toISOString().split('T')[0]);
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const ticker = fv('tx-ticker').trim().toUpperCase();
        const type = fv('tx-type');
        const qty = fv('tx-qty');
        const price = fv('tx-price');
        const fees = fv('tx-fees');
        const date = fv('tx-date');
        if (!ticker || !qty || !price || !date) { showToast('Fill in all required fields', 'error'); return; }
        try {
            await api.recordTransaction(ticker, type, qty, price, fees, date, null);
            showToast(`${type === 'buy' ? 'Bought' : 'Sold'} ${fmtNum(qty)} ${ticker} @ ${fmtCurrency(price)}`, 'success');
            fs('tx-ticker', ''); fs('tx-qty', ''); fs('tx-price', ''); fs('tx-fees', '0');
            await loadPMTransactions();
            await loadPMHoldings();
            await loadDashboard();
        } catch (err) { showToast(err.message, 'error'); }
    });
}
