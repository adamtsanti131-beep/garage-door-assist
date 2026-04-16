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
  renderFindings(
    'items-measurement-risks',
    report.measurementRisks,
    measurementEmptyMessage(report.decisionFlow?.measurementState?.trust)
  );
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
  const totalsConfidence = esc(formatTotalsConfidence(summary.totalsSourceConfidence));
  const totalsNote = esc(summary.totalsSourceNote ?? '');

  el.innerHTML = `
    <div class="summary-stat"><span class="summary-label">סך הוצאה</span><span class="summary-value">${spend}</span></div>
    <div class="summary-stat"><span class="summary-label">המרות</span><span class="summary-value">${conv}</span></div>
    <div class="summary-stat"><span class="summary-label">CPA ממוצע</span><span class="summary-value">${cpa}</span></div>
    <div class="summary-stat ${high > 0 ? 'summary-stat--alert' : ''}"><span class="summary-label">עדיפות גבוהה</span><span class="summary-value">${high} פריטים</span></div>
    <div class="summary-stat summary-stat--wide"><span class="summary-label">הביצוע הטוב ביותר</span><span class="summary-value">${best}</span></div>
    <div class="summary-stat summary-stat--wide"><span class="summary-label">מקור הסכומים</span><span class="summary-value">${totalsSource} (${totalsConfidence})</span></div>
    <div class="summary-stat summary-stat--wide"><span class="summary-label">הערת אמינות</span><span class="summary-value">${totalsNote || '—'}</span></div>
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
      ${(status.measurementReasons ?? []).slice(0, 2).map(r => `<span>הסבר מדידה: ${esc(r)}</span>`).join('')}
      <span>פעולות בעדיפות גבוהה: ${esc(String(status.highPriorityActions))}</span>
      <span>פעולות חסומות: ${esc(String(status.blockedActions))}</span>
      <span>דוחות חסרים: ${esc(String(status.missingReportsCount))}</span>
      <span>דוחות חסומים: ${esc(String(status.blockedReportsCount ?? 0))}</span>
      <span>דוחות שמישים: ${esc(String(status.usableReportsCount ?? 0))} מתוך ${esc(String(status.totalReportSlots ?? 7))}</span>
      <span>מתוכם עם אזהרות: ${esc(String(status.usedWithWarningsCount ?? 0))}</span>
      <span>בשימוש נקי (ללא אזהרות): ${esc(String(status.usedReportsCount ?? 0))}</span>
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
    const safeLevel = formatEntityLevel(d.entity_level);
    const safeName = safeEntityName(d.entity_name, d.entity_level);
    const el = document.createElement('div');
    el.className = 'report-item report-item--decision';
    el.innerHTML = `
      <div class="report-item-header">
        <span class="report-item-badge report-item-badge--${confidenceTone(d.confidence)}">${esc(formatConfidence(d.confidence))}</span>
        <strong class="report-item-what">${esc(d.user_instruction)}</strong>
      </div>
      <p class="report-item-why"><strong>למה:</strong> ${esc(d.reason)}</p>
      <p class="report-item-action"><strong>ישות:</strong> ${esc(safeLevel)} / ${esc(safeName)}</p>
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

  const summary = summarizeCoverage(reportCoverage);
  const rows = [];
  rows.push(`
    <div class="report-item">
      <strong>סיכום כיסוי: ${esc(String(summary.usable))}/${esc(String(summary.total))} דוחות שמישים</strong>
      <span class="item-detail">בשימוש נקי: ${esc(String(summary.used))} | בשימוש עם אזהרות: ${esc(String(summary.usedWithWarnings))} | חסומים: ${esc(String(summary.blocked))} | לא הועלו: ${esc(String(summary.notUploaded))}</span>
    </div>
  `);

  for (const item of reportCoverage) {
    rows.push(`
      <div class="report-item">
        <strong>${esc(item.label)}: ${esc(formatCoverageStatus(item.status))}</strong>
        <span class="item-detail">שורות בשימוש: ${esc(String(item.rowCount))} | משמש עבור: ${esc(item.usedFor)}</span>
        <span class="item-detail">שורות Total/Subtotal שהוסרו: ${esc(String(item.droppedAggregateRows ?? 0))}</span>
        ${item.impactIfMissing ? `<span class="item-detail">השפעה: ${esc(item.impactIfMissing)}</span>` : ''}
        ${item.blockReason ? `<span class="item-detail">סיבת חסימה: ${esc(item.blockReason)}</span>` : ''}
        ${(item.errors ?? []).slice(0, 2).map(err => `<span class="item-detail">שגיאה: ${esc(err)}</span>`).join('')}
        ${(item.warnings ?? []).slice(0, 2).map(warn => `<span class="item-detail">אזהרה: ${esc(warn)}</span>`).join('')}
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
      ${a.sourceBucket ? `<span class="item-detail">מקור: ${esc(formatBucketLabel(a.sourceBucket))}</span>` : ''}
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

function formatCoverageStatus(value) {
  const map = {
    not_uploaded: 'לא הועלה',
    uploaded_used: 'הועלה ונעשה בו שימוש',
    uploaded_blocked: 'הועלה אך נחסם',
    uploaded_used_with_warnings: 'הועלה ונעשה בו שימוש עם אזהרות',
  };
  return map[value] ?? String(value ?? 'לא ידוע');
}

function formatEntityLevel(level) {
  const map = {
    searchTerm: 'מונח חיפוש',
    keyword: 'מילת מפתח',
    adGroup: 'קבוצת מודעות',
    campaign: 'קמפיין',
    device: 'מכשיר',
    location: 'מיקום',
    account: 'חשבון',
  };
  return map[level] ?? String(level ?? 'חשבון');
}

function safeEntityName(name, level) {
  const raw = String(name ?? '').trim();
  if (!raw) return fallbackEntityName(level);
  const normalized = raw.toLowerCase();
  if (['none', 'null', 'undefined', 'n/a', '--', '(none)', '(not set)', 'not set'].includes(normalized)) {
    return fallbackEntityName(level);
  }
  return raw;
}

function fallbackEntityName(level) {
  const map = {
    searchTerm: 'מונח חיפוש לא מזוהה',
    keyword: 'מילת מפתח לא מזוהה',
    adGroup: 'קבוצת מודעות לא מזוהה',
    campaign: 'קמפיין לא מזוהה',
    device: 'מכשיר לא מזוהה',
    location: 'מיקום לא מזוהה',
    account: 'ברמת החשבון',
  };
  return map[level] ?? 'ברמת החשבון';
}

function measurementEmptyMessage(trust) {
  if (trust === 'trusted') return 'לא זוהו סיכוני מדידה או מעקב.';
  if (trust === 'untrusted') return 'אמון המדידה נמוך, ולכן פעולות משמעותיות נחסמות עד לתיקון מעקב.';
  return 'אמון המדידה במצב זהירות, ולכן חלק מההמלצות שמרניות או דורשות בדיקה נוספת.';
}

function summarizeCoverage(reportCoverage) {
  const summary = {
    total: reportCoverage?.length ?? 0,
    used: 0,
    usedWithWarnings: 0,
    blocked: 0,
    notUploaded: 0,
    usable: 0,
  };

  for (const item of reportCoverage ?? []) {
    if (item.status === 'uploaded_used') summary.used += 1;
    if (item.status === 'uploaded_used_with_warnings') summary.usedWithWarnings += 1;
    if (item.status === 'uploaded_blocked') summary.blocked += 1;
    if (item.status === 'not_uploaded') summary.notUploaded += 1;
    if (item.status === 'uploaded_used' || item.status === 'uploaded_used_with_warnings') summary.usable += 1;
  }

  return summary;
}

function formatBucketLabel(bucket) {
  const map = {
    immediate: 'לביצוע מיידי',
    review: 'לבדיקה לפני פעולה',
    secondary: 'פעולה משנית',
    scale: 'סקייל בהמשך',
    hold: 'בהמתנה/חסום',
  };
  return map[bucket] ?? String(bucket ?? 'לא ידוע');
}

function formatTotalsConfidence(value) {
  const map = {
    high: 'אמינות גבוהה',
    medium: 'אמינות בינונית',
    low: 'אמינות נמוכה',
  };
  return map[value] ?? String(value ?? 'לא ידוע');
}
