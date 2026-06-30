/**
 * Receipts Dashboard - Frontend Application
 */

// ── State ───────────────────────────────────────────────────────────────
const state = {
    storeFilter: 'all',
    search: '',
    dateFrom: '',
    dateTo: new Date().toISOString().substring(0, 10),
    sort: 'actual_card_amount',
    order: 'desc',
    page: 1,
    perPage: 50,
    totalOrders: 0,
    totalPages: 1,
};

// ── Auth ────────────────────────────────────────────────────────────────
let currentUserSub = '';
async function checkAuth() {
    try {
        const resp = await fetch('/api/auth/me');
        if (!resp.ok) {
            window.location.href = '/auth/login';
            return;
        }
        const data = await resp.json();
        currentUserSub = data.user.sub;
        document.getElementById('userName').textContent = data.user.name || data.user.email || '—';
        if (data.user.role === 'admin') {
            document.getElementById('userChip').classList.add('admin');
        }
        if (data.user.sub && data.user.sub.startsWith('dev-')) {
            document.getElementById('devSwitcher').hidden = false;
        }
    } catch (e) {
        window.location.href = '/auth/login';
    }
}

function switchDevRole(role) {
    window.location.href = `/auth/dev-switch?role=${role}`;
}

// ── Init ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    // Check auth first
    await checkAuth();
    // Set default date range and validation
    document.getElementById('filterDateTo').value = state.dateTo;
    document.getElementById('filterDateFrom').max = state.dateTo;
    document.getElementById('filterDateTo').max = state.dateTo;
    setupDateValidation();
    await checkInitNeeded();
    await loadAll();
});

async function checkInitNeeded() {
    try {
        const resp = await fetch('/api/sync-status');
        const data = await resp.json();
        // If no syncs have ever completed, show the init overlay
        const hasSyncs = data.syncs && data.syncs.length > 0 &&
            data.syncs.some(s => s.status === 'completed');
        if (!hasSyncs) {
            document.getElementById('initOverlay').hidden = false;
            document.getElementById('mainContent').style.opacity = '0.4';
        } else {
            document.getElementById('initOverlay').hidden = true;
            document.getElementById('mainContent').style.opacity = '1';
            updateSyncIndicator(data.syncs);
        }
    } catch (e) {
        console.error('Failed to check sync status:', e);
    }
}

// ── Initialize ──────────────────────────────────────────────────────────
async function doInitialize() {
    const startDate = document.getElementById('initStartDate').value;
    const btn = document.getElementById('btnInit');
    const progress = document.getElementById('initProgress');

    btn.disabled = true;
    progress.hidden = false;

    try {
        const resp = await fetch('/api/initialize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ start_date: startDate }),
        });
        const data = await resp.json();
        if (resp.ok) {
            document.getElementById('initOverlay').hidden = true;
            document.getElementById('mainContent').style.opacity = '1';
            showToast('Data pulled successfully!', 'success');
            await loadAll();
        } else {
            showToast('Failed: ' + (data.detail || 'Unknown error'), 'error');
        }
    } catch (e) {
        showToast('Network error: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        progress.hidden = true;
    }
}

// ── Refresh ─────────────────────────────────────────────────────────────
async function doRefresh() {
    const btn = document.getElementById('btnRefresh');
    const indicator = document.getElementById('syncIndicator');
    btn.classList.add('refreshing');
    btn.disabled = true;
    indicator.classList.add('syncing');
    document.getElementById('syncText').textContent = 'Syncing…';

    try {
        const resp = await fetch('/api/refresh', { method: 'POST' });
        const data = await resp.json();
        if (resp.ok) {
            const totalAdded = data.results.reduce((sum, r) => sum + (r.orders_added || 0), 0);
            showToast(
                totalAdded > 0
                    ? `Found ${totalAdded} new order${totalAdded !== 1 ? 's' : ''}`
                    : 'Already up to date',
                'success'
            );
            await loadAll();
        } else {
            showToast('Refresh failed: ' + (data.detail || 'Unknown error'), 'error');
        }
    } catch (e) {
        showToast('Network error: ' + e.message, 'error');
    } finally {
        btn.classList.remove('refreshing');
        btn.disabled = false;
        indicator.classList.remove('syncing');
        await updateSyncText();
    }
}

// ── Load All Data ───────────────────────────────────────────────────────
async function loadAll() {
    await Promise.all([loadStats(), loadOrders(), updateSyncText()]);
}

async function loadStats() {
    try {
        const params = new URLSearchParams();
        if (state.dateFrom) params.set('date_from', state.dateFrom);
        if (state.dateTo) params.set('date_to', state.dateTo);

        const resp = await fetch(`/api/stats?${params}`);
        const data = await resp.json();

        const fmt = (n) => n != null ? `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

        document.getElementById('statTotal').textContent = fmt(data.overall?.total_spent);
        document.getElementById('statOrders').textContent = `${(data.overall?.order_count || 0).toLocaleString()} orders · Sam's + Walmart − Other`;

        const sams = data.by_store?.find(s => s.store === 'sams');
        document.getElementById('statSams').textContent = fmt(sams?.total);
        document.getElementById('statSamsOrders').textContent = `${(sams?.count || 0).toLocaleString()} orders`;

        const walmart = data.by_store?.find(s => s.store === 'walmart');
        document.getElementById('statWalmart').textContent = fmt(walmart?.total);
        document.getElementById('statWalmartOrders').textContent = `${(walmart?.count || 0).toLocaleString()} orders`;

        document.getElementById('statSavings').textContent = fmt(data.overall?.total_savings);
        const sc = data.overall?.total_savings || 0;
        document.getElementById('statSavingsSub').textContent = sc > 0 ? 'for selected period' : 'no credits in period';

        document.getElementById('statFood').textContent = fmt(data.items_breakdown?.food_total);
        document.getElementById('statHousehold').textContent = fmt(data.items_breakdown?.household_total);
        document.getElementById('statOther').textContent = fmt(data.items_breakdown?.other_total);
    } catch (e) {
        console.error('Failed to load stats:', e);
    }
}

async function loadOrders() {
    try {
        const params = new URLSearchParams();
        if (state.storeFilter !== 'all') params.set('store', state.storeFilter);
        if (state.search) params.set('search', state.search);
        if (state.dateFrom) params.set('date_from', state.dateFrom);
        if (state.dateTo) params.set('date_to', state.dateTo);
        params.set('page', state.page);
        params.set('per_page', state.perPage);
        params.set('sort', state.sort);
        params.set('order', state.order);

        const resp = await fetch(`/api/orders?${params}`);
        const data = await resp.json();

        state.totalOrders = data.total;
        state.totalPages = data.pages;

        document.getElementById('orderCount').textContent = `${data.total.toLocaleString()} order${data.total !== 1 ? 's' : ''}`;
        renderOrders(data.orders);
        renderPagination();
        updateSortArrows();
    } catch (e) {
        console.error('Failed to load orders:', e);
    }
}

