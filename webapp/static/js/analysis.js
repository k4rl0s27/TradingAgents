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
        const analysisDepth = fv('an-depth');
        const analysisDate = fv('an-date');
        if (!ticker || !analysisDate) { showToast('Fill in ticker and date', 'error'); return; }

        const submitBtn = g('an-submit');
        const progress = g('an-progress');
        const results = g('an-results');
        const progText = g('an-progress-text');
        const progStatus = g('an-progress-status');
        const resultGrid = g('an-result-grid');

        submitBtn.disabled = true;
        progress.classList.remove('hidden');
        results.classList.add('hidden');
        resultGrid.innerHTML = '';
        setStatus('running');
        g('an-result-ticker').textContent = `${ticker}`;
        g('an-result-rating').textContent = '';
        g('an-result-rating').className = 'rating-pill';
        results.classList.remove('hidden');
        resultGrid.innerHTML = '';

        let agentCount = 0;
        let currentEs = null;

        function connectStream(runId) {
            if (currentEs) currentEs.close();
            const es = new EventSource(`/api/analysis/stream/${runId}`);
            currentEs = es;

            es.addEventListener('agent', (evt) => {
                const data = JSON.parse(evt.data);
                agentCount = data.index;
                progText.textContent = `${ticker} — ${data.agent_name} completed`;
                progStatus.textContent = `Agent ${agentCount} of ~9 done`;
            });

            es.addEventListener('status', (evt) => {
                const data = JSON.parse(evt.data);
                progStatus.textContent = data.content.substring(0, 120);
            });

            es.addEventListener('complete', (evt) => {
                es.close();
                currentEs = null;
                const data = JSON.parse(evt.data);
                const rating = data.rating || 'Unknown';
                g('an-result-rating').textContent = rating;
                g('an-result-rating').className = `rating-pill rating-${rating.toLowerCase()}`;
                progText.textContent = 'Analysis complete';
                progStatus.textContent = `${agentCount} agents finished`;
                progress.classList.add('hidden');
                setStatus('completed');
                submitBtn.disabled = false;
                showToast(`${ticker} analysis complete — ${rating}`, 'success');
                window.loadHistory && window.loadHistory(1);
            });

            es.addEventListener('error', (evt) => {
                es.close();
                currentEs = null;
                let errMsg = 'Analysis failed';
                try { const d = JSON.parse(evt.data); errMsg = d.error || errMsg; } catch (_) {}
                progText.textContent = 'Analysis failed';
                progStatus.textContent = errMsg;
                setStatus('failed');
                submitBtn.disabled = false;
                showToast(errMsg, 'error');
            });

            es.onerror = () => {
                if (!submitBtn.disabled) return;
                es.close();
                currentEs = null;
            };

            return es;
        }

        try {
            // Start the analysis
            const run = await api.runAnalysis(ticker, analysisDate, analysisType, analysisDepth);
            progText.textContent = `Analysis started for ${ticker}...`;
            progStatus.textContent = `Run #${run.id} — streaming...`;
            currentEs = connectStream(run.id);

        } catch (err) {
            progText.textContent = 'Analysis failed to start';
            progStatus.textContent = err.message;
            setStatus('failed');
            submitBtn.disabled = false;
            showToast(err.message, 'error');
            progress.classList.add('hidden');
        }
    });

    // Set default date
    fs('an-date', new Date().toISOString().split('T')[0]);

    // Init chip groups
    initChipGroup('an-depth-group', 'an-depth');
    initChipGroup('an-type-group', 'an-type');
}

function initChipGroup(groupId, inputId) {
    const group = g(groupId);
    if (!group) return;
    group.querySelectorAll('.chip:not([disabled])').forEach(chip => {
        chip.addEventListener('click', () => {
            group.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            g(inputId).value = chip.dataset.value;
        });
    });
}

function setChipValue(groupId, inputId, value) {
    const group = g(groupId);
    if (!group) return;
    group.querySelectorAll('.chip').forEach(c => {
        c.classList.toggle('active', c.dataset.value === value);
    });
    g(inputId).value = value;
}

