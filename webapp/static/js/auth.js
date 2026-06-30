/**
 * TradingAgents — Auth module
 * Handles login state, setup wizard, and session management.
 * No framework dependencies.
 */

import { showToast } from './app.js';
import * as api from './api.js';

function g(id) { return document.getElementById(id); }
function escHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

// ═══════════════════════════════════════════════════════════════════════════
// Auth State
// ═══════════════════════════════════════════════════════════════════════════

let currentUser = null;

export function getUser() {
    return currentUser;
}

export function isAuthenticated() {
    return currentUser !== null;
}

export function isInitialized() {
    return currentUser !== null && currentUser.is_initialized;
}

// ═══════════════════════════════════════════════════════════════════════════
// Init — check auth status on page load
// ═══════════════════════════════════════════════════════════════════════════

export async function initAuth() {
    try {
        currentUser = await api.getMe();
        renderUserInfo();
        if (!currentUser.is_initialized) {
            showSetupWizard();
        }
        return true;
    } catch (err) {
        // Not authenticated — redirect to login
        if (err.message.includes('401') || err.message.includes('Not authenticated')) {
            window.location.href = '/auth/login';
            return false;
        }
        // OIDC not configured — show the app without auth
        console.warn('Auth check failed (OIDC may not be configured):', err.message);
        return true;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// User display
// ═══════════════════════════════════════════════════════════════════════════

function renderUserInfo() {
    if (!currentUser) return;
    const nameEl = g('userName');
    if (nameEl) {
        nameEl.textContent = currentUser.display_name || currentUser.email || currentUser.sub;
    }
    const chip = g('userChip');
    if (chip) chip.classList.remove('hidden');

    // Show logout button
    const logoutBtn = g('btnLogout');
    if (logoutBtn) logoutBtn.classList.remove('hidden');
}

// ═══════════════════════════════════════════════════════════════════════════
// Logout
// ═══════════════════════════════════════════════════════════════════════════

export async function logout() {
    try {
        await api.logout();
    } catch (_) {}
    window.location.href = '/auth/login';
}

// ═══════════════════════════════════════════════════════════════════════════
// Setup Wizard
// ═══════════════════════════════════════════════════════════════════════════

let providers = [];
let providerModels = {};

async function showSetupWizard() {
    // Hide the entire app chrome
    const topBar = document.querySelector('.top-bar');
    if (topBar) topBar.classList.add('hidden');
    g('view-scroll').classList.add('hidden');
    g('navSidebar').classList.add('hidden');

    // Show setup container
    const setup = g('setupWizard');
    setup.classList.remove('hidden');

    // Load providers
    try {
        const resp = await api.getProviders();
        providers = resp.providers;
        renderProviderList();
    } catch (err) {
        g('setupStep1Body').innerHTML = `<p class="error-state">Failed to load providers: ${escHtml(err.message)}</p>`;
    }
}

function renderProviderList() {
    const body = g('setupStep1Body');
    body.innerHTML = `<div class="provider-grid">
        ${providers.map(p => `
            <button class="provider-card" data-provider="${escHtml(p.key)}" onclick="window.selectProvider('${escHtml(p.key)}')">
                <span class="provider-name">${escHtml(p.display_name)}</span>
                <span class="provider-env">${p.env_var ? escHtml(p.env_var) : 'No key required'}</span>
            </button>
        `).join('')}
    </div>`;
}

window.selectProvider = async function(providerKey) {
    // Highlight selected card
    document.querySelectorAll('.provider-card').forEach(c => c.classList.remove('selected'));
    const card = document.querySelector(`[data-provider="${providerKey}"]`);
    if (card) card.classList.add('selected');

    g('setupSelectedProvider').value = providerKey;
    g('setupStep3Button').disabled = true;

    try {
        const models = await api.getProviderModels(providerKey);
        renderModelSelection(providerKey, models);

        // Expand config with computed height for smooth MD3 animation
        const config = g('setupConfig');
        config.classList.add('visible');
        config.style.maxHeight = config.scrollHeight + 'px';
        g('setupStep3Button').disabled = false;
    } catch (err) {
        showToast('Failed to load models: ' + err.message, 'error');
    }
};

function renderModelSelection(providerKey, models) {
    const deepSelect = g('setupDeepModel');
    const quickSelect = g('setupQuickModel');

    const renderOptions = (opts) =>
        opts.map(m => `<option value="${escHtml(m.value)}">${escHtml(m.display)}</option>`).join('');

    deepSelect.innerHTML = renderOptions(models.deep_models) + '<option value="custom">Custom model ID...</option>';
    quickSelect.innerHTML = renderOptions(models.quick_models) + '<option value="custom">Custom model ID...</option>';

    // Handle custom model input
    [deepSelect, quickSelect].forEach(sel => {
        sel.onchange = function() {
            if (this.value === 'custom') {
                const customInput = this.nextElementSibling;
                if (customInput && customInput.classList.contains('custom-model-input')) {
                    customInput.classList.remove('hidden');
                    customInput.focus();
                }
            }
        };
    });
}

window.submitSetup = async function() {
    const provider = g('setupSelectedProvider').value;
    const apiKey = g('setupApiKey').value;
    const deepModel = g('setupDeepModel').value === 'custom'
        ? g('setupDeepModelCustom').value.trim()
        : g('setupDeepModel').value;
    const quickModel = g('setupQuickModel').value === 'custom'
        ? g('setupQuickModelCustom').value.trim()
        : g('setupQuickModel').value;

    if (!provider) { showToast('Please select a provider', 'error'); return; }
    if (!apiKey) { showToast('Please enter your API key', 'error'); return; }

    const submitBtn = g('setupSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    try {
        await api.initializeSettings({
            llm_provider: provider,
            api_key: apiKey,
            deep_think_llm: deepModel || null,
            quick_think_llm: quickModel || null,
        });
        currentUser.is_initialized = true;
        g('setupWizard').classList.add('hidden');
        const topBar = document.querySelector('.top-bar');
        if (topBar) topBar.classList.remove('hidden');
        g('view-scroll').classList.remove('hidden');
        g('navSidebar').classList.remove('hidden');
        showToast('Setup complete! Welcome to TradingAgents.', 'success');
        // Reload the main views
        if (window.loadDashboard) window.loadDashboard();
        if (window.loadHistory) window.loadHistory(1);
        renderUserInfo();
    } catch (err) {
        showToast('Setup failed: ' + err.message, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Complete Setup';
    }
};

// Export for global access
window.selectProvider = window.selectProvider;
window.submitSetup = window.submitSetup;