// ── Render Orders Table ─────────────────────────────────────────────────
function renderOrders(orders) {
    const tbody = document.getElementById('ordersBody');
    if (!orders.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No transactions found matching your filters.</td></tr>`;
        return;
    }

    const fmt = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const dateFmt = (d) => {
        const dt = new Date(d);
        return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    tbody.innerHTML = orders.map(o => `
        <tr onclick="openDrawer(${o.id})">
            <td>${dateFmt(o.order_date)}</td>
            <td><span class="store-badge ${o.store}">${o.store === 'sams' ? "Sam's Club" : 'Walmart'}</span></td>
            <td class="amount">${fmt(o.actual_card_amount)}</td>
            <td>${o.item_count || 0}</td>
            <td class="payment-text">${o.payment_method || '—'}</td>
            <td><span class="material-symbols-outlined" style="font-size:18px;color:var(--text-muted)">chevron_right</span></td>
        </tr>`).join('');
}

// ── Pagination ──────────────────────────────────────────────────────────
function renderPagination() {
    const container = document.getElementById('pagination');
    if (state.totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '';
    html += `<button ${state.page <= 1 ? 'disabled' : ''} onclick="goToPage(${state.page - 1})">← Prev</button>`;

    const maxButtons = 7;
    let start = Math.max(1, state.page - Math.floor(maxButtons / 2));
    let end = Math.min(state.totalPages, start + maxButtons - 1);
    if (end - start < maxButtons - 1) start = Math.max(1, end - maxButtons + 1);

    for (let i = start; i <= end; i++) {
        html += `<button class="${i === state.page ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
    }

    html += `<button ${state.page >= state.totalPages ? 'disabled' : ''} onclick="goToPage(${state.page + 1})">Next →</button>`;
    html += `<span class="page-info">${state.page} of ${state.totalPages}</span>`;
    container.innerHTML = html;
}

function goToPage(page) {
    state.page = page;
    loadOrders();
    window.scrollTo({ top: 400, behavior: 'smooth' });
}

// ── Filters ─────────────────────────────────────────────────────────────
function setStoreFilter(store, el) {
    state.storeFilter = store;
    state.page = 1;
    document.querySelectorAll('.filter-chips .chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    applyFilters();
}

let searchTimeout;
function debounceSearch() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        state.search = document.getElementById('searchInput').value;
        state.page = 1;
        applyFilters();
    }, 300);
}

function applyFilters() {
    state.dateFrom = document.getElementById('filterDateFrom').value;
    state.dateTo = document.getElementById('filterDateTo').value;
    // Validation: enforce from <= to
    if (state.dateFrom && state.dateTo && state.dateFrom > state.dateTo) {
        state.dateFrom = state.dateTo;
        document.getElementById('filterDateFrom').value = state.dateTo;
    }
    state.page = 1;
    loadAll();
}

function setupDateValidation() {
    const fromEl = document.getElementById('filterDateFrom');
    const toEl = document.getElementById('filterDateTo');
    const today = new Date().toISOString().substring(0, 10);

    fromEl.max = today;
    toEl.max = today;

    fromEl.addEventListener('change', () => {
        if (fromEl.value) {
            toEl.min = fromEl.value;
            // If to date is now before from date, adjust it
            if (toEl.value && toEl.value < fromEl.value) {
                toEl.value = fromEl.value;
            }
        } else {
            toEl.min = '';
        }
        // Sync to analytics
        document.getElementById('analyticsDateFrom').value = fromEl.value;
        document.getElementById('analyticsDateTo').value = toEl.value;
        applyFilters();
    });
    toEl.addEventListener('change', () => {
        if (toEl.value) {
            fromEl.max = toEl.value;
            if (fromEl.value && fromEl.value > toEl.value) {
                fromEl.value = toEl.value;
            }
        } else {
            fromEl.max = today;
        }
        // Sync to analytics
        document.getElementById('analyticsDateFrom').value = fromEl.value;
        document.getElementById('analyticsDateTo').value = toEl.value;
        applyFilters();
    });
}

function setSort(field) {
    if (state.sort === field) {
        state.order = state.order === 'desc' ? 'asc' : 'desc';
    } else {
        state.sort = field;
        state.order = 'desc';
    }
    state.page = 1;
    loadOrders();
}

function updateSortArrows() {
    document.querySelectorAll('.sort-arrow').forEach(el => {
        el.className = 'sort-arrow';
    });
    const arrow = document.getElementById(`sort-${state.sort}`);
    if (arrow) arrow.className = `sort-arrow ${state.order}`;
}

// ── Drawer ──────────────────────────────────────────────────────────────
async function openDrawer(orderId) {
    try {
        const resp = await fetch(`/api/orders/${orderId}`);
        const data = await resp.json();
        renderDrawer(data.order, data.items);
        document.getElementById('drawer').classList.add('open');
        document.getElementById('drawerOverlay').classList.add('open');
        document.body.classList.add('drawer-open');
    } catch (e) {
        showToast('Failed to load order details', 'error');
    }
}

function closeDrawer() {
    document.getElementById('drawer').classList.remove('open');
    document.getElementById('drawerOverlay').classList.remove('open');
    document.body.classList.remove('drawer-open');
}