// Reconnect to running analyses on page load
export async function reconnectRunningAnalysis() {
    try {
        const resp = await fetch('/api/analysis/running');
        const data = await resp.json();
        if (!data.running || !data.running.length) return;

        const run = data.running[0]; // latest running analysis
        const submitBtn = g('an-submit');
        const progress = g('an-progress');
        const results = g('an-results');
        const progText = g('an-progress-text');
        const progStatus = g('an-progress-status');
        const resultGrid = g('an-result-grid');

        g('an-ticker').value = run.ticker;
        g('an-date').value = run.analysis_date;
        setChipValue('an-depth-group', 'an-depth', run.analysis_depth || 'medium');
        setChipValue('an-type-group', 'an-type', run.analysis_type || 'regular');
        submitBtn.disabled = true;
        progress.classList.remove('hidden');
        results.classList.remove('hidden');
        resultGrid.innerHTML = '';
        g('an-result-ticker').textContent = run.ticker;
        g('an-result-rating').textContent = '';
        g('an-result-rating').className = 'rating-pill';
        setStatus('running');
        progText.textContent = `Reconnected — ${run.ticker} analysis in progress...`;
        progStatus.textContent = `Run #${run.id} — resuming stream`;

        let agentCount = 0;
        const es = new EventSource(`/api/analysis/stream/${run.id}`);
        es.addEventListener('agent', (evt) => {
            const d = JSON.parse(evt.data);
            agentCount = d.index;
            progText.textContent = `${run.ticker} — ${d.agent_name} completed`;
            progStatus.textContent = `Agent ${agentCount} of ~9 done`;
        });
        es.addEventListener('status', (evt) => {
            const d = JSON.parse(evt.data);
            progStatus.textContent = d.content.substring(0, 120);
        });
        es.addEventListener('complete', (evt) => {
            es.close();
            const d = JSON.parse(evt.data);
            const rating = d.rating || 'Unknown';
            g('an-result-rating').textContent = rating;
            g('an-result-rating').className = `rating-pill rating-${rating.toLowerCase()}`;
            progText.textContent = 'Analysis complete';
            progStatus.textContent = `${agentCount} agents finished`;
            progress.classList.add('hidden');
            setStatus('completed');
            submitBtn.disabled = false;
            showToast(`${run.ticker} analysis complete — ${rating}`, 'success');
            window.loadHistory && window.loadHistory(1);
        });
        es.addEventListener('error', () => {
            es.close();
            progText.textContent = 'Analysis failed';
            setStatus('failed');
            submitBtn.disabled = false;
        });
        es.onerror = () => { es.close(); };
    } catch (_) { /* no running analyses */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// History
// ═══════════════════════════════════════════════════════════════════════════

let historyPage = 1;

export async function loadHistory(page = 1) {
    historyPage = page;
    const tickerF = fv('hist-ticker').trim();
    try {
        const data = await api.getAnalysisHistory(page, 20, tickerF, '');
        renderHistoryTable(data);
        renderHistoryPagination(data);
    } catch (err) { showToast('Failed to load history: ' + err.message, 'error'); }
}

function renderHistoryTable(data) {
    const tbody = g('history-tbody');
    tbody.innerHTML = '';
    if (!data.items?.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No analyses found.</td></tr>';
        return;
    }
    for (const run of data.items) {
        const rating = run.rating || 'Unknown';
        const depth = run.analysis_depth || 'medium';
        const depthIcon = { quick: 'bolt', medium: 'tune', deep: 'psychology' }[depth] || 'tune';
        const dateStr = run.analysis_date || '--';
        const createdStr = run.created_at ? new Date(run.created_at + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '--';
        const tr = document.createElement('tr');
        tr.className = 'clickable';
        tr.innerHTML = `
            <td>#${run.id}</td>
            <td><strong>${escHtml(run.ticker)}</strong></td>
            <td><span class="material-symbols-outlined" style="font-size:16px;color:var(--text-muted)">${depthIcon}</span></td>
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
    if (tickerFilter) {
        let timeout;
        tickerFilter.addEventListener('input', () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => loadHistory(1), 300);
        });
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
