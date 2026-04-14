/**
 * reportRenderer.js
 * Renders a report object into the DOM report section.
 * Decision-first output for non-expert users, with category findings as support.
 */

export function renderReport(report) {
  const section = document.getElementById('report-section');
  section.style.display = '';

  document.getElementById('report-date').textContent = new Date(report.timestamp)
    .toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' });

  renderSummary(report.summary);
  renderAccountStatus(report.decisionFlow?.accountStatus);
  renderDecisionOrder(report.decisionFlow?.decisionOrder ?? []);
  renderDecisionBuckets(report.decisionFlow?.decisionBuckets ?? {});
  renderCoverage(report.decisionFlow?.reportCoverage ?? [], report.decisionFlow?.missingBusinessContext ?? []);
  renderLimitations(report.decisionFlow?.knowledgeBoundaries);

  renderFindings('items-waste',            report.waste,            'לא זוהה בזבוז — התקציב נראה ממוקד היטב.');
  renderFindings('items-opportunities',    report.opportunities,    'עדיין לא זוהו הזדמנויות סקייל ברורות.');
  renderFindings('items-control-risks',    report.controlRisks,     'לא נמצאו בעיות שליטה מבניות.');
  renderFindings('items-measurement-risks',report.measurementRisks, 'לא זוהו סיכוני מדידה או מעקב.');
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
    : 'אין מספיק נתונים';
  const totalsSource = summary.totalsSource ? esc(formatDataSource(summary.totalsSource)) : 'ללא';

  el.innerHTML = `
    <div class="summary-stat"><span class="summary-label">סך הוצאה</span><span class="summary-value">${spend}</span></div>
    <div class="summary-stat"><span class="summary-label">המרות</span><span class="summary-value">${conv}</span></div>
    <div class="summary-stat"><span class="summary-label">CPA ממוצע</span><span class="summary-value">${cpa}</span></div>
    <div class="summary-stat ${high > 0 ? 'summary-stat--alert' : ''}"><span class="summary-label">עדיפות גבוהה</span><span class="summary-value">${high} פריטים</span></div>
    <div class="summary-stat summary-stat--wide"><span class="summary-label">הביצוע הטוב ביותר</span><span class="summary-value">${best}</span></div>
    <div class="summary-stat summary-stat--wide"><span class="summary-label">מקור הסכומים</span><span class="summary-value">${totalsSource}</span></div>
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
      <strong>סטטוס חשבון: ${esc(status.headline)}</strong>
      <span>אמון במדידה: ${esc(formatMeasurementTrust(status.measurementTrust))}</span>
      <span>פעולות בעדיפות גבוהה: ${esc(String(status.highPriorityActions))}</span>
      <span>פעולות חסומות: ${esc(String(status.blockedActions))}</span>
      <span>דוחות חסרים: ${esc(String(status.missingReportsCount))}</span>
      <span>שדות עסקיים חסרים: ${esc(String(status.missingBusinessContextCount))}</span>
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
    'אין כרגע פעולה מיידית נדרשת.'
  );
  renderDecisionList(
    'items-review-actions',
    buckets.reviewBeforeAction,
    'אין כרגע פעולות שסומנו לבדיקה בלבד.'
  );
  renderDecisionList(
    'items-secondary-actions',
    buckets.secondaryActions,
    'אין כרגע פעולות משניות שסומנו.'
  );
  renderDecisionList(
    'items-hold-actions',
    buckets.doNotTouchYet,
    'אין כרגע פעולות חסומות או בהמתנה.'
  );
  renderDecisionList(
    'items-scale-actions',
    buckets.scaleLater,
    'אין עדיין פעולות סקייל בטוחות לביצוע.'
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
        <span class="report-item-badge report-item-badge--${confidenceTone(d.confidence)}">${esc(formatConfidence(d.confidence))}</span>
        <strong class="report-item-what">${esc(d.user_instruction)}</strong>
      </div>
      <p class="report-item-why"><strong>למה:</strong> ${esc(d.reason)}</p>
      <p class="report-item-action"><strong>ישות:</strong> ${esc(d.entity_level)} / ${esc(d.entity_name)}</p>
      <p class="report-item-action"><strong>שלב:</strong> ${esc(String(d.execution_step))} | <strong>עדיפות:</strong> ${esc(String(d.action_priority))}</p>
      <p class="report-item-action"><strong>רמת בטיחות:</strong> ${esc(formatSafety(d.safety_classification))}</p>
      <p class="report-item-action"><strong>תנאי סף:</strong> ${esc(d.prerequisite)}</p>
      <p class="report-item-action"><strong>איך לבצע:</strong> ${esc((d.operator_steps ?? []).slice(0, 2).join(' -> '))}</p>
      <p class="report-item-action"><strong>מה לנטר:</strong> ${esc(d.monitor_after_change ?? 'יש לנטר ביצועים לאחר השינוי.')}</p>
      <p class="report-item-action"><strong>מתי לבדוק שוב:</strong> ${esc(d.reassess_timing ?? 'יש להעלות מחדש דוחות לאחר שינויים ולבחון שוב.')}</p>
      <p class="report-item-action"><strong>תוצאה צפויה:</strong> ${esc(d.expected_outcome)}</p>
      <p class="report-item-action"><strong>סיכון אם מתעלמים:</strong> ${esc(d.risk_if_ignored)}</p>
      <p class="report-item-action"><strong>מצב הראיות:</strong> ${esc(formatEvidenceState(d.evidence_state))}${d.blocked_by_tracking ? ' | חסום עד חיזוק אמון המדידה' : ''}${d.requires_business_context ? ' | דורש הקשר עסקי' : ''}</p>
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
        <strong>${esc(item.label)}: ${item.present ? 'הועלה' : 'חסר'}</strong>
        <span class="item-detail">שורות: ${esc(String(item.rowCount))} | משמש עבור: ${esc(item.usedFor)}</span>
        ${item.impactIfMissing ? `<span class="item-detail">השפעה: ${esc(item.impactIfMissing)}</span>` : ''}
      </div>
    `);
  }

  if (missingBusinessContext.length > 0) {
    rows.push(`
      <div class="report-item">
        <strong>הגדרות עסקיות חסרות</strong>
        <span class="item-detail">${esc(missingBusinessContext.map(formatContextKey).join(', '))}</span>
      </div>
    `);
  }

  container.innerHTML = rows.length > 0
    ? rows.join('')
    : '<p class="report-empty">אין מידע זמין על כיסוי דוחות.</p>';
}