function renderDrawer(order, items) {
    const fmt = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const dateFmt = (d) => {
        const dt = new Date(d);
        return dt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    };

    document.getElementById('drawerTitle').textContent =
        `${order.store === 'sams' ? "Sam's Club" : 'Walmart'} — ${dateFmt(order.order_date)}`;

    const catEmoji = (cat) => ({ food: '🍎', household: '🏠', other: '📦' })[cat];
    const catText = (cat) => ({ food: 'Food', household: 'Household', other: 'Other' })[cat];
    const nextCat = (cat) => ({ food: 'household', household: 'other', other: 'food' })[cat];

    const itemsHtml = items.map(i => {
        const cat = i.category || 'other';
        return `
        <div class="item-row">
            <div class="item-name">
                <span class="item-class-badge ${cat}" onclick="event.stopPropagation(); recategorizeItem(${i.id}, '${nextCat(cat)}', ${order.id})" title="Click to recategorize">
                    ${catEmoji(cat)} ${catText(cat)}
                    <span class="cat-hint">↻</span>
                </span>
                ${i.ai_name || i.name}
            </div>
            <div class="item-meta">
                <span class="item-qty">×${i.quantity}</span>
                <span class="item-price">${fmt(i.price)}</span>
            </div>
        </div>`;
    }).join('');

    // Build financial detail rows — only show tip / store credit / extra savings when they apply
    const finRows = [];
    finRows.push({ label: 'Subtotal', value: fmt(order.subtotal) });
    finRows.push({ label: 'Tax', value: fmt(order.tax) });
    if (order.delivery_charges > 0) finRows.push({ label: 'Delivery', value: fmt(order.delivery_charges) });
    if (order.bag_fee > 0) finRows.push({ label: 'Bag Fee', value: fmt(order.bag_fee) });
    if (order.tip > 0) finRows.push({ label: 'Tip', value: fmt(order.tip) });
    if ((order.store_credit_amount || 0) > 0) finRows.push({ label: 'Store Credit / Savings', value: `−${fmt(order.store_credit_amount)}`, cls: 'savings-color' });
    if ((order.extra_savings || 0) > 0.5) finRows.push({ label: 'Extra Savings', value: `−${fmt(order.extra_savings)}`, cls: 'savings-color' });
    finRows.push({ label: 'Card Payment', value: fmt(order.actual_card_amount) });
    finRows.push({ label: 'Total Charged', value: fmt(order.total), bold: true });
    finRows.push({ label: 'Payment Method', value: order.payment_method || '—' });

    const finRowsHtml = finRows.map(r => {
        const style = r.bold ? 'style="border-top:2px solid var(--border);padding-top:12px;margin-top:4px;font-weight:700;font-size:15px"' : '';
        const valStyle = r.bold ? 'style="font-size:18px;font-weight:700"' : '';
        const valCls = r.cls || '';
        return `<div class="detail-row" ${style}><span class="detail-label">${r.label}</span><span class="detail-value ${valCls}" ${valStyle}>${r.value}</span></div>`;
    }).join('');

    document.getElementById('drawerBody').innerHTML = `
        <div class="detail-row"><span class="detail-label">Store</span><span class="detail-value">${order.store_name || (order.store === 'sams' ? "Sam's Club" : 'Walmart')}</span></div>
        <div class="detail-row"><span class="detail-label">Address</span><span class="detail-value">${order.address || '—'}</span></div>
        <div class="detail-row"><span class="detail-label">Date</span><span class="detail-value">${dateFmt(order.order_date)}</span></div>
        ${finRowsHtml}
        <div class="items-list">
            <h3>Items (${items.length})</h3>
            <p class="cat-hint-text">Click a category badge to cycle: Food → Household → Other</p>
            ${itemsHtml}
        </div>
    `;
}

async function recategorizeItem(itemId, newCat, orderId) {
    try {
        const resp = await fetch(`/api/items/${itemId}/categorize`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category: newCat }),
        });
        if (resp.ok) {
            // Reload the drawer and stats to reflect changes
            await loadStats();
            const resp2 = await fetch(`/api/orders/${orderId}`);
            const data = await resp2.json();
            renderDrawer(data.order, data.items);
            showToast(`Recategorized to ${newCat}`, 'success');
        } else {
            const err = await resp.json();
            showToast('Failed: ' + (err.detail || 'Unknown'), 'error');
        }
    } catch (e) {
        showToast('Network error: ' + e.message, 'error');
    }
}

// ── Sync Indicator ──────────────────────────────────────────────────────
async function updateSyncText() {
    try {
        const resp = await fetch('/api/sync-status');
        const data = await resp.json();
        updateSyncIndicator(data.syncs);
    } catch (e) { /* ignore */ }
}

function updateSyncIndicator(syncs) {
    const el = document.getElementById('syncText');
    if (!syncs || syncs.length === 0) {
        el.textContent = 'No data';
        return;
    }
    const last = syncs[0];
    const dt = new Date(last.completed_at + 'Z');
    const now = new Date();
    const diffMin = Math.floor((now - dt) / 60000);

    let timeStr;
    if (diffMin < 1) timeStr = 'just now';
    else if (diffMin < 60) timeStr = `${diffMin}m ago`;
    else if (diffMin < 1440) timeStr = `${Math.floor(diffMin / 60)}h ago`;
    else timeStr = `${Math.floor(diffMin / 1440)}d ago`;

    el.textContent = `Synced ${timeStr}`;
}

// ── Toast ───────────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.hidden = false;
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => { toast.hidden = true; }, 3500);
}

// ── Dark Mode ───────────────────────────────────────────────────────────
function toggleDarkMode() {
    const html = document.documentElement;
    const isDark = !html.classList.contains('dark');

    // Fallback for browsers without View Transitions API
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

// Load saved preference on startup (no animation on page load)
(function initDarkMode() {
    const saved = localStorage.getItem('darkMode');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = saved === '1' || (saved === null && prefersDark);
    if (isDark) {
        document.documentElement.classList.add('dark');
    }
    updateDarkModeIcon(isDark);
})();

// ── Keyboard shortcuts ──────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeDrawer(); closeOrderModal(); }
    if (e.ctrlKey && e.key === 'r') { e.preventDefault(); doRefresh(); }
});

// ═══════════════════════════════════════════════════════════════════════
// ── View Routing ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

function switchView(view) {
    const main = document.getElementById('mainContent');
    const reportsView = document.getElementById('reportsView');
    const detailView = document.getElementById('reportDetailView');
    const analyticsView = document.getElementById('analyticsView');

    main.hidden = (view !== 'dashboard');
    reportsView.hidden = (view !== 'reports');
    detailView.hidden = true;
    analyticsView.hidden = (view !== 'analytics');

    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.view === view);
    });

    // Sync date inputs between views
    if (view === 'dashboard') {
        document.getElementById('filterDateFrom').value = state.dateFrom;
        document.getElementById('filterDateTo').value = state.dateTo;
    }
    if (view === 'analytics') {
        document.getElementById('analyticsDateFrom').value = state.dateFrom;
        document.getElementById('analyticsDateTo').value = state.dateTo;
    }

    if (view === 'reports') loadReportsList();
    if (view === 'dashboard') loadAll();
    if (view === 'analytics') initAnalytics();
}

// ═══════════════════════════════════════════════════════════════════════
// ── Reports: List ───────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

async function loadReportsList() {
    try {
        const resp = await fetch('/api/reports');
        const data = await resp.json();
        renderReportsList(data.reports);
    } catch (e) {
        showToast('Failed to load reports', 'error');
    }
}

function renderReportsList(reports) {
    document.getElementById('reportsCount').textContent =
        `${reports.length} report${reports.length !== 1 ? 's' : ''}`;

    const dateFmt = (d) => {
        const dt = new Date(d + 'Z');
        return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };
    const statusLabel = (s) => ({ draft: 'Draft', submitted: 'Submitted', approved: 'Approved', paid_pending: 'Paid Pending', paid: 'Paid' })[s] || s;
    const statusCls = (s) => s;

    document.getElementById('reportsGrid').innerHTML = reports.map(r => `
        <div class="report-card" onclick="openReport(${r.id})">
            <div class="report-card-top">
                <span class="report-card-icon material-symbols-outlined">description</span>
                <div>
                    <h3>${escapeHtml(r.name)}</h3>
                    <span class="report-card-meta">${r.order_count || 0} orders · Created ${dateFmt(r.created_at)}</span>
                </div>
            </div>
            <div class="report-card-footer">
                <span class="status-badge ${statusCls(r.status)}">${statusLabel(r.status)}</span>
                ${r.status === 'submitted' ? `<span class="approval-progress">${r.report_approvals || 0}/${r.total_users - 1 || 1} approved</span>` : ''}
                ${r.status === 'paid_pending' ? `<span class="approval-progress">${r.paid_approvals || 0}/${r.total_users - 1 || 1} approved</span>` : ''}
            </div>
        </div>
    `).join('') || '<p class="empty-state">No reports yet. Go to the Dashboard, filter your data, and click "Create Report".</p>';
}

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

