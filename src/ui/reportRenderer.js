/**
 * reportRenderer.js
 * Renders a report object into the DOM report section.
 * Decision-first output for non-expert users, with category findings as support.
 */

export function renderReport(report) {
  const section = document.getElementById('report-section');
  section.style.display = '';

  document.getElementById('report-date').textContent = new Date(report.timestamp)
    .toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });

  renderSummary(report.summary);
  renderAccountStatus(report.decisionFlow?.accountStatus);
  renderDecisionOrder(report.decisionFlow?.decisionOrder ?? []);
  renderDecisionBuckets(report.decisionFlow?.decisionBuckets ?? {});
  renderCoverage(report.decisionFlow?.reportCoverage ?? [], report.decisionFlow?.missingBusinessContext ?? []);
  renderLimitations(report.decisionFlow?.knowledgeBoundaries);

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
  const totalsSource = summary.totalsSource ? esc(summary.totalsSource) : 'none';

  el.innerHTML = `
    <div class="summary-stat"><span class="summary-label">Total Spend</span><span class="summary-value">${spend}</span></div>
    <div class="summary-stat"><span class="summary-label">Conversions</span><span class="summary-value">${conv}</span></div>
    <div class="summary-stat"><span class="summary-label">Avg. CPA</span><span class="summary-value">${cpa}</span></div>
    <div class="summary-stat ${high > 0 ? 'summary-stat--alert' : ''}"><span class="summary-label">High Priority</span><span class="summary-value">${high} item${high !== 1 ? 's' : ''}</span></div>
    <div class="summary-stat summary-stat--wide"><span class="summary-label">Best Performer</span><span class="summary-value">${best}</span></div>
    <div class="summary-stat summary-stat--wide"><span class="summary-label">Totals Source</span><span class="summary-value">${totalsSource}</span></div>
  `;
}

