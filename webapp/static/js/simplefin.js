/**
 * TradingAgents — SimpleFIN Integration
 * Brokerage connection flow: connect → claim token → select account → sync.
 * No framework dependencies.
 */

import * as api from './api.js';
import { showToast, setStatus } from './app.js';
import { loadPortfolioManager, loadDashboard } from './portfolio.js';

// ═══════════════════════════════════════════════════════════════════════════
// DOM helpers
// ═══════════════════════════════════════════════════════════════════════════

function g(id) { return document.getElementById(id); }
function hide(...ids) { ids.forEach(id => { const el = g(id); if (el) el.classList.add('hidden'); }); }
function show(...ids) { ids.forEach(id => { const el = g(id); if (el) el.classList.remove('hidden'); }); }

// ═══════════════════════════════════════════════════════════════════════════
// State rendering
// ═══════════════════════════════════════════════════════════════════════════

export async function initSimpleFIN() {
    // Wire up the "Connect" button
    const btnConnect = g('btn-sf-connect');
    if (btnConnect) {
        btnConnect.addEventListener('click', () => showTokenInput());
    }

    // Wire up cancel / back buttons
    const btnCancel = g('btn-sf-cancel');
    if (btnCancel) {
        btnCancel.addEventListener('click', () => showDisconnected());
    }

    const btnBack = g('btn-sf-back');
    if (btnBack) {
        btnBack.addEventListener('click', () => showDisconnected());
    }

    // Wire up claim button
    const btnClaim = g('btn-sf-claim');
    if (btnClaim) {
        btnClaim.addEventListener('click', () => claimToken());
    }

    // Wire up sync button
    const btnSync = g('btn-sf-sync');
    if (btnSync) {
        btnSync.addEventListener('click', () => syncPortfolio());
    }

    // Wire up disconnect button
    const btnDisconnect = g('btn-sf-disconnect');
    if (btnDisconnect) {
        btnDisconnect.addEventListener('click', () => disconnectFlow());
    }

    // Check current connection status
    await refreshStatus();
}