function renderLimitations(boundaries) {
  const container = document.getElementById('items-limitations');
  if (!container) return;
  if (!boundaries) {
    container.innerHTML = '<p class="report-empty">אין כרגע מידע על מגבלות הידע.</p>';
    return;
  }

  const html = [
    buildLimitationGroup('מאומת מתוך הנתונים', boundaries.confirmed),
    buildLimitationGroup('סביר אך מוסק', boundaries.likely),
    buildLimitationGroup('לא ידוע מתוך CSV בלבד', boundaries.unknown),
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
      <p class="report-item-action"><strong>פעולה:</strong> ${esc(item.action)}</p>
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
    container.innerHTML = `<p class="report-empty">לא נוצרו פעולות.</p>`;
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
  if (confidence === 'ביטחון גבוה' || confidence === 'High confidence') return 'high';
  if (confidence === 'ביטחון בינוני' || confidence === 'Medium confidence') return 'medium';
  return 'low';
}

function formatSafety(value) {
  const map = {
    safe_to_do_now: 'Safe to do now',
    review_before_acting: 'לבדוק לפני פעולה',
    not_safe_from_csv_alone: 'לא בטוח לפעול על סמך CSV בלבד',
    blocked_until_tracking_trusted: 'חסום עד שאמון המדידה ישתפר',
    blocked_until_business_context_provided: 'חסום עד מילוי הקשר עסקי',
  };
  map.safe_to_do_now = 'בטוח לבצע עכשיו';
  return map[value] ?? String(value ?? 'לא ידוע');
}

function formatConfidence(value) {
  const map = {
    'ביטחון גבוה': 'ביטחון גבוה',
    'ביטחון בינוני': 'ביטחון בינוני',
    'ביטחון נמוך': 'ביטחון נמוך',
    'High confidence': 'ביטחון גבוה',
    'Medium confidence': 'ביטחון בינוני',
    'Low confidence': 'ביטחון נמוך',
  };
  return map[value] ?? String(value ?? 'לא ידוע');
}

function formatEvidenceState(value) {
  const map = {
    confirmed: 'מאומת',
    likely: 'סביר',
    unknown: 'לא ידוע',
  };
  return map[value] ?? String(value ?? 'לא ידוע');
}

function formatContextKey(value) {
  const map = {
    targetCpl: 'יעד CPL',
    serviceArea: 'אזור שירות',
    trackingTrusted: 'אמון במעקב',
    offlineConversionsImported: 'ייבוא המרות אופליין',
  };
  return map[value] ?? String(value ?? 'לא ידוע');
}

function formatMeasurementTrust(value) {
  const map = {
    trusted: 'אמין',
    caution: 'זהירות',
    untrusted: 'לא אמין',
  };
  return map[value] ?? String(value ?? 'לא ידוע');
}

function formatDataSource(value) {
  const map = {
    campaigns: 'קמפיינים',
    adGroups: 'קבוצות מודעות',
    keywords: 'מילות מפתח',
    searchTerms: 'מונחי חיפוש',
    ads: 'מודעות',
    devices: 'מכשירים',
    locations: 'מיקומים',
  };
  return map[value] ?? String(value ?? 'לא ידוע');
}
