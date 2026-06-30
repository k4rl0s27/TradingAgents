/**
 * Main app — tab routing with <md-tabs>, initialization.
 */

import { loadDashboard, initCashForm, initHoldingForm, initTxForm, loadPortfolioManager } from './portfolio.js';
import { initAnalysisForm, loadHistory, initHistoryTab } from './analysis.js';

// ═══════════════════════════════════════════════════════════════════════════
// Tab Routing (via <md-tabs>)
// ═══════════════════════════════════════════════════════════════════════════

const TAB_MAP = {
    'tab-dashboard': 'dashboard',
    'tab-analysis': 'analysis',
    'tab-history': 'history',
    'tab-portfolio': 'portfolio',
};

function switchTab(name) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));
    switch (name) {
        case 'dashboard': loadDashboard(); break;
        case 'history': loadHistory(); break;
        case 'portfolio': loadPortfolioManager(); break;
    }
    window.location.hash = name;
}

function initTabs() {
    const tabs = document.getElementById('nav-tabs');
    tabs.addEventListener('change', (e) => {
        const active = tabs.activeTab;
        if (active && TAB_MAP[active.id]) switchTab(TAB_MAP[active.id]);
    });

    // Restore from hash or default
    const hash = window.location.hash.replace('#', '');
    const valid = Object.values(TAB_MAP);
    const target = valid.includes(hash) ? hash : 'dashboard';

    // Activate correct MWC tab
    const tabId = Object.keys(TAB_MAP).find(k => TAB_MAP[k] === target);
    if (tabId) {
        const tab = document.getElementById(tabId);
        if (tab) tabs.activeTab = tab;
    }
    switchTab(target);

    window.addEventListener('hashchange', () => {
        const h = window.location.hash.replace('#', '');
        if (valid.includes(h)) {
            const tid = Object.keys(TAB_MAP).find(k => TAB_MAP[k] === h);
            if (tid) { const t = document.getElementById(tid); if (t) tabs.activeTab = t; }
            switchTab(h);
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════════════════

function init() {
    initTabs();
    initAnalysisForm();
    initHistoryTab();
    initCashForm();
    initHoldingForm();
    initTxForm();
    loadDashboard();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
