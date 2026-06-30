/**
 * TradingAgents — Main Application
 * Tab routing, dark mode, toast notifications, initialization.
 * No framework dependencies — uses patterns from ui-reference/app.js.
 */

import { loadDashboard, initCashForm, initHoldingForm, initTxForm, loadPortfolioManager } from './portfolio.js';
import { initAnalysisForm, loadHistory, initHistoryTab, reconnectRunningAnalysis } from './analysis.js';

// ═══════════════════════════════════════════════════════════════════════════
// Toast
// ═══════════════════════════════════════════════════════════════════════════

export function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.remove('hidden');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => { toast.classList.add('hidden'); }, 3500);
}

// ═══════════════════════════════════════════════════════════════════════════
// Status Chip
// ═══════════════════════════════════════════════════════════════════════════

export function setStatus(status) {
    const el = document.getElementById('app-status');
    el.className = `status-chip ${status}`;
    const labels = { idle: 'Ready', running: 'Analyzing...', completed: 'Complete', failed: 'Error' };
    el.textContent = labels[status] || status;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab / View Routing
// ═══════════════════════════════════════════════════════════════════════════

const VIEWS = ['dashboard', 'analysis', 'portfolio'];

export function switchView(name) {
    // Hide all views
    VIEWS.forEach(v => {
        const el = document.getElementById(`view-${v}`);
        if (el) el.classList.add('hidden');
    });

    // Show target view
    const target = document.getElementById(`view-${name}`);
    if (target) target.classList.remove('hidden');

    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.view === name);
    });

    // Load view data
    switch (name) {
        case 'dashboard': loadDashboard(); break;
        case 'analysis': loadHistory(); reconnectRunningAnalysis(); break;
        case 'portfolio': loadPortfolioManager(); break;
    }

    // Update URL hash
    window.location.hash = name;
}

// ═══════════════════════════════════════════════════════════════════════════
// Dark Mode
// ═══════════════════════════════════════════════════════════════════════════

function toggleDarkMode() {
    const html = document.documentElement;
    const isDark = !html.classList.contains('dark');

    if (!document.startViewTransition) {
        if (isDark) html.classList.add('dark');
        else html.classList.remove('dark');
        localStorage.setItem('darkMode', isDark ? '1' : '0');
        updateDarkModeIcon(isDark);
        return;
    }

    const btn = document.getElementById('btnDarkMode');
    const rect = btn.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const endRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y)
    );

    const transition = document.startViewTransition(() => {
        if (isDark) html.classList.add('dark');
        else html.classList.remove('dark');
        localStorage.setItem('darkMode', isDark ? '1' : '0');
        updateDarkModeIcon(isDark);
    });

    transition.ready.then(() => {
        document.documentElement.animate(
            {
                clipPath: [
                    `circle(0 at ${x}px ${y}px)`,
                    `circle(${endRadius}px at ${x}px ${y}px)`
                ]
            },
            {
                duration: 500,
                easing: 'ease-out',
                pseudoElement: '::view-transition-new(root)'
            }
        );
    });
}

function updateDarkModeIcon(isDark) {
    const icon = document.querySelector('#btnDarkMode .material-symbols-outlined');
    if (icon) icon.textContent = isDark ? 'light_mode' : 'dark_mode';
}

function initDarkMode() {
    const saved = localStorage.getItem('darkMode');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = saved === '1' || (saved === null && prefersDark);
    if (isDark) {
        document.documentElement.classList.add('dark');
    }
    updateDarkModeIcon(isDark);
}

// ═══════════════════════════════════════════════════════════════════════════
// Keyboard shortcuts
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        // Close drawer if open (handled in analysis.js)
        if (typeof closeDetailDrawer === 'function') closeDetailDrawer();
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════════════════

function init() {
    initDarkMode();

    // Initialize all forms
    initAnalysisForm();
    initHistoryTab();
    initCashForm();
    initHoldingForm();
    initTxForm();

    // Restore view from hash or default to dashboard
    const hash = window.location.hash.replace('#', '');
    const target = VIEWS.includes(hash) ? hash : 'dashboard';
    switchView(target);

    // Listen for hash changes
    window.addEventListener('hashchange', () => {
        const h = window.location.hash.replace('#', '');
        if (VIEWS.includes(h)) switchView(h);
    });

    // Expose functions to window for onclick handlers in HTML
    window.switchView = switchView;
    window.toggleDarkMode = toggleDarkMode;
    window.loadHistory = loadHistory;

    setStatus('idle');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
