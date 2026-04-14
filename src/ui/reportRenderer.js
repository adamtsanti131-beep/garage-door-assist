/**
 * reportRenderer.js
 * Renders a report object into the DOM report section.
 */

/**
 * Render a full report to the #report-section element.
 * Shows the section if it was hidden, and scrolls it into view.
 * @param {Object} report - From reportBuilder.buildReport()
 */
export function renderReport(report) {
  const section = document.getElementById('report-section');
  const dateEl  = document.getElementById('report-date');

  // Make section visible
  section.style.display = '';

  // Formatted date
  dateEl.textContent = new Date(report.timestamp).toLocaleString('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  renderItems('items-critical',     report.criticalIssues, 'No critical issues found — good work!');
  renderItems('items-improvements', report.improvements,   'No improvements flagged.');
  renderItems('items-working',      report.whatsWorking,   'Not enough data to identify top performers yet.');
  renderActions('items-actions',    report.topActions);

  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Render helpers ────────────────────────────────────────────────────────────

/** Render an array of finding items (critical / improvements / working). */
function renderItems(containerId, items, emptyMessage) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  if (!items || items.length === 0) {
    container.innerHTML = `<p class="report-empty">${emptyMessage}</p>`;
    return;
  }

  for (const item of items) {
    const el = document.createElement('div');
    el.className = 'report-item';
    el.innerHTML = `
      <strong>${esc(item.title)}</strong>
      <span class="item-detail">${esc(item.detail)}</span>
    `;
    container.appendChild(el);
  }
}

/** Render the top 3 action items. */
function renderActions(containerId, actions) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  if (!actions || actions.length === 0) {
    container.innerHTML = `<p class="report-empty">No actions generated.</p>`;
    return;
  }

  actions.forEach((action, idx) => {
    const el = document.createElement('div');
    el.className = 'report-item';
    el.innerHTML = `
      <strong>${idx + 1}. ${esc(action.action)}</strong>
      <span class="item-detail">Why: ${esc(action.reason)}</span>
    `;
    container.appendChild(el);
  });
}

/** Escape HTML special characters to prevent XSS from CSV data. */
function esc(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