async function createReport() {
    const btn = document.getElementById('btnCreateReport');
    btn.disabled = true;
    btn.querySelector('.material-symbols-outlined').textContent = 'hourglass';

    try {
        const body = {};
        if (state.storeFilter !== 'all') body.store = state.storeFilter;
        if (state.search) body.search = state.search;
        if (state.dateFrom) body.date_from = state.dateFrom;
        if (state.dateTo) body.date_to = state.dateTo;

        const resp = await fetch('/api/reports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await resp.json();
        if (resp.ok) {
            showToast(`Report "${data.name}" created with ${data.orders_added} orders`, 'success');
        } else {
            showToast('Failed: ' + (data.detail || 'Unknown error'), 'error');
        }
    } catch (e) {
        showToast('Network error: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.querySelector('.material-symbols-outlined').textContent = 'note_add';
    }
}

// ═══════════════════════════════════════════════════════════════════════
// ── Reports: Detail ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

let currentReportId = null;
const reportState = { page: 1, perPage: 50, totalPages: 1 };

async function openReport(id) {
    currentReportId = id;
    document.getElementById('reportsView').hidden = true;
    document.getElementById('reportDetailView').hidden = false;
    await loadReportData();
}

async function loadReportData() {
    try {
        const [rResp, sResp] = await Promise.all([
            fetch(`/api/reports/${currentReportId}`),
            fetch(`/api/reports/${currentReportId}/stats`),
        ]);
        const rep = await rResp.json();
        const stats = await sResp.json();

        document.getElementById('reportDetailName').textContent = rep.report.name;
        renderReportStats(stats);
        renderReportActions(rep.report, rep.approvals);
        reportState.page = 1;
        await loadReportOrders();
    } catch (e) {
        showToast('Failed to load report', 'error');
    }
}

function renderReportActions(report, approvals) {
    const container = document.getElementById('reportDetailName').parentElement;
    const old = container.querySelector('.report-actions');
    if (old) old.remove();

    const s = report.status;
    const isSubmitter = report.submitted_by === currentUserSub;
    const alreadyApproved = (approvals || []).some(a => a.user_sub === currentUserSub && a.approval_type === (s === 'paid_pending' ? 'paid' : 'report'));
    let btns = '';

    if (s === 'draft') {
        btns = `<button class="btn-primary-sm" onclick="workflowAction('submit')">Submit for Approval</button>`;
    } else if (s === 'submitted') {
        if (isSubmitter) {
            btns = `<button class="btn-text-sm" onclick="workflowAction('unsubmit')">Unsubmit</button>`;
        } else if (!alreadyApproved) {
            btns = `<button class="btn-primary-sm" onclick="workflowAction('approve')">Approve</button>`;
        }
    } else if (s === 'approved') {
        btns = `<button class="btn-primary-sm" onclick="workflowAction('mark-paid')">Mark as Paid</button>`;
    } else if (s === 'paid_pending' && !alreadyApproved && report.paid_by !== currentUserSub) {
        btns = `<button class="btn-primary-sm" onclick="workflowAction('approve-payment')">Approve Payment</button>`;
    }

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'report-actions';
    actionsDiv.innerHTML = btns;
    container.appendChild(actionsDiv);
}

async function workflowAction(action) {
    try {
        const resp = await fetch(`/api/reports/${currentReportId}/${action}`, { method: 'POST' });
        const data = await resp.json();
        if (resp.ok) {
            showToast(`Status: ${data.new_status}`, 'success');
            await loadReportData();
        } else {
            showToast('Failed: ' + (data.detail || 'Unknown'), 'error');
        }
    } catch (e) { showToast('Network error: ' + e.message, 'error'); }
}

async function updateRefundSplit(itemId, split, orderId) {
    try {
        const resp = await fetch(`/api/reports/${currentReportId}/items/${itemId}/split?split=${split}`, { method: 'PATCH' });
        if (resp.ok) {
            await loadReportData();
            const r2 = await fetch(`/api/reports/${currentReportId}/orders/${orderId}`);
            const d2 = await r2.json();
            renderReportDrawer(d2.order, d2.items);
        } else {
            const err = await resp.json();
            showToast('Failed: ' + (err.detail || 'Unknown'), 'error');
        }
    } catch (e) { showToast('Network error: ' + e.message, 'error'); }
}

function renderReportStats(data) {
    const fmt = (n) => n != null ? `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
    const ordCount = (data.overall?.order_count || 0).toLocaleString();
    const hasManual = data.manual && data.manual.count > 0;

    // Row 1: Spending KPIs (4 cols)
    let html = `
        <div class="summary-row">
            <div class="card summary-card">
                <div class="card-label">Total Spent</div>
                <div class="card-value">${fmt(data.overall?.total_spent)}</div>
                <div class="card-sub">${ordCount} orders · Sam's + Walmart${hasManual ? ' + Manual' : ''} − Other</div>
            </div>
            ${(data.by_store || []).map(s => `
                <div class="card summary-card">
                    <div class="card-label">${s.store === 'sams' ? "Sam's Club" : 'Walmart'}</div>
                    <div class="card-value ${s.store === 'sams' ? 'sams-color' : 'walmart-color'}">${fmt(s.total)}</div>
                    <div class="card-sub">${s.count} orders</div>
                </div>
            `).join('')}
            <div class="card summary-card">
                <div class="card-label">Store Credit</div>
                <div class="card-value savings-color">${fmt(data.overall?.total_savings)}</div>
                <div class="card-sub">${(data.overall?.total_savings || 0) > 0 ? 'for report period' : 'no credits in report'}</div>
            </div>
        </div>`;

    // Row 2: Category breakdown (3 cols)
    html += `
        <div class="breakdown-row">
            <div class="card breakdown-card">
                <div class="card-label">🍎 Food & Groceries</div>
                <div class="card-value">${fmt(data.items_breakdown?.food_total)}</div>
                <div class="card-sub">prices only, tax excluded</div>
            </div>
            <div class="card breakdown-card">
                <div class="card-label">🏠 Household</div>
                <div class="card-value">${fmt(data.items_breakdown?.household_total)}</div>
                <div class="card-sub">prices only, tax excluded</div>
            </div>
            <div class="card breakdown-card">
                <div class="card-label">📦 Other</div>
                <div class="card-value">${fmt(data.items_breakdown?.other_total)}</div>
            </div>
        </div>`;

    // Row 3: Supplemental metrics — Refund always, Manual only if present
    html += `<div class="summary-row supplemental-row">`;
    html += `
        <div class="card summary-card${hasManual ? '' : ' card-span-2'}">
            <div class="card-label">💰 Refund Estimated</div>
            <div class="card-value refund-color">${fmt(data.refund)}</div>
            <div class="card-sub">proportional to card charges</div>
        </div>`;
    if (hasManual) {
        html += `
        <div class="card summary-card">
            <div class="card-label">📝 Manual Orders</div>
            <div class="card-value manual-color">${fmt(data.manual.total)}</div>
            <div class="card-sub">${data.manual.count} order${data.manual.count !== 1 ? 's' : ''} · card amount</div>
        </div>`;
    }
    html += `</div>`;

    document.getElementById('reportStats').innerHTML = html;
}

async function loadReportOrders() {
    try {
        const resp = await fetch(`/api/reports/${currentReportId}/orders?page=${reportState.page}&per_page=${reportState.perPage}`);
        const data = await resp.json();
        reportState.totalPages = data.pages;
        document.getElementById('reportOrderCount').textContent = `${data.total.toLocaleString()} order${data.total !== 1 ? 's' : ''}`;
        renderReportOrdersTable(data.orders);
        renderReportPagination(data);
    } catch (e) {
        showToast('Failed to load orders', 'error');
    }
}

function renderReportOrdersTable(orders) {
    const tbody = document.getElementById('reportOrdersBody');
    if (!orders.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No orders in this report.</td></tr>';
        return;
    }
    const fmt = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const dateFmt = (d) => {
        const dt = new Date(d);
        return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };
    tbody.innerHTML = orders.map(o => `
        <tr onclick="openReportDrawer(${o.id})">
            <td>${dateFmt(o.order_date)}${o.is_manual ? ' <span class="manual-badge">Manual</span>' : ''}</td>
            <td><span class="store-badge ${o.store}">${o.store === 'sams' ? "Sam's Club" : o.store === 'walmart' ? 'Walmart' : o.store}</span></td>
            <td class="amount">${fmt(o.actual_card_amount)}</td>
            <td>${o.item_count || 0}</td>
            <td class="payment-text">${o.payment_method || '—'}</td>
            <td onclick="event.stopPropagation()">
                ${o.is_manual ? `
                <button class="btn-icon-sm" onclick="editReportOrder(${o.id})" title="Edit"><span class="material-symbols-outlined">edit</span></button>
                <button class="btn-icon-sm danger" onclick="deleteReportOrder(${o.id})" title="Delete"><span class="material-symbols-outlined">delete</span></button>
                ` : `
                <button class="btn-text-sm" onclick="showNotesModal(${o.id})" title="Add notes"><span class="material-symbols-outlined">sticky_note_2</span> Notes</button>
                `}
            </td>
        </tr>`).join('');
}

function renderReportPagination(data) {
    const container = document.getElementById('reportPagination');
    if (data.pages <= 1) { container.innerHTML = ''; return; }
    let html = '';
    html += `<button ${reportState.page <= 1 ? 'disabled' : ''} onclick="reportGoToPage(${reportState.page - 1})">← Prev</button>`;
    const maxB = 7;
    let start = Math.max(1, reportState.page - Math.floor(maxB / 2));
    let end = Math.min(data.pages, start + maxB - 1);
    if (end - start < maxB - 1) start = Math.max(1, end - maxB + 1);
    for (let i = start; i <= end; i++) {
        html += `<button class="${i === reportState.page ? 'active' : ''}" onclick="reportGoToPage(${i})">${i}</button>`;
    }
    html += `<button ${reportState.page >= data.pages ? 'disabled' : ''} onclick="reportGoToPage(${reportState.page + 1})">Next →</button>`;
    container.innerHTML = html;
}

function reportGoToPage(p) { reportState.page = p; loadReportOrders(); }

async function deleteReport(id) {
    if (!confirm('Delete this report? This cannot be undone.')) return;
    try {
        await fetch(`/api/reports/${id}`, { method: 'DELETE' });
        showToast('Report deleted', 'success');
        switchView('reports');
    } catch (e) { showToast('Failed to delete report', 'error'); }
}

// ═══════════════════════════════════════════════════════════════════════
// ── Reports: Drawer ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

async function openReportDrawer(orderId) {
    try {
        const resp = await fetch(`/api/reports/${currentReportId}/orders/${orderId}`);
        const data = await resp.json();
        renderReportDrawer(data.order, data.items);
        document.getElementById('drawer').classList.add('open');
        document.getElementById('drawerOverlay').classList.add('open');
        document.body.classList.add('drawer-open');
    } catch (e) { showToast('Failed to load order details', 'error'); }
}

function renderReportDrawer(order, items) {
    const fmt = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const dateFmt = (d) => {
        const dt = new Date(d);
        return dt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    };
    const catEmoji = (cat) => ({ food: '🍎', household: '🏠', borrowed: '🤝', other: '📦' })[cat] || '📦';
    const catText = (cat) => ({ food: 'Food', household: 'Household', borrowed: 'Borrowed', other: 'Other' })[cat] || cat;
    // Manual orders cycle food→household→borrowed, auto-copied cycle food→household→other
    const nextCat = order.is_manual
        ? (cat) => ({ food: 'household', household: 'borrowed', borrowed: 'food' })[cat] || 'food'
        : (cat) => ({ food: 'household', household: 'other', other: 'food' })[cat] || 'food';

    const storeLabel = order.store === 'sams' ? "Sam's Club" : order.store === 'walmart' ? 'Walmart' : order.store;
    document.getElementById('drawerTitle').textContent =
        `${storeLabel} — ${dateFmt(order.order_date)}${order.is_manual ? ' [Manual]' : ''}`;

    const itemsHtml = items.map(i => {
        const cat = i.category || 'other';
        const split = i.refund_split || 3;
        const showSplit = order.is_manual
            ? (cat === 'food' || cat === 'household' || cat === 'borrowed')
            : (cat === 'food' || cat === 'household');
        return `
        <div class="item-row">
            <div class="item-name">
                <span class="item-class-badge ${cat}" onclick="event.stopPropagation(); recategorizeReportItem(${i.id}, '${nextCat(cat)}', ${order.id})" title="Click to recategorize">
                    ${catEmoji(cat)} ${catText(cat)}
                    <span class="cat-hint">↻</span>
                </span>
                ${i.ai_name || i.name}
            </div>
            <div class="item-meta">
                ${showSplit ? `<select class="split-select" onchange="event.stopPropagation(); updateRefundSplit(${i.id}, this.value, ${order.id})" title="Refund split">
                    <option value="3" ${split === 3 ? 'selected' : ''}>3</option>
                    <option value="2" ${split === 2 ? 'selected' : ''}>2</option>
                    <option value="1" ${split === 1 ? 'selected' : ''}>1</option>
                </select>` : ''}
                <span class="item-qty">×${i.quantity}</span>
                <span class="item-price">${fmt(i.price)}</span>
                ${order.is_manual ? `<button class="btn-icon-sm danger" onclick="event.stopPropagation(); deleteReportItem(${i.id}, ${order.id})" title="Remove item"><span class="material-symbols-outlined">close</span></button>` : ''}
            </div>
        </div>`;
    }).join('');

    const finRows = [];
    finRows.push({ label: 'Subtotal', value: fmt(order.subtotal) });
    finRows.push({ label: 'Tax', value: fmt(order.tax) });
    if (order.delivery_charges > 0) finRows.push({ label: 'Delivery', value: fmt(order.delivery_charges) });
    if (order.bag_fee > 0) finRows.push({ label: 'Bag Fee', value: fmt(order.bag_fee) });
    if (order.tip > 0) finRows.push({ label: 'Tip', value: fmt(order.tip) });
    if ((order.store_credit_amount || 0) > 0) finRows.push({ label: 'Store Credit / Savings', value: `−${fmt(order.store_credit_amount)}`, cls: 'savings-color' });
    if ((order.extra_savings || 0) > 0.5) finRows.push({ label: 'Extra Savings', value: `−${fmt(order.extra_savings)}`, cls: 'savings-color' });
    finRows.push({ label: 'Card Payment', value: fmt(order.actual_card_amount) });
    finRows.push({ label: 'Total Charged', value: fmt(order.total), bold: true });
    finRows.push({ label: 'Payment Method', value: order.payment_method || '—' });

    const finRowsHtml = finRows.map(r => {
        const style = r.bold ? 'style="border-top:2px solid var(--border);padding-top:12px;margin-top:4px;font-weight:700;font-size:15px"' : '';
        const valStyle = r.bold ? 'style="font-size:18px;font-weight:700"' : '';
        return `<div class="detail-row" ${style}><span class="detail-label">${r.label}</span><span class="detail-value ${r.cls||''}" ${valStyle}>${r.value}</span></div>`;
    }).join('');

    document.getElementById('drawerBody').innerHTML = `
        <div class="detail-row"><span class="detail-label">Store</span><span class="detail-value">${order.store_name || storeLabel}</span></div>
        <div class="detail-row"><span class="detail-label">Address</span><span class="detail-value">${order.address || '—'}</span></div>
        <div class="detail-row"><span class="detail-label">Date</span><span class="detail-value">${dateFmt(order.order_date)}</span></div>
        ${finRowsHtml}
        <div class="detail-row"><span class="detail-label">Notes</span><span class="detail-value">${order.notes || '—'}</span></div>
        <div class="items-list">
            <div class="items-list-header">
                <h3>Items (${items.length})</h3>
                ${order.is_manual ? `
                <button class="btn-text-sm" onclick="showAddItemInline(${order.id})">
                    <span class="material-symbols-outlined">add</span> Add Item
                </button>` : ''}
            </div>
            <p class="cat-hint-text">Click a category badge to cycle: Food → Household → Other</p>
            <div id="addItemForm_${order.id}"></div>
            ${itemsHtml}
        </div>
    `;
}

async function recategorizeReportItem(itemId, newCat, orderId) {
    try {
        const resp = await fetch(`/api/reports/${currentReportId}/items/${itemId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category: newCat }),
        });
        if (resp.ok) {
            await loadReportData();
            const resp2 = await fetch(`/api/reports/${currentReportId}/orders/${orderId}`);
            const data = await resp2.json();
            renderReportDrawer(data.order, data.items);
            showToast(`Recategorized to ${newCat}`, 'success');
        } else {
            const err = await resp.json();
            showToast('Failed: ' + (err.detail || 'Unknown'), 'error');
        }
    } catch (e) { showToast('Network error: ' + e.message, 'error'); }
}

