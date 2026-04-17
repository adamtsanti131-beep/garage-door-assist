/**
 * mondayPanel.js
 * UI for the Monday.com CRM connection panel.
 * Credentials are server-side (.env). Browser shows only date range + fetch.
 *
 * Uses event delegation: ONE click listener on #monday-form at init time.
 * This survives every innerHTML re-render without losing listeners.
 */

import { loadMondayConfig, saveMondayConfig, clearMondayConfig } from '../storage/mondayConfig.js';

export function initMondayPanel() {
  const toggleBtn = document.getElementById('monday-toggle-btn');
  const body      = document.getElementById('monday-panel-body');
  const formEl    = document.getElementById('monday-form');

  if (!toggleBtn || !body || !formEl) return;

  // ── Single delegated listener — survives every re-render ──────────────────
  formEl.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'btn-monday-fetch') { e.preventDefault(); handleFetch(formEl); }
    if (btn.id === 'btn-monday-clear') { e.preventDefault(); handleClear(formEl); }
  });

  // ── Toggle open/close ──────────────────────────────────────────────────────
  toggleBtn.addEventListener('click', () => {
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : '';
    toggleBtn.textContent = isOpen ? '▼' : '▲';
  });

  // ── Initial render ─────────────────────────────────────────────────────────
  const config = loadMondayConfig();
  renderPanel(formEl, config);

  if (config.mondayContext) {
    body.style.display = 'none';
    toggleBtn.textContent = '▼';
    updateHeaderStatus(config.mondayContext, config.lastFetched, config.dateFrom, config.dateTo);
  }

  // Keep panel in sync when context is updated by fetch
  document.addEventListener('monday-context-updated', () => {
    const updated = loadMondayConfig();
    renderPanel(formEl, updated);
    updateHeaderStatus(updated.mondayContext, updated.lastFetched, updated.dateFrom, updated.dateTo);
  });
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderPanel(formEl, config, statusMessage = '') {
  if (!formEl) return;

  let html = `
    <div class="monday-fields">
      <div class="monday-field">
        <label for="monday-from">מתאריך</label>
        <input type="date" id="monday-from" value="${esc(config.dateFrom ?? '')}" />
      </div>
      <div class="monday-field">
        <label for="monday-to">עד תאריך</label>
        <input type="date" id="monday-to" value="${esc(config.dateTo ?? '')}" />
      </div>
    </div>
    <div class="monday-actions">
      <button type="button" class="btn-monday-fetch" id="btn-monday-fetch">משוך נתונים</button>
      ${config.mondayContext ? '<button type="button" class="btn-monday-clear" id="btn-monday-clear">נקה נתונים</button>' : ''}
    </div>
    <div class="monday-status" id="monday-status">${esc(statusMessage)}</div>
  `;

  if (config.mondayContext) {
    try {
      html += renderKpiSummary(config.mondayContext, config.lastFetched, config.dateFrom, config.dateTo);
    } catch (err) {
      console.error('[MondayPanel] renderKpiSummary failed:', err);
    }
  }

  formEl.innerHTML = html;

  // Persist date range on change (delegates can't use this — inputs need their own listeners)
  formEl.querySelector('#monday-from')?.addEventListener('change', e => {
    saveMondayConfig({ dateFrom: e.target.value });
  });
  formEl.querySelector('#monday-to')?.addEventListener('change', e => {
    saveMondayConfig({ dateTo: e.target.value });
  });
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function handleFetch(formEl) {
  console.log('[MondayPanel] fetch triggered');

  const dateFrom = formEl.querySelector('#monday-from')?.value?.trim() || null;
  const dateTo   = formEl.querySelector('#monday-to')?.value?.trim()   || null;
  const fetchBtn = formEl.querySelector('#btn-monday-fetch');

  if (fetchBtn) { fetchBtn.disabled = true; fetchBtn.textContent = 'מושך נתונים...'; }

  try {
    console.log('[MondayPanel] POST /monday/fetch', { dateFrom, dateTo });
    const res  = await fetch('/monday/fetch', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ dateFrom, dateTo }),
    });

    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      // If response is not JSON, treat as error
      data = null;
    }

    if (!res.ok) {
      const errMsg = (data && data.error) ? data.error : `שגיאה (${res.status})`;
      console.warn('[MondayPanel] fetch failed:', errMsg);
      saveMondayConfig({ mondayContext: null, lastFetched: null });
      renderPanel(formEl, loadMondayConfig(), errMsg);
      updateHeaderStatus(null, null, null, null);
      return;
    }

    const lastFetched = new Date().toISOString();
    saveMondayConfig({ dateFrom: dateFrom ?? '', dateTo: dateTo ?? '', lastFetched, mondayContext: data });
    // Let the monday-context-updated listener handle the re-render so there is one code path
    document.dispatchEvent(new CustomEvent('monday-context-updated', { detail: data }));

  } catch (err) {
    const msg = `לא ניתן להתחבר לשרת: ${err?.message ?? ''}`.trim();
    console.error('[MondayPanel] fetch error:', err);
    renderPanel(formEl, loadMondayConfig(), msg);
  }
}

