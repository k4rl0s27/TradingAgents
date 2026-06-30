/**
 * Analysis tab logic — Run new analyses + view history/detail.
 * Uses @material/web components.
 */

import * as api from './api.js';
import { fmtCurrency, esc, showToast, setStatus } from './portfolio.js';

function g(id) { return document.getElementById(id); }
function fv(id) { const el = g(id); return el ? el.value : ''; }
function fs(id, v) { const el = g(id); if (el) el.value = v; }

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
                <span class="result-agent">${esc(item.agent_name.replace(/_/g, ' '))}</span>
                <span class="result-type">${esc(item.output_type.replace(/_/g, ' '))}</span>
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

export async function loadHistory(page = 1) {
    const tickerF = fv('hist-ticker-filter').trim();
    const typeF = fv('hist-type-filter');
    try {
        const data = await api.getAnalysisHistory(page, 20, tickerF, typeF);
        renderHistoryTable(data);
        renderPagination(data);
    } catch (err) { showToast('Failed to load history: ' + err.message, 'error'); }
}

function renderHistoryTable(data) {
    const tbody = g('hist-tbody');
    tbody.innerHTML = '';
    if (!data.items?.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--md-sys-color-on-surface-variant)">No analyses found</td></tr>';
        return;
    }
    for (const run of data.items) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${esc(run.analysis_date)}</td>
            <td><strong>${esc(run.ticker)}</strong></td>
            <td>${esc(run.analysis_type)}</td>
            <td>${run.rating ? `<span class="rating-pill rating-${run.rating.toLowerCase()}">${esc(run.rating)}</span>` : '--'}</td>
            <td><span class="status-chip ${run.status}">${esc(run.status)}</span></td>
            <td><md-text-button class="view-detail-btn" data-id="${run.id}"><md-icon slot="icon">visibility</md-icon>View</md-text-button></td>`;
        tbody.appendChild(row);
    }
    tbody.querySelectorAll('.view-detail-btn').forEach(btn =>
        btn.addEventListener('click', () => openDetail(btn.dataset.id)));
}

function renderPagination(data) {
    const el = g('hist-pagination');
    const total = Math.ceil(data.total / data.per_page) || 1;
    el.innerHTML = '';
    if (total <= 1) return;

    const prev = document.createElement('md-outlined-button');
    prev.textContent = 'Previous';
    prev.disabled = data.page <= 1;
    prev.addEventListener('click', () => loadHistory(data.page - 1));
    el.appendChild(prev);

    const span = document.createElement('span');
    span.textContent = `Page ${data.page} of ${total}`;
    span.style.margin = '0 16px';
    el.appendChild(span);

    const next = document.createElement('md-outlined-button');
    next.textContent = 'Next';
    next.disabled = data.page >= total;
    next.addEventListener('click', () => loadHistory(data.page + 1));
    el.appendChild(next);
}

export function initHistoryTab() {
    g('hist-refresh').addEventListener('click', () => loadHistory());
    g('hist-ticker-filter').addEventListener('input', () => loadHistory());
    g('hist-type-filter').addEventListener('change', () => loadHistory());
    g('detail-close-btn').addEventListener('click', () => g('detail-dialog').close());
}

async function openDetail(runId) {
    try {
        const detail = await api.getAnalysisDetail(runId);
        g('detail-title').textContent = `${detail.run.ticker} — ${detail.run.analysis_date}`;

        let html = `<div style="margin-bottom:16px">
            <strong>Rating:</strong> <span class="rating-pill rating-${(detail.run.rating||'unknown').toLowerCase()}">${esc(detail.run.rating||'Unknown')}</span>
            <span style="margin-left:16px"><strong>Type:</strong> ${esc(detail.run.analysis_type)}</span>
            <span style="margin-left:16px"><strong>Status:</strong> ${esc(detail.run.status)}</span>
        </div>`;
        for (const item of detail.results) {
            html += `<div class="result-card" style="margin-bottom:12px">
                <div class="result-card-head"><span class="result-agent">${esc(item.agent_name.replace(/_/g,' '))}</span><span class="result-type">${esc(item.output_type.replace(/_/g,' '))}</span></div>
                <div class="result-body">${item.content}</div></div>`;
        }
        g('detail-body').innerHTML = html;
        g('detail-dialog').show();
    } catch (err) { showToast('Failed to load analysis detail', 'error'); }
}