async function deleteReportItem(itemId, orderId) {
    if (!confirm('Remove this item from the report?')) return;
    try {
        const resp = await fetch(`/api/reports/${currentReportId}/items/${itemId}`, { method: 'DELETE' });
        if (resp.ok) {
            await loadReportData();
            const resp2 = await fetch(`/api/reports/${currentReportId}/orders/${orderId}`);
            const data = await resp2.json();
            renderReportDrawer(data.order, data.items);
            showToast('Item removed', 'success');
        } else {
            const err = await resp.json();
            showToast('Failed: ' + (err.detail || 'Unknown'), 'error');
        }
    } catch (e) { showToast('Network error: ' + e.message, 'error'); }
}

function showAddItemInline(orderId) {
    const div = document.getElementById(`addItemForm_${orderId}`);
    div.innerHTML = `
        <div class="add-item-form">
            <input type="text" id="addItemName_${orderId}" placeholder="Item name" class="input-sm">
            <input type="number" id="addItemPrice_${orderId}" placeholder="Price" step="0.01" class="input-sm input-num">
            <select id="addItemCat_${orderId}" class="input-sm">
                <option value="food">🍎 Food</option>
                <option value="household">🏠 Household</option>
                <option value="borrowed">🤝 Borrowed</option>
            </select>
            <button class="btn-primary-sm" onclick="addReportItem(${orderId})">Add</button>
            <button class="btn-text-sm" onclick="document.getElementById('addItemForm_${orderId}').innerHTML=''">Cancel</button>
        </div>
    `;
}