// ── Clear ─────────────────────────────────────────────────────────────────────

function handleClear(formEl) {
  clearMondayConfig();
  renderPanel(formEl, { dateFrom: '', dateTo: '', mondayContext: null });
  updateHeaderStatus(null, null, null, null);
  document.dispatchEvent(new CustomEvent('monday-context-updated', { detail: null }));
}

// ── KPI summary block ─────────────────────────────────────────────────────────

function renderKpiSummary(ctx, lastFetched, dateFrom, dateTo) {
  if (!ctx) return '';

  const fmt  = (v, prefix = '') => v != null ? `${prefix}${Number(v).toLocaleString('he-IL', { maximumFractionDigits: 0 })}` : '—';
  const fmtP = v => v != null ? `${(v * 100).toFixed(1)}%` : '—';
  const dt   = lastFetched ? new Date(lastFetched).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '';
  const range = (dateFrom || dateTo)
    ? ` | ${dateFrom ?? ''}${dateFrom && dateTo ? ' — ' : ''}${dateTo ?? ''}`
    : '';

  const warnings = (ctx.warnings ?? []).length
    ? `<div class="monday-warnings">${ctx.warnings.map(w => `<div>⚠ ${esc(w)}</div>`).join('')}</div>`
    : '';

  return `
    <div class="monday-kpi-block">
      <div class="monday-kpi-block-title">CRM — Google Ads בלבד${range}${dt ? ` (עודכן: ${dt})` : ''}</div>
      <div class="monday-kpi-grid">
        ${kpiTile('לידים ממומנים', fmt(ctx.paidLeadCount))}
        ${kpiTile('הוזמנו', fmt(ctx.bookedCount))}
        ${kpiTile('נסגרו', fmt(ctx.closedCount))}
        ${kpiTile('בוטלו', fmt(ctx.lostCount))}
        ${kpiTile('שיעור הזמנה', fmtP(ctx.bookRate))}
        ${kpiTile('שיעור סגירה', fmtP(ctx.closeRate))}
        ${kpiTile('הכנסה ממוצעת (Net)', fmt(ctx.avgNetRevenue, 'CA$'))}
        ${kpiTile('רווח ממוצע (Net-חלקים)', fmt(ctx.avgNetLessParts, 'CA$'))}
        ${kpiTile('סה״כ הכנסה (Net)', fmt(ctx.totalNetRevenue, 'CA$'))}
        ${kpiTile('סה״כ רווח (Net-חלקים)', fmt(ctx.totalNetLessParts, 'CA$'))}
        ${kpiTile('סה״כ מכירות (ברוטו+מע״מ)', fmt(ctx.totalGrossSoldIncludingGst, 'CA$'))}
      </div>
      ${warnings}
    </div>
  `;
}

function kpiTile(label, value) {
  return `<div class="monday-kpi-item"><span class="kpi-label">${esc(label)}</span><span class="kpi-value">${value}</span></div>`;
}

// ── Header status badge ───────────────────────────────────────────────────────

export function updateHeaderStatus(ctx, lastFetched, dateFrom, dateTo) {
  const statusEl = document.getElementById('monday-header-status');
  if (!statusEl) return;

  if (!ctx) {
    statusEl.textContent = 'לא מחובר';
    statusEl.className   = 'monday-header-status';
    return;
  }

  const range = (dateFrom || dateTo)
    ? ` | ${dateFrom ?? ''}${dateFrom && dateTo ? '–' : ''}${dateTo ?? ''}`
    : '';
  const dt = lastFetched
    ? new Date(lastFetched).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
    : '';

  statusEl.textContent = `${ctx.paidLeadCount} לידים | ${ctx.closedCount} נסגרו${range} | עודכן ${dt}`;
  statusEl.className   = 'monday-header-status monday-header-status--connected';
}

// ── Utility ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