function renderAccountStatus(status) {
  const container = document.getElementById('account-status');
  if (!container) return;

  if (!status) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div class="status-card status-card--${esc(status.readiness)}">
      <strong>Account Status: ${esc(status.headline)}</strong>
      <span>Measurement trust: ${esc(status.measurementTrust)}</span>
      <span>High-priority actions: ${esc(String(status.highPriorityActions))}</span>
      <span>Blocked actions: ${esc(String(status.blockedActions))}</span>
      <span>Missing reports: ${esc(String(status.missingReportsCount))}</span>
      <span>Missing business settings: ${esc(String(status.missingBusinessContextCount))}</span>
    </div>
  `;
}

function renderDecisionOrder(steps) {
  const container = document.getElementById('decision-order');
  if (!container) return;

  if (!steps.length) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = steps
    .map((step, idx) => `<div class="decision-step"><span>${idx + 1}</span>${esc(step)}</div>`)
    .join('');
}

function renderDecisionBuckets(buckets) {
  renderDecisionList(
    'items-immediate-actions',
    buckets.immediateActions,
    'No immediate action required right now.'
  );
  renderDecisionList(
    'items-review-actions',
    buckets.reviewBeforeAction,
    'No review-only actions currently flagged.'
  );
  renderDecisionList(
    'items-secondary-actions',
    buckets.secondaryActions,
    'No secondary actions currently flagged.'
  );
  renderDecisionList(
    'items-hold-actions',
    buckets.doNotTouchYet,
    'Nothing is currently blocked or on hold.'
  );
  renderDecisionList(
    'items-scale-actions',
    buckets.scaleLater,
    'No scale-later actions are safe yet.'
  );
}

function renderDecisionList(containerId, items, emptyMessage) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  if (!items || items.length === 0) {
    container.innerHTML = `<p class="report-empty">${emptyMessage}</p>`;
    return;
  }

  for (const d of items) {
    const el = document.createElement('div');
    el.className = 'report-item report-item--decision';
    el.innerHTML = `
      <div class="report-item-header">
        <span class="report-item-badge report-item-badge--${confidenceTone(d.confidence)}">${esc(d.confidence)}</span>
        <strong class="report-item-what">${esc(d.user_instruction)}</strong>
      </div>
      <p class="report-item-why"><strong>Why:</strong> ${esc(d.reason)}</p>
      <p class="report-item-action"><strong>Entity:</strong> ${esc(d.entity_level)} / ${esc(d.entity_name)}</p>
      <p class="report-item-action"><strong>Step:</strong> ${esc(String(d.execution_step))} | <strong>Priority:</strong> ${esc(String(d.action_priority))}</p>
      <p class="report-item-action"><strong>Safety:</strong> ${esc(formatSafety(d.safety_classification))}</p>
      <p class="report-item-action"><strong>Prerequisite:</strong> ${esc(d.prerequisite)}</p>
      <p class="report-item-action"><strong>How to execute:</strong> ${esc((d.operator_steps ?? []).slice(0, 2).join(' -> '))}</p>
      <p class="report-item-action"><strong>Monitor:</strong> ${esc(d.monitor_after_change ?? 'Monitor performance after this change.')}</p>
      <p class="report-item-action"><strong>Reassess:</strong> ${esc(d.reassess_timing ?? 'Re-upload reports after changes and reassess.')}</p>
      <p class="report-item-action"><strong>Expected outcome:</strong> ${esc(d.expected_outcome)}</p>
      <p class="report-item-action"><strong>Risk if ignored:</strong> ${esc(d.risk_if_ignored)}</p>
      <p class="report-item-action"><strong>Evidence state:</strong> ${esc(d.evidence_state)}${d.blocked_by_tracking ? ' | Blocked by tracking trust' : ''}${d.requires_business_context ? ' | Needs business context' : ''}</p>
    `;
    container.appendChild(el);
  }
}

function renderCoverage(reportCoverage, missingBusinessContext) {
  const container = document.getElementById('items-report-coverage');
  if (!container) return;

  const rows = [];
  for (const item of reportCoverage) {
    rows.push(`
      <div class="report-item">
        <strong>${esc(item.label)}: ${item.present ? 'Uploaded' : 'Missing'}</strong>
        <span class="item-detail">Rows: ${esc(String(item.rowCount))} | Used for: ${esc(item.usedFor)}</span>
        ${item.impactIfMissing ? `<span class="item-detail">Impact: ${esc(item.impactIfMissing)}</span>` : ''}
      </div>
    `);
  }

  if (missingBusinessContext.length > 0) {
    rows.push(`
      <div class="report-item">
        <strong>Missing business settings</strong>
        <span class="item-detail">${esc(missingBusinessContext.join(', '))}</span>
      </div>
    `);
  }

  container.innerHTML = rows.length > 0
    ? rows.join('')
    : '<p class="report-empty">No coverage information available.</p>';
}

function renderLimitations(boundaries) {
  const container = document.getElementById('items-limitations');
  if (!container) return;
  if (!boundaries) {
    container.innerHTML = '<p class="report-empty">No limitations data available.</p>';
    return;
  }

  const html = [
    buildLimitationGroup('Confirmed from data', boundaries.confirmed),
    buildLimitationGroup('Likely but inferred', boundaries.likely),
    buildLimitationGroup('Unknown from CSV alone', boundaries.unknown),
  ].join('');

  container.innerHTML = html;
}

function buildLimitationGroup(title, items = []) {
  if (!items.length) return '';
  return `
    <div class="report-item">
      <strong>${esc(title)}</strong>
      ${items.map(i => `<span class="item-detail">• ${esc(i)}</span>`).join('')}
    </div>
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

function confidenceTone(confidence) {
  if (confidence === 'High confidence') return 'high';
  if (confidence === 'Medium confidence') return 'medium';
  return 'low';
}

function formatSafety(value) {
  const map = {
    safe_to_do_now: 'Safe to do now',
    review_before_acting: 'Review before acting',
    not_safe_from_csv_alone: 'Not safe from CSV alone',
    blocked_until_tracking_trusted: 'Blocked until tracking is trusted',
    blocked_until_business_context_provided: 'Blocked until business context is provided',
  };
  return map[value] ?? String(value ?? 'Unknown');
}