async function addReportItem(orderId) {
    const name = document.getElementById(`addItemName_${orderId}`).value.trim();
    const price = parseFloat(document.getElementById(`addItemPrice_${orderId}`).value) || 0;
    const category = document.getElementById(`addItemCat_${orderId}`).value;
    if (!name) { showToast('Enter an item name', 'error'); return; }
    try {
        const resp = await fetch(`/api/reports/${currentReportId}/orders/${orderId}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, price, category }),
        });
        if (resp.ok) {
            await loadReportData();
            const resp2 = await fetch(`/api/reports/${currentReportId}/orders/${orderId}`);
            const data = await resp2.json();
            renderReportDrawer(data.order, data.items);
            showToast('Item added', 'success');
        } else {
            const err = await resp.json();
            showToast('Failed: ' + (err.detail || 'Unknown'), 'error');
        }
    } catch (e) { showToast('Network error: ' + e.message, 'error'); }
}

// ═══════════════════════════════════════════════════════════════════════
// ── Reports: Add/Edit Order Modal ───────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

let editingOrderId = null;

function showAddOrderModal() {
    editingOrderId = null;
    document.getElementById('modalTitle').textContent = 'Add Manual Order';
    buildAndShowOrderForm({});
}

async function editReportOrder(orderId) {
    editingOrderId = orderId;
    document.getElementById('modalTitle').textContent = 'Edit Order';
    try {
        const resp = await fetch(`/api/reports/${currentReportId}/orders/${orderId}`);
        const data = await resp.json();
        buildAndShowOrderForm(data.order);
    } catch (e) { showToast('Failed to load order', 'error'); }
}

async function buildAndShowOrderForm(order) {
    // Fetch report to get date range for constraints
    let dateMin = '', dateMax = new Date().toISOString().substring(0, 10);
    try {
        const rResp = await fetch(`/api/reports/${currentReportId}`);
        const rData = await rResp.json();
        if (rData.report?.filters_json) {
            const f = JSON.parse(rData.report.filters_json);
            if (f.date_from) dateMin = f.date_from;
            if (f.date_to) dateMax = f.date_to;
        }
    } catch (e) { /* use defaults */ }

    const v = (key, fallback = '') => order[key] || fallback;
    document.getElementById('modalBody').innerHTML = `
        <div class="form-grid">
            <label>Store <input type="text" id="fldStore" value="${v('store', 'walmart')}" class="input-sm" required></label>
            <label>Date <input type="date" id="fldDate" value="${v('order_date','').substring(0,10)}" min="${dateMin}" max="${dateMax}" class="input-sm" required></label>
            <label class="form-full">Notes <textarea id="fldNotes" class="input-sm" rows="2">${v('notes')}</textarea></label>
        </div>
        <div class="modal-actions">
            <button class="btn-primary" onclick="saveOrder()">Save</button>
            <button class="btn-text" onclick="closeOrderModal()">Cancel</button>
        </div>
    `;
    document.getElementById('orderModal').hidden = false;
    document.querySelector('.view-scroll').style.overflow = 'hidden';
}

function closeOrderModal() {
    document.getElementById('orderModal').hidden = true;
    editingOrderId = null;
    document.querySelector('.view-scroll').style.overflow = '';
}

async function saveOrder() {
    const get = (id, fallback = '') => document.getElementById(id)?.value ?? fallback;
    const body = {
        store: get('fldStore'),
        order_date: get('fldDate') || new Date().toISOString().substring(0, 10),
        notes: get('fldNotes'),
    };

    if (!body.store.trim()) { showToast('Store is required', 'error'); return; }

    try {
        let resp;
        if (editingOrderId) {
            resp = await fetch(`/api/reports/${currentReportId}/orders/${editingOrderId}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        } else {
            resp = await fetch(`/api/reports/${currentReportId}/orders`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        }
        if (resp.ok) {
            closeOrderModal();
            await loadReportData();
            showToast(editingOrderId ? 'Order updated' : 'Order added', 'success');
        } else {
            const err = await resp.json();
            showToast('Failed: ' + (err.detail || 'Unknown'), 'error');
        }
    } catch (e) { showToast('Network error: ' + e.message, 'error'); }
}

async function deleteReportOrder(orderId) {
    if (!confirm('Remove this order from the report?')) return;
    try {
        await fetch(`/api/reports/${currentReportId}/orders/${orderId}`, { method: 'DELETE' });
        await loadReportData();
        showToast('Order removed', 'success');
    } catch (e) { showToast('Failed to delete order', 'error'); }
}

async function showNotesModal(orderId) {
    try {
        const resp = await fetch(`/api/reports/${currentReportId}/orders/${orderId}`);
        const data = await resp.json();
        document.getElementById('modalTitle').textContent = 'Edit Notes';
        document.getElementById('modalBody').innerHTML = `
            <label class="form-full">Notes <textarea id="fldNotes" class="input-sm" rows="4">${data.order.notes || ''}</textarea></label>
            <div class="modal-actions">
                <button class="btn-primary" onclick="saveNotes(${orderId})">Save</button>
                <button class="btn-text" onclick="closeOrderModal()">Cancel</button>
            </div>
        `;
        document.getElementById('orderModal').hidden = false;
        document.querySelector('.view-scroll').style.overflow = 'hidden';
    } catch (e) { showToast('Failed to load order', 'error'); }
}

async function saveNotes(orderId) {
    const notes = document.getElementById('fldNotes')?.value ?? '';
    try {
        await fetch(`/api/reports/${currentReportId}/orders/${orderId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes }),
        });
        closeOrderModal();
        showToast('Notes saved', 'success');
    } catch (e) { showToast('Failed to save notes', 'error'); }
}

// ═══════════════════════════════════════════════════════════════════════
// ── Analytics ───────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

const analyticsState = { store: 'all' };
let chartInstances = {};

function initAnalytics() {
    document.getElementById('analyticsDateTo').value = state.dateTo || new Date().toISOString().substring(0, 10);
    document.getElementById('analyticsDateFrom').value = state.dateFrom || '';
    setupAnalyticsDateListeners();
    loadAnalytics();
}

function setupAnalyticsDateListeners() {
    const fromEl = document.getElementById('analyticsDateFrom');
    const toEl = document.getElementById('analyticsDateTo');
    const today = new Date().toISOString().substring(0, 10);
    fromEl.max = today; toEl.max = today;
    fromEl.addEventListener('change', () => {
        if (fromEl.value) toEl.min = fromEl.value; else toEl.min = '';
        if (toEl.value && fromEl.value > toEl.value) toEl.value = fromEl.value;
        state.dateFrom = fromEl.value;
        state.dateTo = toEl.value;
        // Also sync dashboard inputs
        document.getElementById('filterDateFrom').value = fromEl.value;
        document.getElementById('filterDateTo').value = toEl.value;
        loadAnalytics();
    });
    toEl.addEventListener('change', () => {
        if (toEl.value) fromEl.max = toEl.value; else fromEl.max = today;
        if (fromEl.value && fromEl.value > toEl.value) fromEl.value = toEl.value;
        state.dateFrom = fromEl.value;
        state.dateTo = toEl.value;
        document.getElementById('filterDateFrom').value = fromEl.value;
        document.getElementById('filterDateTo').value = toEl.value;
        loadAnalytics();
    });
}

function setAnalyticsStore(store, el) {
    analyticsState.store = store;
    document.querySelectorAll('#analyticsFilters .chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    loadAnalytics();
}

async function loadAnalytics() {
    const params = getAnalyticsParams();

    const [trendResp, spendResp, countResp] = await Promise.all([
        fetch(`/api/analytics/trend?${params}`),
        fetch(`/api/analytics/top-items?by=spend&limit=5&${params}`),
        fetch(`/api/analytics/top-items?by=count&limit=5&${params}`),
    ]);
    const trendData = await trendResp.json();
    const spendData = await spendResp.json();
    const countData = await countResp.json();

    renderCharts(trendData.trend, spendData.items, countData.items);
}

async function loadTrendOnly() {
    const params = getAnalyticsParams();
    const resp = await fetch(`/api/analytics/trend?${params}`);
    const data = await resp.json();
    renderTrendChart(data.trend);
}

function getAnalyticsParams() {
    const params = new URLSearchParams();
    if (analyticsState.store !== 'all') params.set('store', analyticsState.store);
    if (state.dateFrom) params.set('date_from', state.dateFrom);
    if (state.dateTo) params.set('date_to', state.dateTo);
    return params;
}

function chartColors() {
    const isDark = document.documentElement.classList.contains('dark');
    return {
        food: isDark ? '#81c784' : '#2e7d32',
        foodBg: isDark ? 'rgba(129,199,132,0.15)' : 'rgba(46,125,50,0.1)',
        household: isDark ? '#90caf9' : '#1565c0',
        houseBg: isDark ? 'rgba(144,202,249,0.15)' : 'rgba(21,101,192,0.1)',
        grid: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
        text: isDark ? '#9aa0a6' : '#5f6368',
    };
}

function groupTrendData(data, mode) {
    const fmtDay = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const fmtMonth = (d) => {
        const dt = new Date(d + 'T00:00:00');
        return dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    };
    const fmtWeek = (d) => {
        const dt = new Date(d + 'T00:00:00');
        const day = dt.getDay();
        const monday = new Date(dt);
        monday.setDate(dt.getDate() - (day === 0 ? 6 : day - 1));
        return 'Week of ' + monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    if (mode === 'daily') {
        return {
            labels: data.map(d => fmtDay(d.day)),
            food: data.map(d => d.food),
            household: data.map(d => d.household),
        };
    }

    if (mode === 'weekly') {
        const weeks = {};
        data.forEach(d => {
            const dt = new Date(d.day + 'T00:00:00');
            const day = dt.getDay();
            const monday = new Date(dt);
            monday.setDate(dt.getDate() - (day === 0 ? 6 : day - 1));
            const key = monday.toISOString().substring(0, 10);
            if (!weeks[key]) weeks[key] = { food: 0, household: 0 };
            weeks[key].food += d.food;
            weeks[key].household += d.household;
        });
        const keys = Object.keys(weeks).sort();
        return {
            labels: keys.map(k => fmtWeek(k)),
            food: keys.map(k => weeks[k].food),
            household: keys.map(k => weeks[k].household),
        };
    }

    // monthly
    const months = {};
    data.forEach(d => {
        const key = d.day.substring(0, 7);
        if (!months[key]) months[key] = { food: 0, household: 0 };
        months[key].food += d.food;
        months[key].household += d.household;
    });
    const keys = Object.keys(months).sort();
    return {
        labels: keys.map(k => fmtMonth(k + '-01')),
        food: keys.map(k => months[k].food),
        household: keys.map(k => months[k].household),
    };
}

function renderTrendChart(trend, c) {
    if (!c) c = chartColors();
    const mode = document.getElementById('analyticsGrouping').value;
    const grouped = groupTrendData(trend, mode);

    if (chartInstances.trend) chartInstances.trend.destroy();
    chartInstances.trend = new Chart(document.getElementById('chartTrend'), {
        type: 'line',
        data: {
            labels: grouped.labels,
            datasets: [
                { label: 'Food', data: grouped.food, borderColor: c.food, backgroundColor: c.foodBg, fill: true, tension: 0.3, pointRadius: mode === 'daily' ? 3 : 0 },
                { label: 'Household', data: grouped.household, borderColor: c.household, backgroundColor: c.houseBg, fill: true, tension: 0.3, pointRadius: mode === 'daily' ? 3 : 0 },
            ]
        },
        options: makeLineOptions(c, { stacked: false, ticks: { maxTicksLimit: 6 } }),
    });
}

function renderCharts(trend, topSpend, topCount) {
    // Destroy previous instances
    Object.values(chartInstances).forEach(c => c.destroy());
    chartInstances = {};

    const c = chartColors();

    renderTrendChart(trend, c);

    // ── Doughnut ──
    const foodTotal = trend.reduce((s, t) => s + t.food, 0);
    const houseTotal = trend.reduce((s, t) => s + t.household, 0);
    chartInstances.doughnut = new Chart(document.getElementById('chartDoughnut'), {
        type: 'doughnut',
        data: {
            labels: ['Food', 'Household'],
            datasets: [{ data: [foodTotal, houseTotal], backgroundColor: [c.food, c.household], borderWidth: 0 }]
        },
        options: { ...makeOptions(c), plugins: { legend: { position: 'bottom', labels: { color: c.text, font: { family: 'Google Sans' }, padding: 16 } } } },
    });

    // ── Top Spend (horizontal bar) ──
    chartInstances.topSpend = new Chart(document.getElementById('chartTopSpend'), {
        type: 'bar',
        data: {
            labels: topSpend.map(i => i.name).reverse(),
            datasets: [{
                data: topSpend.map(i => i.total_spend).reverse(),
                backgroundColor: topSpend.map(i => i.category === 'food' ? c.food : c.household).reverse(),
                borderRadius: 4,
            }]
        },
        options: { indexAxis: 'y', ...makeBarOptions(c, { x: { ticks: { callback: v => '$' + v } } }) },
    });

    // ── Top Count (horizontal bar) ──
    chartInstances.topCount = new Chart(document.getElementById('chartTopCount'), {
        type: 'bar',
        data: {
            labels: topCount.map(i => i.name).reverse(),
            datasets: [{
                data: topCount.map(i => i.purchase_count).reverse(),
                backgroundColor: topCount.map(i => i.category === 'food' ? c.food : c.household).reverse(),
                borderRadius: 4,
            }]
        },
        options: { indexAxis: 'y', ...makeBarOptions(c) },
    });
}

function makeOptions(c, overrides = {}) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: document.documentElement.classList.contains('dark') ? '#353535' : '#fff',
                titleColor: c.text, bodyColor: c.text,
                borderColor: c.grid, borderWidth: 1,
                bodyFont: { family: 'Google Sans' },
            }
        },
        scales: {
            x: { grid: { color: c.grid }, ticks: { color: c.text, font: { size: 11 } }, ...overrides.x },
            y: { grid: { display: false }, ticks: { color: c.text, font: { size: 11 } } },
        },
    };
}

function makeBarOptions(c, overrides = {}) {
    return {
        ...makeOptions(c, overrides),
        interaction: { intersect: true, mode: 'nearest' },
    };
}

function makeLineOptions(c, overrides = {}) {
    return {
        ...makeOptions(c, overrides),
        interaction: { intersect: false, mode: 'nearest', axis: 'x' },
    };
}

// Redraw charts on theme change
const origToggleDarkMode = toggleDarkMode;
toggleDarkMode = function () {
    origToggleDarkMode();
    setTimeout(() => {
        if (!document.getElementById('analyticsView').hidden) loadAnalytics();
    }, 400);
};
