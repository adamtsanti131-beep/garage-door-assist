/**
 * historyPanel.js
 * Renders the analysis history list and handles user interactions.
 */

import { getHistory, clearHistory } from '../storage/history.js';

/**
 * Initialize the history panel.
 * @param {Function} onLoadReport - Called with a report object when user clicks an entry
 */
export function initHistoryPanel(onLoadReport) {
  renderList(onLoadReport);

  document.getElementById('btn-clear-history')?.addEventListener('click', () => {
    if (confirm('למחוק את כל היסטוריית הניתוחים? לא ניתן לשחזר.')) {
      clearHistory();
      renderList(onLoadReport);
    }
  });
}

/**
 * Re-render the history list after a new entry is saved.
 * @param {Function} onLoadReport
 */
export function refreshHistoryPanel(onLoadReport) {
  renderList(onLoadReport);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderList(onLoadReport) {
  const listEl = document.getElementById('history-list');
  if (!listEl) return;

  const history = getHistory();
  listEl.innerHTML = '';

  if (history.length === 0) {
    listEl.innerHTML = '<p class="history-empty">אין עדיין ניתוחים קודמים.</p>';
    return;
  }

  for (const entry of history) {
    const el = document.createElement('div');
    el.className = 'history-item';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');

    const dateStr = new Date(entry.timestamp).toLocaleString('he-IL', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    el.innerHTML = `
      <div class="history-item-left">
        <span class="history-item-date">${esc(dateStr)}</span>
        <span class="history-item-summary">${esc(entry.summary)}</span>
      </div>
      <span class="history-item-arrow">→</span>
    `;

    el.addEventListener('click', () => onLoadReport(entry.report));
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') onLoadReport(entry.report);
    });

    listEl.appendChild(el);
  }
}

function esc(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