async function refreshStatus() {
    try {
        const status = await api.simplefinStatus();
        if (status.connected && status.linked_account) {
            renderConnected(status.linked_account);
        } else if (status.connected) {
            // Connected but no account linked yet — should be rare
            showDisconnected();
        } else {
            showDisconnected();
        }
    } catch {
        // API not available or error — show disconnected state
        showDisconnected();
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// View states
// ═══════════════════════════════════════════════════════════════════════════

function showDisconnected() {
    hide('sf-token-input', 'sf-account-select', 'sf-connected', 'sf-error',
         'sf-claim-progress', 'sf-link-progress', 'sf-sync-progress');
    show('sf-disconnected');
}

function showTokenInput() {
    hide('sf-disconnected', 'sf-account-select', 'sf-connected', 'sf-error',
         'sf-claim-progress', 'sf-link-progress', 'sf-sync-progress');
    show('sf-token-input');
    const textarea = g('sf-token');
    if (textarea) { textarea.value = ''; textarea.focus(); }
}

function showAccountSelection(accounts) {
    hide('sf-disconnected', 'sf-token-input', 'sf-connected', 'sf-error',
         'sf-claim-progress', 'sf-link-progress', 'sf-sync-progress');
    show('sf-account-select');

    const list = g('sf-account-list');
    list.innerHTML = accounts.map(a => `
        <div class="sf-account-option" data-account-id="${escAttr(a.account_id)}"
             data-account-name="${escAttr(a.name)}"
             data-org-name="${escAttr(a.org_name || '')}"
             data-org-domain="${escAttr(a.org_domain || '')}">
            <span class="material-symbols-outlined">account_balance</span>
            <div>
                <div class="sf-account-option-name">${escHtml(a.name)}</div>
                <div class="sf-account-option-org">${escHtml(a.org_name || a.org_domain || '—')}</div>
            </div>
        </div>
    `).join('');

    // Wire up click handlers
    list.querySelectorAll('.sf-account-option').forEach(card => {
        card.addEventListener('click', async () => {
            await linkAccount(
                card.dataset.accountId,
                card.dataset.accountName,
                card.dataset.orgName,
                card.dataset.orgDomain
            );
        });
    });
}

function renderConnected(linked) {
    hide('sf-disconnected', 'sf-token-input', 'sf-account-select', 'sf-error',
         'sf-claim-progress', 'sf-link-progress', 'sf-sync-progress');
    show('sf-connected');

    g('sf-account-name').textContent = linked.name || linked.account_name || '—';
    g('sf-account-org').textContent = linked.org_name || linked.org_domain || '—';

    updateLastSync(linked.last_synced_at);
}

function updateLastSync(lastSyncedAt) {
    const el = g('sf-last-sync');
    if (!lastSyncedAt) {
        el.textContent = 'Never synced';
        return;
    }
    const dt = new Date(lastSyncedAt);
    const now = new Date();
    const diffMs = now - dt;
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) el.textContent = 'Just now';
    else if (diffMin < 60) el.textContent = `${diffMin} min ago`;
    else if (diffMin < 1440) el.textContent = `${Math.floor(diffMin / 60)} hr ago`;
    else el.textContent = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ═══════════════════════════════════════════════════════════════════════════
// Actions
// ═══════════════════════════════════════════════════════════════════════════

async function claimToken() {
    const token = g('sf-token').value.trim();
    if (!token) {
        showToast('Please paste your SimpleFIN token.', 'error');
        return;
    }

    hide('sf-error');
    show('sf-claim-progress');
    const btn = g('btn-sf-claim');
    if (btn) btn.disabled = true;

    try {
        const result = await api.simplefinConnect(token);
        if (!result.accounts || result.accounts.length === 0) {
            throw new Error('No accounts found. Make sure your SimpleFIN token includes connected institutions.');
        }
        showAccountSelection(result.accounts);
    } catch (err) {
        showError(err.message);
        showDisconnected();
    } finally {
        hide('sf-claim-progress');
        if (btn) btn.disabled = false;
    }
}

async function linkAccount(accountId, accountName, orgName, orgDomain) {
    hide('sf-error');
    show('sf-link-progress');

    try {
        await api.simplefinLink(accountId, accountName, orgName, orgDomain);
        showToast(`Linked to ${accountName}`, 'success');

        // Immediately show connected state with the account info we have
        renderConnected({ name: accountName, org_name: orgName, org_domain: orgDomain });

        // Run initial sync (will update last-sync timestamp)
        await syncPortfolio();
    } catch (err) {
        showError(err.message);
    } finally {
        hide('sf-link-progress');
    }
}

async function syncPortfolio() {
    hide('sf-error');
    show('sf-sync-progress');
    g('sf-sync-text').textContent = 'Syncing portfolio data...';
    const btn = g('btn-sf-sync');
    if (btn) {
        btn.disabled = true;
        btn.classList.add('refreshing');
    }
    setStatus('running');

    try {
        const result = await api.simplefinSync();
        showToast(
            `Synced ${result.holdings_synced} holdings, ${result.transactions_synced} transactions`,
            'success'
        );

        // Refresh portfolio data across all views
        await loadPortfolioManager();
        await loadDashboard();

        // Update last-sync display
        updateLastSync(result.last_synced_at);

        setStatus('idle');
    } catch (err) {
        showError(err.message);
        setStatus('failed');
    } finally {
        hide('sf-sync-progress');
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('refreshing');
        }
    }
}

async function disconnectFlow() {
    if (!confirm('Disconnect your SimpleFIN brokerage link? Your synced holdings and transactions will remain in the database.')) {
        return;
    }

    try {
        await api.simplefinDisconnect();
        showToast('SimpleFIN connection removed.', 'info');
        showDisconnected();
        await loadDashboard();
    } catch (err) {
        showError(err.message);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function showError(message) {
    const el = g('sf-error');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
}

function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

function escAttr(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
