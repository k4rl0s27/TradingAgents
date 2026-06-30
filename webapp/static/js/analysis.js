/**
 * Analysis tab logic — Run new analyses + view history/detail.
 * No framework dependencies. Uses patterns from ui-reference/app.js.
 */

import * as api from './api.js';
import { fmtCurrency, fmtNum } from './portfolio.js';
import { showToast, setStatus } from './app.js';

function g(id) { return document.getElementById(id); }
function fv(id) { const el = g(id); return el ? el.value : ''; }
function fs(id, v) { const el = g(id); if (el) el.value = v; }
function escHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

// ═══════════════════════════════════════════════════════════════════════════
// New Analysis
// ═══════════════════════════════════════════════════════════════════════════

export function initAnalysisForm() {
    g('analysis-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const ticker = fv('an-ticker').trim().toUpperCase();
        const analysisType = fv('an-type');
        const analysisDate = fv('an-date');
        if (!ticker || !analysisDate) { showToast('Fill in ticker and date', 'error'); return; }

        const submitBtn = g('an-submit');
        const progress = g('an-progress');
        const results = g('an-results');
        const progText = g('an-progress-text');
        const progStatus = g('an-progress-status');

        submitBtn.disabled = true;
        progress.classList.remove('hidden');
        results.classList.add('hidden');
        setStatus('running');

        try {
            const run = await api.runAnalysis(ticker, analysisDate, analysisType);
            progText.textContent = `Analysis started for ${ticker}...`;
            progStatus.textContent = `Run #${run.id} — waiting for completion...`;
            await poll(run.id, progText, progStatus);
            const detail = await api.getAnalysisDetail(run.id);
            renderResults(detail, ticker);
            setStatus('completed');
            showToast(`${ticker} analysis complete — ${detail.run.rating || 'done'}`, 'success');
        } catch (err) {
            progText.textContent = 'Analysis failed';
            progStatus.textContent = err.message;
            setStatus('failed');
            showToast(err.message, 'error');
        } finally {
            submitBtn.disabled = false;
        }
    });

    // Set default date
    fs('an-date', new Date().toISOString().split('T')[0]);
}

async function poll(runId, progText, progStatus) {
    for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 5000));
        try {
            const s = await api.getAnalysisStatus(runId);
            progStatus.textContent = `Run #${runId} — ${s.status} (poll ${i + 1}/120)`;
            if (s.status === 'completed') { progText.textContent = 'Complete — loading results...'; return; }
            if (s.status === 'failed') throw new Error(s.error_message || 'Analysis failed');
        } catch (err) {
            if (err.message.includes('failed') || err.message.includes('not found')) throw err;
            progStatus.textContent = `Retrying... ${err.message}`;
        }
    }
    throw new Error('Analysis timed out');
}

