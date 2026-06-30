/**
 * Portfolio tab logic — Dashboard + Portfolio Manager (full CRUD).
 * Uses @material/web components: access values via .value property.
 */

import * as api from './api.js';

let allocationChart = null;

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

export const fmtCurrency = (v) => (v == null || isNaN(v)) ? '--' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtNum = (v) => (v == null || isNaN(v)) ? '--' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
export const esc = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };

export function showToast(message, type = '') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;
    void toast.offsetHeight;
    toast.classList.remove('hidden');
    toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.classList.add('hidden'); toast.classList.remove('show'); }, 3000);
}

export function setStatus(status) {
    const el = document.getElementById('app-status');
    el.className = `status-chip ${status}`;
    const labels = { idle: 'Ready', running: 'Analyzing...', completed: 'Complete', failed: 'Error' };
    el.textContent = labels[status] || status;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
    document.getElementById('sum-total').textContent = fmtCurrency(s.total_value);
    document.getElementById('sum-cash').textContent = fmtCurrency(s.cash);
    document.getElementById('sum-holdings').textContent = fmtCurrency(s.holdings_value);
    document.getElementById('sum-positions').textContent = s.holdings.length;
}

function renderHoldingsTable(holdings, totalValue) {
    const tbody = document.getElementById('holdings-tbody');
    const empty = document.getElementById('holdings-empty');
    tbody.innerHTML = '';
    if (!holdings.length) { empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    for (const h of holdings) {
        const val = h.quantity * (h.avg_cost || 0);
        const w = totalValue > 0 ? (val / totalValue * 100).toFixed(1) : '0.0';
        tbody.innerHTML += `<tr>
            <td><strong>${esc(h.ticker)}</strong></td>
            <td class="num">${fmtNum(h.quantity)}</td>
            <td class="num">${h.avg_cost ? fmtCurrency(h.avg_cost) : '--'}</td>
            <td class="num">${fmtCurrency(val)}</td>
            <td class="num">${w}%</td></tr>`;
    }
}

function renderAllocationChart(holdings, totalValue, cash) {
    const canvas = document.getElementById('allocation-chart');
    const empty = document.getElementById('chart-empty');
    if (allocationChart) { allocationChart.destroy(); allocationChart = null; }

    const segs = [], labels = [];
    const colors = ['#D0BCFF','#7ADDA0','#FFB4AB','#A8C7FA','#FFD699','#CCC2DC','#B4E5F9','#F2B8B5','#C5E1A5','#FFE082'];
    if (cash > 0) { segs.push(cash); labels.push('Cash'); }
    for (const h of holdings) {
        const v = h.quantity * (h.avg_cost || 0);
        if (v > 0) { segs.push(v); labels.push(h.ticker); }
    }
    if (!segs.length) { canvas.style.display = 'none'; empty.classList.remove('hidden'); return; }
    canvas.style.display = 'block'; empty.classList.add('hidden');

    allocationChart = new Chart(canvas, {
        type: 'doughnut',
        data: { labels, datasets: [{ data: segs, backgroundColor: colors.slice(0, segs.length), borderColor: '#211F26', borderWidth: 2 }] },
        options: {
            responsive: true, maintainAspectRatio: true,
            plugins: { legend: { position: 'right', labels: { color: '#CAC4D0', padding: 16, font: { size: 12 }, usePointStyle: true, pointStyleWidth: 8 } } },
        },
    });
}

function renderDashboardTransactions(txs) {
    const tbody = document.getElementById('tx-tbody');
    const empty = document.getElementById('tx-empty');
    tbody.innerHTML = '';
    if (!txs || !txs.length) { empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    for (const tx of txs) {
        const isBuy = tx.transaction_type === 'buy';
        tbody.innerHTML += `<tr>
            <td>${esc(tx.date)}</td>
            <td class="num ${isBuy ? 'pos' : 'neg'}">${isBuy ? 'Buy' : 'Sell'}</td>
            <td><strong>${esc(tx.ticker)}</strong></td>
            <td class="num">${fmtNum(tx.quantity)}</td>
            <td class="num">${fmtCurrency(tx.price)}</td>
            <td class="num ${isBuy ? 'neg' : 'pos'}">${isBuy ? '-' : '+'}${fmtCurrency(tx.total_amount)}</td></tr>`;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Portfolio Manager
// ═══════════════════════════════════════════════════════════════════════════

function getField(id) { return document.getElementById(id); }
function fieldVal(id) { const el = getField(id); return el ? el.value : ''; }
function setField(id, v) { const el = getField(id); if (el) el.value = v; }

export async function loadPortfolioManager() {
    await Promise.all([loadHoldingsList(), loadTransactionsList(), loadCashDisplay()]);
}

// ── Cash ──────────────────────────────────────────────────────────────────

async function loadCashDisplay() {
    try {
        const history = await api.getCashHistory();
        const latest = history[0];
        getField('cash-display').textContent = latest ? fmtCurrency(latest.amount) : '$0.00';
        getField('c-date').value = new Date().toISOString().split('T')[0];
    } catch (e) { /* ignore */ }
}

export function initCashForm() {
    getField('cash-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await api.setCashBalance(fieldVal('c-amount'), fieldVal('c-date'));
            showToast('Cash balance updated', 'success');
            await loadCashDisplay();
            await loadDashboard();
        } catch (err) { showToast(err.message, 'error'); }
    });
}

// ── Holdings CRUD ─────────────────────────────────────────────────────────

let editingHoldingId = null;

export async function loadHoldingsList() {
    try {
        const holdings = await api.getHoldings();
        const tbody = getField('holdings-list-tbody');
        const empty = getField('holdings-list-empty');
        tbody.innerHTML = '';
        if (!holdings.length) { empty.classList.remove('hidden'); return; }
        empty.classList.add('hidden');

        for (const h of holdings) {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><strong>${esc(h.ticker)}</strong></td>
                <td class="num">${fmtNum(h.quantity)}</td>
                <td class="num">${h.avg_cost ? fmtCurrency(h.avg_cost) : '--'}</td>
                <td>${esc(h.sector || '--')}</td>
                <td>
                    <md-text-button class="edit-holding-btn" data-id="${h.id}" data-ticker="${esc(h.ticker)}" data-qty="${h.quantity}" data-cost="${h.avg_cost || ''}" data-sector="${esc(h.sector || '')}">
                        <md-icon slot="icon">edit</md-icon>Edit
                    </md-text-button>
                    <md-text-button class="del-holding-btn" data-id="${h.id}" data-ticker="${esc(h.ticker)}" style="--md-text-button-label-text-color:var(--color-bearish)">
                        <md-icon slot="icon">delete</md-icon>Delete
                    </md-text-button>
                </td>`;
            tbody.appendChild(row);
        }

        // Attach handlers (MWC button clicks bubble normally)
        tbody.querySelectorAll('.edit-holding-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                editingHoldingId = btn.dataset.id;
                setField('h-id', btn.dataset.id);
                setField('h-ticker', btn.dataset.ticker);
                setField('h-qty', btn.dataset.qty);
                setField('h-cost', btn.dataset.cost);
                setField('h-sector', btn.dataset.sector);
                getField('holding-edit-title').textContent = `Edit ${btn.dataset.ticker}`;
                getField('h-submit-label').textContent = 'Update Holding';
                getField('holding-edit-panel').classList.remove('hidden');
            });
        });

        tbody.querySelectorAll('.del-holding-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm(`Delete holding ${btn.dataset.ticker}? This cannot be undone.`)) return;
                try {
                    await api.deleteHolding(Number(btn.dataset.id));
                    showToast(`Deleted ${btn.dataset.ticker}`, 'success');
                    await loadHoldingsList();
                    await loadDashboard();
                } catch (err) { showToast(err.message, 'error'); }
            });
        });

    } catch (err) { showToast('Failed to load holdings: ' + err.message, 'error'); }
}

export function initHoldingForm() {
    // Show add panel
    getField('btn-add-holding').addEventListener('click', () => {
        editingHoldingId = null;
        setField('h-id', '');
        setField('h-ticker', '');
        setField('h-qty', '');
        setField('h-cost', '');
        setField('h-sector', '');
        getField('holding-edit-title').textContent = 'Add Holding';
        getField('h-submit-label').textContent = 'Save Holding';
        getField('holding-edit-panel').classList.remove('hidden');
    });

    // Cancel button
    getField('h-cancel-btn').addEventListener('click', () => {
        getField('holding-edit-panel').classList.add('hidden');
        editingHoldingId = null;
    });

    // Submit form
    getField('holding-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const ticker = fieldVal('h-ticker').trim();
        const qty = fieldVal('h-qty');
        const cost = fieldVal('h-cost');
        const sector = fieldVal('h-sector').trim();

        try {
            if (editingHoldingId) {
                await api.updateHolding(Number(editingHoldingId), ticker, qty, cost, sector);
                showToast(`Updated ${ticker.toUpperCase()}`, 'success');
            } else {
                await api.addHolding(ticker, qty, cost, sector);
                showToast(`Added ${ticker.toUpperCase()}`, 'success');
            }
            getField('holding-edit-panel').classList.add('hidden');
            editingHoldingId = null;
            await loadHoldingsList();
            await loadDashboard();
        } catch (err) { showToast(err.message, 'error'); }
    });
}

// ── Transactions ──────────────────────────────────────────────────────────

async function loadTransactionsList() {
    try {
        const txs = await api.getTransactions();
        const tbody = getField('tx-list-tbody');
        const empty = getField('tx-list-empty');
        tbody.innerHTML = '';
        if (!txs || !txs.length) { empty.classList.remove('hidden'); return; }
        empty.classList.add('hidden');

        for (const tx of txs) {
            const isBuy = tx.transaction_type === 'buy';
            tbody.innerHTML += `<tr>
                <td>${esc(tx.date)}</td>
                <td class="${isBuy ? 'pos' : 'neg'}">${isBuy ? 'Buy' : 'Sell'}</td>
                <td><strong>${esc(tx.ticker)}</strong></td>
                <td class="num">${fmtNum(tx.quantity)}</td>
                <td class="num">${fmtCurrency(tx.price)}</td>
                <td class="num">${fmtCurrency(tx.fees)}</td>
                <td class="num ${isBuy ? 'neg' : 'pos'}">${isBuy ? '-' : '+'}${fmtCurrency(tx.total_amount)}</td>
                <td>${esc(tx.notes || '')}</td>
                <td><md-text-button class="del-tx-btn" data-id="${tx.id}" data-ticker="${esc(tx.ticker)}" style="--md-text-button-label-text-color:var(--color-bearish)"><md-icon slot="icon">delete</md-icon></md-text-button></td></tr>`;
        }

        // Attach delete handlers
        tbody.querySelectorAll('.del-tx-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm(`Delete ${btn.dataset.ticker} transaction? Holding will be recalculated.`)) return;
                try {
                    await api.deleteTransaction(Number(btn.dataset.id));
                    showToast('Transaction deleted', 'success');
                    await loadTransactionsList();
                    await loadHoldingsList();
                    await loadDashboard();
                } catch (err) { showToast(err.message, 'error'); }
            });
        });
    } catch (err) { /* ignore */ }
}

export function initTxForm() {
    getField('tx-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await api.recordTransaction(
                fieldVal('tx-ticker').trim(),
                fieldVal('tx-type'),
                fieldVal('tx-qty'),
                fieldVal('tx-price'),
                fieldVal('tx-fees'),
                fieldVal('tx-date'),
                fieldVal('tx-notes').trim(),
            );
            showToast('Transaction recorded', 'success');
            // Reset only the variable fields
            setField('tx-qty', '0');
            setField('tx-price', '0');
            setField('tx-fees', '0');
            setField('tx-notes', '');
            await loadTransactionsList();
            await loadHoldingsList();
            await loadDashboard();
        } catch (err) { showToast(err.message, 'error'); }
    });

    // Default dates
    const today = new Date().toISOString().split('T')[0];
    setField('tx-date', today);
    setField('c-date', today);
    getField('an-date') && setField('an-date', today);
}
