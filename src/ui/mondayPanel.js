/**
 * mondayPanel.js
 * UI for the Monday.com CRM connection panel.
 * Manual-trigger only — user clicks "התחבר" to fetch data.
 */

import { loadMondayConfig, saveMondayConfig, clearMondayConfig } from '../storage/mondayConfig.js';

export function initMondayPanel() {
  const toggleBtn = document.getElementById('monday-toggle-btn');
  const body      = document.getElementById('monday-panel-body');
  const formEl    = document.getElementById('monday-form');

  if (!toggleBtn || !body || !formEl) return;

  // Load saved config and render
  const config = loadMondayConfig();
  renderPanel(config);

  // Toggle panel open/close
  toggleBtn.addEventListener('click', () => {
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : '';
    toggleBtn.textContent = isOpen ? '▼' : '▲';
  });

  // Start collapsed if already connected
  if (config.mondayContext) {
    body.style.display = 'none';
    toggleBtn.textContent = '▼';
    updateHeaderStatus(config.mondayContext, config.lastFetched);
  }
}

function renderPanel(config) {
  const formEl = document.getElementById('monday-form');
  if (!formEl) return;

  formEl.innerHTML = `
    <div class="monday-fields">
      <div class="monday-field">
        <label for="monday-token">API Token</label>
        <input type="password" id="monday-token" placeholder="הזן טוקן API של Monday.com"
               value="${esc(config.apiToken ?? '')}" autocomplete="off" />
      </div>
      <div class="monday-field">
        <label for="monday-board">Board ID</label>
        <input type="text" id="monday-board" placeholder="מזהה הלוח (מספרי)"
               value="${esc(config.boardId ?? '')}" />
      </div>
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
      <button class="btn-monday-fetch" id="btn-monday-fetch">התחבר</button>
      ${config.mondayContext ? '<button class="btn-monday-clear" id="btn-monday-clear">נקה חיבור</button>' : ''}
    </div>
    <div class="monday-status" id="monday-status"></div>
    ${config.mondayContext ? renderKpiSummary(config.mondayContext, config.lastFetched) : ''}
  `;

  document.getElementById('btn-monday-fetch')?.addEventListener('click', handleFetch);
  document.getElementById('btn-monday-clear')?.addEventListener('click', handleClear);
}

async function handleFetch() {
  const token    = document.getElementById('monday-token')?.value?.trim();
  const boardId  = document.getElementById('monday-board')?.value?.trim();
  const dateFrom = document.getElementById('monday-from')?.value?.trim() || null;
  const dateTo   = document.getElementById('monday-to')?.value?.trim()   || null;
  const statusEl = document.getElementById('monday-status');
  const fetchBtn = document.getElementById('btn-monday-fetch');

  if (!token || !boardId) {
    if (statusEl) statusEl.textContent = 'יש להזין טוקן API ומזהה לוח';
    return;
  }

  if (fetchBtn) { fetchBtn.disabled = true; fetchBtn.textContent = 'מתחבר...'; }
  if (statusEl) statusEl.textContent = '';

  try {
    const res = await fetch('/monday/fetch', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ apiToken: token, boardId, dateFrom, dateTo }),
    });

    const data = await res.json();

    if (!res.ok) {
      if (statusEl) statusEl.textContent = data.error ?? `שגיאה (${res.status})`;
      return;
    }

    const lastFetched = new Date().toISOString();
    saveMondayConfig({ apiToken: token, boardId, dateFrom, dateTo, lastFetched, mondayContext: data });
    updateHeaderStatus(data, lastFetched);
    renderPanel(loadMondayConfig());

    document.dispatchEvent(new CustomEvent('monday-context-updated', { detail: data }));

  } catch (err) {
    if (statusEl) statusEl.textContent = 'לא ניתן להתחבר לשרת';
    console.error('[MondayPanel]', err);
  } finally {
    if (fetchBtn) { fetchBtn.disabled = false; fetchBtn.textContent = 'התחבר'; }
  }
}

function handleClear() {
  clearMondayConfig();
  updateHeaderStatus(null, null);
  renderPanel({ apiToken: '', boardId: '', dateFrom: '', dateTo: '', mondayContext: null });
  document.dispatchEvent(new CustomEvent('monday-context-updated', { detail: null }));
}

function renderKpiSummary(ctx, lastFetched) {
  if (!ctx) return '';

  const fmt  = (v, prefix = '') => v != null ? `${prefix}${Number(v).toLocaleString('he-IL', { maximumFractionDigits: 0 })}` : '—';
  const fmtP = v => v != null ? `${(v * 100).toFixed(1)}%` : '—';
  const dt   = lastFetched ? new Date(lastFetched).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '';

  return `
    <div class="monday-kpi-block">
      <div class="monday-kpi-block-title">CRM — נתוני Google Ads בלבד${dt ? ` (עודכן: ${dt})` : ''}</div>
      <div class="monday-kpi-grid">
        ${kpiTile('לידים (ממומן)', fmt(ctx.paidLeadCount))}
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
      ${ctx.warnings?.length ? `<div class="monday-warnings">${ctx.warnings.map(w => `<div>⚠ ${esc(w)}</div>`).join('')}</div>` : ''}
    </div>
  `;
}

function kpiTile(label, value) {
  return `<div class="monday-kpi-item"><span class="kpi-label">${esc(label)}</span><span class="kpi-value">${value}</span></div>`;
}

export function updateHeaderStatus(ctx, lastFetched) {
  const statusEl = document.getElementById('monday-header-status');
  if (!statusEl) return;
  if (!ctx) {
    statusEl.textContent = 'לא מחובר';
    statusEl.className = 'monday-header-status';
    return;
  }
  const dt = lastFetched ? new Date(lastFetched).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '';
  statusEl.textContent = `${ctx.paidLeadCount} לידים | ${ctx.closedCount} נסגרו | עודכן ${dt}`;
  statusEl.className   = 'monday-header-status monday-header-status--connected';
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
