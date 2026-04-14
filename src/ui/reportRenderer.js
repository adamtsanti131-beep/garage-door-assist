/**
 * reportRenderer.js
 * Renders a report object into the DOM report section.
 * Supports the new report shape: summary + waste/opportunities/controlRisks/measurementRisks
 */

export function renderReport(report) {
  const section = document.getElementById('report-section');
  section.style.display = '';

  document.getElementById('report-date').textContent = new Date(report.timestamp)
    .toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });

  renderSummary(report.summary);
  renderFindings('items-waste',            report.waste,            'No waste detected — budget looks well targeted.');
  renderFindings('items-opportunities',    report.opportunities,    'No clear scaling opportunities identified yet.');
  renderFindings('items-control-risks',    report.controlRisks,     'No structural control issues found.');
  renderFindings('items-measurement-risks',report.measurementRisks, 'No measurement or tracking issues detected.');
  renderActions ('items-actions',          report.topActions);

  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Summary bar ───────────────────────────────────────────────────────────────

function renderSummary(summary) {
  const el = document.getElementById('report-summary');
  if (!el || !summary) return;

  const spend = summary.totalSpend != null
    ? `CA$${summary.totalSpend.toFixed(2)}`
    : '—';
  const conv = summary.totalConversions != null
    ? summary.totalConversions.toFixed(1)
    : '—';
  const cpa = summary.avgCpa != null
    ? `CA$${summary.avgCpa.toFixed(2)}`
    : '—';
  const high = summary.highSeverityCount ?? 0;
  const best = summary.bestPerformer
    ? `"${esc(summary.bestPerformer.label)}" — CA$${summary.bestPerformer.cpa.toFixed(0)}/conv`
    : 'Not enough data';

  el.innerHTML = `
    <div class="summary-stat"><span class="summary-label">Total Spend</span><span class="summary-value">${spend}</span></div>
    <div class="summary-stat"><span class="summary-label">Conversions</span><span class="summary-value">${conv}</span></div>
    <div class="summary-stat"><span class="summary-label">Avg. CPA</span><span class="summary-value">${cpa}</span></div>
    <div class="summary-stat ${high > 0 ? 'summary-stat--alert' : ''}"><span class="summary-label">High Priority</span><span class="summary-value">${high} item${high !== 1 ? 's' : ''}</span></div>
    <div class="summary-stat summary-stat--wide"><span class="summary-label">Best Performer</span><span class="summary-value">${best}</span></div>
  `;
}

// ── Findings ──────────────────────────────────────────────────────────────────

function renderFindings(containerId, items, emptyMessage) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  if (!items || items.length === 0) {
    container.innerHTML = `<p class="report-empty">${emptyMessage}</p>`;
    return;
  }

  for (const item of items) {
    const el = document.createElement('div');
    el.className = `report-item report-item--${item.severity ?? 'medium'}`;
    el.innerHTML = `
      <div class="report-item-header">
        <span class="report-item-badge report-item-badge--${item.severity ?? 'medium'}">${esc(item.severity ?? 'medium')}</span>
        <strong class="report-item-what">${esc(item.what)}</strong>
      </div>
      <p class="report-item-why">${esc(item.why)}</p>
      <p class="report-item-action"><strong>Action:</strong> ${esc(item.action)}</p>
    `;
    container.appendChild(el);
  }
}

// ── Top Actions ───────────────────────────────────────────────────────────────

function renderActions(containerId, actions) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  if (!actions || actions.length === 0) {
    container.innerHTML = `<p class="report-empty">No actions generated.</p>`;
    return;
  }

  actions.forEach((a, idx) => {
    const el = document.createElement('div');
    el.className = 'report-item';
    el.innerHTML = `
      <strong>${idx + 1}. ${esc(a.action)}</strong>
      <span class="item-detail">${esc(a.reason)}</span>
    `;
    container.appendChild(el);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