function renderResults(detail, ticker) {
    g('an-result-ticker').textContent = `${ticker} — Results`;
    const r = detail.run.rating || 'Unknown';
    const pill = g('an-result-rating');
    pill.textContent = r;
    pill.className = `rating-pill rating-${r.toLowerCase()}`;

    const grid = g('an-result-grid');
    grid.innerHTML = '';
    for (const item of detail.results) {
        const card = document.createElement('div');
        card.className = 'result-card';
        card.innerHTML = `
            <div class="result-card-head">
                <span class="result-agent">${escHtml(item.agent_name.replace(/_/g, ' '))}</span>
                <span class="result-type">${escHtml(item.output_type.replace(/_/g, ' '))}</span>
            </div>
            <div class="result-body">${item.content}</div>`;
        grid.appendChild(card);
    }
    g('an-results').classList.remove('hidden');
    g('an-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ═══════════════════════════════════════════════════════════════════════════
// History
// ═══════════════════════════════════════════════════════════════════════════

let historyPage = 1;

export async function loadHistory(page = 1) {
    historyPage = page;
    const tickerF = fv('hist-ticker').trim();
    const typeF = fv('hist-type');
    try {
        const data = await api.getAnalysisHistory(page, 20, tickerF, typeF);
        renderHistoryTable(data);
        renderHistoryPagination(data);
    } catch (err) { showToast('Failed to load history: ' + err.message, 'error'); }
}

function renderHistoryTable(data) {
    const tbody = g('history-tbody');
    tbody.innerHTML = '';
    if (!data.items?.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No analyses found.</td></tr>';
        return;
    }
    for (const run of data.items) {
        const rating = run.rating || 'Unknown';
        const dateStr = run.analysis_date || '--';
        const createdStr = run.created_at ? new Date(run.created_at + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '--';
        const tr = document.createElement('tr');
        tr.className = 'clickable';
        tr.innerHTML = `
            <td>#${run.id}</td>
            <td><strong>${escHtml(run.ticker)}</strong></td>
            <td>${dateStr}</td>
            <td><span class="rating-pill rating-${rating.toLowerCase()}">${escHtml(rating)}</span></td>
            <td><span class="status-chip ${run.status}">${escHtml(run.status)}</span></td>
            <td>${createdStr}</td>
            <td><span class="material-symbols-outlined" style="font-size:18px;color:var(--text-muted)">chevron_right</span></td>`;
        tr.addEventListener('click', () => openDetailDrawer(run.id));
        tbody.appendChild(tr);
    }
}

function renderHistoryPagination(data) {
    const el = g('history-pagination');
    const total = Math.ceil(data.total / data.per_page) || 1;
    el.innerHTML = '';
    if (total <= 1) return;

    let html = '';
    html += `<button ${data.page <= 1 ? 'disabled' : ''} onclick="window._loadHistoryPage(${data.page - 1})">← Prev</button>`;

    const maxButtons = 7;
    let start = Math.max(1, data.page - Math.floor(maxButtons / 2));
    let end = Math.min(total, start + maxButtons - 1);
    if (end - start < maxButtons - 1) start = Math.max(1, end - maxButtons + 1);

    for (let i = start; i <= end; i++) {
        html += `<button class="${i === data.page ? 'active' : ''}" onclick="window._loadHistoryPage(${i})">${i}</button>`;
    }

    html += `<button ${data.page >= total ? 'disabled' : ''} onclick="window._loadHistoryPage(${data.page + 1})">Next →</button>`;
    html += `<span class="page-info">${data.page} of ${total}</span>`;
    el.innerHTML = html;
}

export function initHistoryTab() {
    const tickerFilter = g('hist-ticker');
    const typeFilter = g('hist-type');
    if (tickerFilter) {
        let timeout;
        tickerFilter.addEventListener('input', () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => loadHistory(1), 300);
        });
    }
    if (typeFilter) {
        typeFilter.addEventListener('change', () => loadHistory(1));
    }
    // Expose for onclick pagination and refresh button
    window._loadHistoryPage = (page) => loadHistory(page);
    window.loadHistory = (page) => loadHistory(page);
}

// ═══════════════════════════════════════════════════════════════════════════
// Detail Drawer
// ═══════════════════════════════════════════════════════════════════════════

export function openDetailDrawer(runId) {
    loadDetailIntoDrawer(runId);
}

export function closeDetailDrawer() {
    g('detailDrawer').classList.remove('open');
    g('detailDrawerOverlay').classList.remove('open');
    document.body.classList.remove('drawer-open');
}

// Expose for keyboard shortcut in app.js
window.closeDetailDrawer = closeDetailDrawer;

async function loadDetailIntoDrawer(runId) {
    try {
        const detail = await api.getAnalysisDetail(runId);
        g('detailDrawerTitle').textContent = `${detail.run.ticker} — ${detail.run.analysis_date}`;

        const rating = detail.run.rating || 'Unknown';
        let html = `<div class="detail-section">
            <h3>Summary</h3>
            <div class="detail-row"><span class="detail-label">Rating</span><span class="detail-value"><span class="rating-pill rating-${rating.toLowerCase()}">${escHtml(rating)}</span></span></div>
            <div class="detail-row"><span class="detail-label">Type</span><span class="detail-value">${escHtml(detail.run.analysis_type)}</span></div>
            <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">${escHtml(detail.run.status)}</span></div>
            <div class="detail-row"><span class="detail-label">Date</span><span class="detail-value">${escHtml(detail.run.analysis_date)}</span></div>
            ${detail.run.entry_price ? `<div class="detail-row"><span class="detail-label">Entry Price</span><span class="detail-value">${fmtCurrency(detail.run.entry_price)}</span></div>` : ''}
            ${detail.run.stop_loss ? `<div class="detail-row"><span class="detail-label">Stop Loss</span><span class="detail-value">${fmtCurrency(detail.run.stop_loss)}</span></div>` : ''}
            ${detail.run.position_sizing ? `<div class="detail-row"><span class="detail-label">Position Sizing</span><span class="detail-value">${escHtml(detail.run.position_sizing)}</span></div>` : ''}
            ${detail.run.error_message ? `<div class="detail-row"><span class="detail-label">Error</span><span class="detail-value" style="color:var(--danger)">${escHtml(detail.run.error_message)}</span></div>` : ''}
        </div>`;

        html += `<div class="detail-section"><h3>Agent Outputs</h3>`;
        for (const item of (detail.results || [])) {
            html += `<div class="result-card" style="margin-bottom:12px">
                <div class="result-card-head">
                    <span class="result-agent">${escHtml(item.agent_name.replace(/_/g, ' '))}</span>
                    <span class="result-type">${escHtml(item.output_type.replace(/_/g, ' '))}</span>
                </div>
                <div class="result-body">${item.content}</div>
            </div>`;
        }
        html += `</div>`;

        g('detailDrawerBody').innerHTML = html;
        g('detailDrawer').classList.add('open');
        g('detailDrawerOverlay').classList.add('open');
        document.body.classList.add('drawer-open');
    } catch (err) { showToast('Failed to load analysis detail: ' + err.message, 'error'); }
}
