/**
 * reportRenderer.js
 * Renders a report object into the DOM report section.
 *
 * Layout (top → bottom):
 *   1. Summary bar         — spend, conversions, CPL, best performer
 *   2. Top-3 actions bar   — the 3 most urgent things to do
 *   3. Account status      — trust level + readiness
 *   4. Findings by category — Measurement · Waste · Control · Opportunities
 *   5. Coverage panel      — which reports were uploaded (collapsed)
 */

export function renderReport(report) {
  const section = document.getElementById('report-section');
  section.style.display = '';

  document.getElementById('report-date').textContent = new Date(report.timestamp)
    .toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' });

  renderSummary(report.summary);
  renderMondayOutcomes(report.businessContextUsed?.mondayContext ?? null);
  renderBusinessInterpretation(report.businessInterpretation ?? null);
  renderTopActionsBar(report.topActions);
  renderAccountStatus(report.decisionFlow?.accountStatus);
  renderCategoryFindings(report);
  renderCoveragePanel(report.decisionFlow?.reportCoverage ?? []);
  renderLimitations(report.decisionFlow?.knowledgeBoundaries);

  wireInteractivity(section);
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Summary bar ───────────────────────────────────────────────────────────────

function renderSummary(summary) {
  const el = document.getElementById('report-summary');
  if (!el || !summary) return;

  const spend = typeof summary.totalSpend === 'number' ? `CA$${summary.totalSpend.toFixed(2)}` : '—';
  const conv  = typeof summary.totalConversions === 'number' ? summary.totalConversions.toFixed(1) : '—';
  const cpl   = typeof summary.avgCpl === 'number' ? `CA$${summary.avgCpl.toFixed(2)}` : '—';
  const high  = summary.highSeverityCount ?? 0;
  const bestCpl = summary.bestPerformer?.cpl;
  const best  = summary.bestPerformer ? `"${esc(summary.bestPerformer.label)}" — CA$${typeof bestCpl === 'number' ? bestCpl.toFixed(0) : '—'}/ליד` : 'אין מספיק נתונים';
  const source     = summary.totalsSource ? esc(formatDataSource(summary.totalsSource)) : 'ללא';
  const confidence = esc(formatTotalsConfidence(summary.totalsSourceConfidence));

  el.innerHTML = `
    <div class="summary-stat"><span class="summary-label">סך הוצאה</span><span class="summary-value">${spend}</span></div>
    <div class="summary-stat"><span class="summary-label">המרות</span><span class="summary-value">${conv}</span></div>
    <div class="summary-stat"><span class="summary-label">CPL ממוצע</span><span class="summary-value">${cpl}</span></div>
    <div class="summary-stat ${high > 0 ? 'summary-stat--alert' : ''}"><span class="summary-label">עדיפות גבוהה</span><span class="summary-value">${high} פריטים</span></div>
    <div class="summary-stat summary-stat--wide"><span class="summary-label">הביצוע הטוב ביותר</span><span class="summary-value">${best}</span></div>
    <div class="summary-stat summary-stat--wide"><span class="summary-label">מקור הסכומים</span><span class="summary-value">${source} (${confidence})</span></div>
  `;
}

// ── Monday.com CRM outcomes bar ───────────────────────────────────────────────

function renderMondayOutcomes(ctx) {
  const el = document.getElementById('monday-outcomes');
  if (!el) return;
  if (!ctx) { el.style.display = 'none'; return; }

  const fmt  = (v, prefix = '') => v != null ? `${prefix}${Number(v).toLocaleString('he-IL', { maximumFractionDigits: 0 })}` : '—';
  const fmtP = v => v != null ? `${(v * 100).toFixed(1)}%` : '—';

  // Historical mode: board stores current status only — all closed leads show as "done", not "booked"
  const isHistoricalMode = ctx.bookedCount === 0 && (ctx.closedCount ?? 0) > 0;

  const bookingCells = isHistoricalMode
    ? `<div class="mo-stat mo-stat--muted"><span class="mo-label">הוזמנו</span><span class="mo-value mo-value--note">נ/ר *</span></div>
       <div class="mo-stat mo-stat--muted"><span class="mo-label">שיעור הזמנה</span><span class="mo-value mo-value--note">נ/ר *</span></div>`
    : `<div class="mo-stat"><span class="mo-label">הוזמנו</span><span class="mo-value">${fmt(ctx.bookedCount)}</span></div>
       <div class="mo-stat"><span class="mo-label">שיעור הזמנה</span><span class="mo-value">${fmtP(ctx.bookRate)}</span></div>`;

  const historicalNote = isHistoricalMode
    ? `<div class="mo-historical-note">* הלוח שומר סטטוס נוכחי בלבד — לידים שנסגרו מופיעים ישירות כ"נסגרו", לא כ"הוזמנו".</div>`
    : '';

  el.style.display = '';
  el.innerHTML = `
    <div class="monday-outcomes-bar">
      <div class="monday-outcomes-title"><span class="monday-dot"></span>תוצאות CRM (Google Ads בלבד)</div>
      <div class="monday-outcomes-grid">
        <div class="mo-stat"><span class="mo-label">לידים ממומנים</span><span class="mo-value">${fmt(ctx.paidLeadCount)}</span></div>
        ${bookingCells}
        <div class="mo-stat"><span class="mo-label">נסגרו</span><span class="mo-value">${fmt(ctx.closedCount)}</span></div>
        <div class="mo-stat"><span class="mo-label">בוטלו</span><span class="mo-value">${fmt(ctx.lostCount)}</span></div>
        <div class="mo-stat"><span class="mo-label">שיעור סגירה</span><span class="mo-value">${fmtP(ctx.closeRate)}</span></div>
        <div class="mo-stat"><span class="mo-label">הכנסה ממוצעת</span><span class="mo-value">${fmt(ctx.avgNetRevenue, 'CA$')}</span></div>
        <div class="mo-stat"><span class="mo-label">רווח ממוצע</span><span class="mo-value">${fmt(ctx.avgNetLessParts, 'CA$')}</span></div>
        <div class="mo-stat"><span class="mo-label">סה״כ הכנסה</span><span class="mo-value">${fmt(ctx.totalNetRevenue, 'CA$')}</span></div>
        <div class="mo-stat"><span class="mo-label">סה״כ רווח</span><span class="mo-value">${fmt(ctx.totalNetLessParts, 'CA$')}</span></div>
        <div class="mo-stat"><span class="mo-label">סה״כ ברוטו+מע״מ</span><span class="mo-value">${fmt(ctx.totalGrossSoldIncludingGst, 'CA$')}</span></div>
      </div>
      ${historicalNote}
    </div>
  `;
}

// ── Business Interpretation ───────────────────────────────────────────────────

function renderBusinessInterpretation(interp) {
  const el = document.getElementById('business-interpretation');
  if (!el) return;

  if (!interp) { el.style.display = 'none'; return; }

  const { hasMondayData, narrative, contextNote, funnelSignals, dataWarnings } = interp;

  const signalBadges = (funnelSignals ?? []).map(s => {
    const labelMap = {
      low_volume:       { text: 'נפח נמוך', cls: 'bi-badge--note' },
      historical_mode:  { text: 'נתונים היסטוריים', cls: 'bi-badge--note' },
      high_cancellation:{ text: 'ביטולים גבוהים', cls: 'bi-badge--warning' },
      weak_booking:     { text: 'הזמנות חלשות', cls: 'bi-badge--warning' },
      strong_booking:   { text: 'הזמנות חזקות', cls: 'bi-badge--positive' },
      weak_close:       { text: 'סגירה חלשה', cls: 'bi-badge--warning' },
      healthy_close:    { text: 'סגירה תקינה', cls: 'bi-badge--positive' },
      high_value_jobs:  { text: 'ערך עסקה גבוה', cls: 'bi-badge--positive' },
      scale_candidate:  { text: 'פוטנציאל הגדלה', cls: 'bi-badge--positive' },
      operational_gap:  { text: 'פער תפעולי', cls: 'bi-badge--note' },
    };
    const info = labelMap[s.key] ?? { text: s.key, cls: 'bi-badge--note' };
    return `<span class="bi-badge ${esc(info.cls)}">${esc(info.text)}</span>`;
  }).join('');

  const narrativeHtml = (narrative ?? []).length
    ? `<ul class="bi-narrative">${narrative.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`
    : '';

  const warningsHtml = (dataWarnings ?? []).length
    ? `<div class="bi-data-warnings">${dataWarnings.map(w => `<div>⚠ ${esc(w)}</div>`).join('')}</div>`
    : '';

  el.style.display = '';
  el.innerHTML = `
    <div class="business-interpretation">
      <div class="bi-header">
        <span class="bi-icon">${hasMondayData ? '🔗' : '📊'}</span>
        <h3 class="bi-title">פרשנות עסקית</h3>
        ${signalBadges ? `<div class="bi-badges">${signalBadges}</div>` : ''}
      </div>
      ${narrativeHtml}
      ${warningsHtml}
      <div class="bi-context-note">${esc(contextNote ?? '')}</div>
    </div>
  `;
}

// ── Top-3 actions bar ─────────────────────────────────────────────────────────

function renderTopActionsBar(topActions) {
  const container = document.getElementById('top-actions-summary');
  if (!container) return;

  if (!topActions || topActions.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = '';

  const displayed = topActions.slice(0, 3);
  const items = displayed.map((a, i) => {
    const bucket = a.sourceBucket ?? 'secondary';
    const actionText = humanizeActionText(a.action);
    const reasonText = humanizeActionText(a.reason);
    return `
      <div class="top-action-item top-action-item--${esc(bucket)}">
        <span class="top-action-number">${i + 1}</span>
        <div class="top-action-content">
          <strong>${esc(actionText)}</strong>
          <span>${esc(reasonText)}</span>
        </div>
      </div>
    `;
  }).join('');

  const titleText = displayed.length === 1
    ? 'הפעולה בעדיפות הגבוהה ביותר להיום'
    : `${displayed.length} הפעולות בעדיפות הגבוהה להיום`;

  container.innerHTML = `
    <div class="top-actions-bar">
      <div class="top-actions-title">${esc(titleText)}</div>
      <div class="top-actions-list">${items}</div>
    </div>
  `;
}

// ── Account status ────────────────────────────────────────────────────────────

function renderAccountStatus(status) {
  const container = document.getElementById('account-status');
  if (!container) return;

  if (!status) {
    container.innerHTML = '';
    return;
  }

  const icons = { ready: '✅', limited: '⚠️', blocked: '🛑' };
  const icon  = icons[status.readiness] ?? '—';
  const reasonText = (status.measurementReasons ?? []).slice(0, 1).join(' ');

  const tags = [
    `<span class="status-tag">מדידה: ${esc(formatMeasurementTrust(status.measurementTrust))}</span>`,
    status.highPriorityActions > 0
      ? `<span class="status-tag status-tag--alert">עדיפות גבוהה: ${esc(String(status.highPriorityActions))}</span>`
      : '',
    `<span class="status-tag">דוחות: ${esc(String(status.usableReportsCount ?? 0))}/${esc(String(status.totalReportSlots ?? 7))} שמישים</span>`,
    status.missingReportsCount > 0
      ? `<span class="status-tag status-tag--warn">חסרים: ${esc(String(status.missingReportsCount))}</span>`
      : '',
    status.blockedReportsCount > 0
      ? `<span class="status-tag status-tag--alert">חסומים: ${esc(String(status.blockedReportsCount))}</span>`
      : '',
  ].filter(Boolean).join('');

  container.innerHTML = `
    <div class="status-card status-card--${esc(status.readiness)}">
      <div class="status-card-main">
        <span class="status-card-icon">${icon}</span>
        <strong class="status-card-headline">${esc(status.headline)}</strong>
      </div>
      <div class="status-card-meta">${tags}</div>
      ${reasonText ? `<div class="status-card-reasons">${esc(reasonText)}</div>` : ''}
    </div>
  `;
}

// ── Category findings ─────────────────────────────────────────────────────────

const SHOW_FIRST = 3;

function renderCategoryFindings(report) {
  const container = document.getElementById('findings-categories');
  if (!container) return;

  const measurementTrust = report.decisionFlow?.measurementState?.trust;
  const opportunitySections = normalizeOpportunitySections(report.opportunities);
  const hasAnyOpportunity =
    opportunitySections.actionableNow.length > 0
    || opportunitySections.reviewBeforeActing.length > 0
    || opportunitySections.blockedByMissingBusinessContext.length > 0
    || opportunitySections.weakInsufficientSample.length > 0;
  const opportunityDisplayedItems = [
    ...opportunitySections.actionableNow,
    ...opportunitySections.reviewBeforeActing,
    ...opportunitySections.blockedByMissingBusinessContext,
    ...opportunitySections.weakInsufficientSample,
  ];

  const categories = [
    {
      key:     'waste',
      icon:    '🗑️',
      label:   'בזבוז תקציב',
      items:   (report.waste ?? []).filter(isActionableFinding),
      emptyMsg: 'לא זוהה בזבזת תקציב משמעותית.',
      showIfEmpty: false,
    },
    {
      key:     'control',
      icon:    '⚠️',
      label:   'סיכוני שליטה',
      items:   (report.controlRisks ?? []).filter(isActionableFinding),
      emptyMsg: 'לא נמצאו בעיות שליטה מבניות משמעותיות.',
      showIfEmpty: false,
    },
    {
      key:     'measurement',
      icon:    '📡',
      label:   'מדידה ומעקב',
      items:   (report.measurementRisks ?? []).filter(isActionableFinding),
      emptyMsg: measurementEmptyMessage(measurementTrust),
      showIfEmpty: measurementTrust === 'untrusted',
    },
    {
      key:     'opportunity',
      icon:    '🚀',
      label:   'הזדמנויות',
      items:   opportunityDisplayedItems,
      emptyMsg: 'לא זוהו הזדמנויות סקייל ברורות בנתונים הנוכחיים.',
      showIfEmpty: hasAnyOpportunity,
      customBody: renderOpportunityBuckets(opportunitySections),
      badgeMode: 'total',
    },
  ];

  const html = categories
    .filter(cat => cat.items.length > 0 || cat.showIfEmpty)
    .map(cat => renderCategorySection(cat))
    .join('');

  container.innerHTML = html
    || '<p class="no-findings">לא נמצאו ממצאים משמעותיים בדוחות שהועלו.</p>';
}

function isActionableFinding(f) {
  return f && (f.severity === 'high' || f.severity === 'medium');
}

function renderCategorySection({ key, icon, label, items, emptyMsg, customBody = '', badgeMode = 'default' }) {
  const highCount  = items.filter(i => i.severity === 'high').length;
  const totalCount = items.length;

  const badge = badgeMode === 'total'
    ? (totalCount > 0 ? `<span class="category-count">${totalCount}</span>` : '')
    : highCount > 0
      ? `<span class="category-count category-count--alert">${highCount} דחוף</span>`
      : totalCount > 0
        ? `<span class="category-count">${totalCount}</span>`
        : '';

  let bodyHtml;
  if (customBody) {
    bodyHtml = customBody;
  } else if (!items.length) {
    bodyHtml = `<p class="findings-empty">${esc(emptyMsg)}</p>`;
  } else {
    const visible = items.slice(0, SHOW_FIRST);
    const extra   = items.slice(SHOW_FIRST);
    bodyHtml = visible.map(buildFindingCardHtml).join('');
    if (extra.length > 0) {
      bodyHtml += `
        <div class="collapse-extra">
          ${extra.map(buildFindingCardHtml).join('')}
        </div>
        <button class="collapse-trigger" type="button">+ הצג עוד ${extra.length} ממצאים</button>
      `;
    }
  }

  return `
    <div class="category-section category-section--${key}">
      <div class="category-header">
        <span class="category-icon">${icon}</span>
        <h3 class="category-title">${esc(label)}</h3>
        ${badge}
      </div>
      <div class="category-items">${bodyHtml}</div>
    </div>
  `;
}

function normalizeOpportunitySections(opportunities) {
  if (Array.isArray(opportunities)) {
    const actionableNow = opportunities
      .filter(isActionableFinding)
      .filter(o => !isReviewOnlyAction(o?.action));

    return {
      actionableNow,
      reviewBeforeActing: opportunities
        .filter(o => isReviewOnlyAction(o?.action)),
      blockedByMissingBusinessContext: [],
      weakInsufficientSample: [],
    };
  }

  return {
    actionableNow: (opportunities?.actionableNow ?? [])
      .filter(isActionableFinding)
      .filter(o => !isReviewOnlyAction(o?.action)),
    reviewBeforeActing: (opportunities?.reviewBeforeActing ?? []),
    blockedByMissingBusinessContext: opportunities?.blockedByMissingBusinessContext ?? [],
    weakInsufficientSample: opportunities?.weakInsufficientSample ?? [],
  };
}

function renderOpportunityBuckets(sections) {
  const groups = [
    {
      title: 'ניתן לביצוע כעת',
      items: sections.actionableNow,
    },
    {
      title: 'דורש בדיקה לפני פעולה',
      items: sections.reviewBeforeActing,
    },
    {
      title: 'ממתין לנתוני יעד',
      items: sections.blockedByMissingBusinessContext,
    },
    {
      title: 'אות חיובי — נתונים לא מספיקים עדיין',
      items: sections.weakInsufficientSample,
    },
  ].filter(g => g.items.length > 0);

  if (!groups.length) {
    return '<p class="findings-empty">לא זוהו הזדמנויות סקייל ברורות בנתונים הנוכחיים.</p>';
  }

  return groups.map(group => `
    <div class="opportunity-subsection">
      <h4 class="category-subtitle">${esc(group.title)}</h4>
      ${group.items.map(buildFindingCardHtml).join('')}
    </div>
  `).join('');
}

function isReviewOnlyAction(action) {
  const normalized = String(action ?? '').trim().toLowerCase();
  return normalized.startsWith('review_before_acting:') || normalized.startsWith('small_test_only:');
}

function humanizeActionText(action) {
  const raw = String(action ?? '').trim();
  if (!raw) return '';

  const withoutPrefix = raw
    .replace(/^review_before_acting:\s*/i, '')
    .replace(/^small_test_only:\s*/i, '')
    .replace(/^blocked_until_tracking_trusted:\s*/i, '')
    .replace(/^blocked_until_business_context_provided:\s*/i, '');

  return withoutPrefix
    .replace(/\bNone\b/gi, 'לא מזוהה')
    .replace(/\(not set\)|\bnot set\b/gi, 'לא מזוהה')
    .replace(/\bComputers\b/gi, 'מחשבים')
    .replace(/\bCPL\b/gi, 'עלות לליד')

    .replace(/\bLTV\b/gi, 'ערך לקוח לאורך זמן')
    .replace(/\bGA\b/gi, 'גוגל אנליטיקס')
    .replace(/\bGTM\b/gi, "תג מנג'ר")
    .replace(/\btargetCpl\b/gi, 'יעד עלות לליד')
    .replace(/\bserviceArea\b/gi, 'אזור שירות')
    .replace(/\bactionable\b/gi, 'ניתן לביצוע')
    .replace(/\bscale\b/gi, 'סקייל')
    .replace(/\btest\b/gi, 'בדיקה')
    .replace(/\breview\b/gi, 'בדיקה')
    .replace(/\bverify\b/gi, 'לאמת')
    .replace(/\blikely\b/gi, 'סביר')
    .replace(/\bconfirmed\b/gi, 'מאומת')
    .replace(/\bunknown\b/gi, 'לא ידוע')
    .replace(/\breduce\b/gi, 'להפחית')
    .replace(/\bcheck\b/gi, 'לבדוק')
    .replace(/בדיקה קטן/g, 'בדיקה קטנה')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildFindingCardHtml(f) {
  const detailId     = `fd-${Math.random().toString(36).slice(2, 8)}`;
  const severity     = f.severity ?? 'low';
  const isOpportunity = f.category === 'opportunity';
  const evidenceHtml = buildFindingEvidence(f.data);
  const hint         = humanizeActionText(getDataHint(f));
  const actionText   = humanizeActionText(f.action);
  const whyText      = humanizeActionText(f.why);
  const whatText     = humanizeActionText(f.what);
  const whyLabel     = isOpportunity ? 'נימוק:' : 'סיכון:';
  const badgeLabel   = isOpportunity ? 'הזדמנות' : f.category === 'waste' ? 'בזבוז' : f.category === 'controlRisk' ? 'סיכון שליטה' : 'מדידה';

  return `
    <div class="finding-card finding-card--${severity}">
      <div class="finding-header">
        <span class="severity-dot severity-dot--${severity}" title="${formatSeverity(severity)}"></span>
        <span class="finding-badge">${esc(badgeLabel)}</span>
      </div>
      ${whatText  ? `<p class="finding-what"><strong>ממצא:</strong> ${esc(whatText)}</p>` : ''}
      ${whyText   ? `<p class="finding-why"><strong>${esc(whyLabel)}</strong> ${esc(whyText)}</p>` : ''}
      ${actionText ? `<p class="finding-action"><strong>פעולה:</strong> ${esc(actionText)}</p>` : ''}
      ${hint      ? `<span class="data-hint">${esc(hint)}</span>` : ''}
      ${evidenceHtml ? `
        <button class="details-toggle" type="button" data-target="${detailId}">פרטים ▼</button>
        <div class="decision-details" id="${detailId}">
          <div class="evidence-chips">${evidenceHtml}</div>
        </div>
      ` : ''}
    </div>
  `;
}

function buildFindingEvidence(data) {
  if (!data) return '';
  const lines = [];
  if (data.cost        != null) lines.push(`הוצאה: CA$${Number(data.cost).toFixed(2)}`);
  if (data.clicks      != null) lines.push(`קליקים: ${data.clicks}`);
  if (data.conversions != null) lines.push(`המרות: ${data.conversions}`);
  if (data.impressions != null) lines.push(`חשיפות: ${data.impressions}`);
  if (data.searchImprShare    != null) lines.push(`נתח חשיפות: ${Number(data.searchImprShare).toFixed(1)}%`);
  if (data.searchLostIsBudget != null) lines.push(`אובדן מתקציב: ${Number(data.searchLostIsBudget).toFixed(1)}%`);
  if (data.searchLostIsRank   != null) lines.push(`אובדן מדירוג: ${Number(data.searchLostIsRank).toFixed(1)}%`);
  if (data.campaign)             lines.push(`קמפיין: ${data.campaign}`);
  if (data.adGroup)              lines.push(`קבוצה: ${data.adGroup}`);
  if (data.device)               lines.push(`מכשיר: ${data.device}`);
  if (data.location)             lines.push(`מיקום: ${data.location}`);
  if (data.totalSpend  != null)  lines.push(`סה"כ הוצאה: CA$${Number(data.totalSpend).toFixed(2)}`);
  if (data.wastedSpend != null)  lines.push(`ללא המרות: CA$${Number(data.wastedSpend).toFixed(2)}`);
  return lines.map(l => `<span class="evidence-chip">${esc(humanizeActionText(l))}</span>`).join('');
}

function getDataHint(f) {
  if (f.signal === 'zero-leads-watch')   return 'נפח קטן עדיין — לעקוב בלבד';
  if (f.signal === 'scale-candidate')    return 'מועמד לסקייל';
  if (f.signal === 'strong-leader')      return 'מנצח יציב';
  if (f.signal === 'budget-limited-winner') return 'מוגבל תקציב';
  return null;
}

// ── Coverage panel ────────────────────────────────────────────────────────────

function renderCoveragePanel(reportCoverage) {
  const container = document.getElementById('items-report-coverage');
  if (!container) return;

  const summary = summarizeCoverage(reportCoverage);

  const statusIcon = (status) => {
    if (status === 'uploaded_used')               return '✅';
    if (status === 'uploaded_used_with_warnings') return '⚠️';
    if (status === 'uploaded_blocked')            return '🛑';
    return '○';
  };

  const rows = reportCoverage
    .filter(item => item.status !== 'uploaded_used' || (item.warnings?.length > 0) || (item.errors?.length > 0))
    .map(item => {
      const extraLines = [
        item.impactIfMissing ? `<span class="coverage-impact">${esc(item.impactIfMissing)}</span>` : '',
        item.blockReason     ? `<span class="coverage-block-reason">${esc(item.blockReason)}</span>` : '',
        ...(item.warnings ?? []).slice(0, 1).map(w => `<span class="coverage-warn">${esc(w)}</span>`),
        ...(item.errors   ?? []).slice(0, 1).map(e => `<span class="coverage-block-reason">${esc(e)}</span>`),
      ].filter(Boolean).join('');

      return `
        <div class="coverage-row">
          <span class="coverage-icon">${statusIcon(item.status)}</span>
          <span class="coverage-label">${esc(item.label)}</span>
          <span class="coverage-status-text coverage-status--${esc(item.status)}">${esc(formatCoverageStatus(item.status))}</span>
          ${item.rowCount > 0 ? `<span class="coverage-rows">${esc(String(item.rowCount))} שורות</span>` : ''}
          ${extraLines}
        </div>
      `;
    }).join('');

  const blockedCount  = summary.blocked     > 0 ? ` · ${esc(String(summary.blocked))} חסומים`    : '';
  const missingCount  = summary.notUploaded > 0 ? ` · ${esc(String(summary.notUploaded))} לא הועלו` : '';
  const warningCount  = summary.usedWithWarnings > 0 ? ` · ${esc(String(summary.usedWithWarnings))} עם אזהרות` : '';

  container.innerHTML = `
    <div class="coverage-summary-line">
      ${esc(String(summary.usable))}/${esc(String(summary.total))} דוחות שמישים${blockedCount}${missingCount}${warningCount}
    </div>
    ${rows ? `<div class="coverage-rows-list">${rows}</div>` : '<p class="coverage-note">כל הדוחות שמשתמשים בהם שמישים ואין חריגות בכיסוי.</p>'}
  `;
}

// ── Knowledge boundaries ──────────────────────────────────────────────────────

function renderLimitations(boundaries) {
  const container = document.getElementById('items-limitations');
  if (!container) return;

  if (!boundaries) {
    container.innerHTML = '<p class="limitations-empty">אין מגבלות נוספות בשלב זה.</p>';
    return;
  }

  const groups = [
    buildLimitationGroup('סביר אך מוסק', boundaries.likely),
    buildLimitationGroup('לא ידוע מ-CSV בלבד', boundaries.unknown),
  ].filter(Boolean).join('');

  container.innerHTML = groups || '<p class="limitations-empty">אין מגבלות מידע משמעותיות נוספות.</p>';
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

// ── Interactivity wiring ──────────────────────────────────────────────────────

function wireInteractivity(root) {
  root.querySelectorAll('.collapse-trigger').forEach(btn => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';

    btn.addEventListener('click', () => {
      const extra  = btn.previousElementSibling;
      if (!extra?.classList.contains('collapse-extra')) return;
      const isOpen = extra.classList.contains('is-open');
      extra.classList.toggle('is-open', !isOpen);
      btn.textContent = isOpen
        ? `+ הצג עוד ${extra.children.length} ממצאים`
        : 'הסתר ▲';
    });
  });

  root.querySelectorAll('.details-toggle').forEach(btn => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';

    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const details  = targetId ? root.querySelector(`#${targetId}`) : null;
      if (!details) return;
      const isOpen = details.classList.contains('is-open');
      details.classList.toggle('is-open', !isOpen);
      btn.textContent = isOpen ? 'פרטים ▼' : 'סגור ▲';
    });
  });
}

// ── Formatters ────────────────────────────────────────────────────────────────

function esc(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatSeverity(value) {
  const map = { high: 'גבוה', medium: 'בינוני', low: 'נמוך' };
  return map[value] ?? String(value ?? 'בינוני');
}

function formatMeasurementTrust(value) {
  const map = { trusted: 'אמין', caution: 'זהירות', untrusted: 'לא אמין' };
  return map[value] ?? String(value ?? 'לא ידוע');
}

function formatDataSource(value) {
  const map = {
    campaigns: 'קמפיינים', adGroups: 'קבוצות מודעות',
    keywords: 'מילות מפתח', searchTerms: 'מונחי חיפוש',
    ads: 'מודעות', devices: 'מכשירים', locations: 'מיקומים',
  };
  return map[value] ?? String(value ?? 'לא ידוע');
}

function formatCoverageStatus(value) {
  const map = {
    not_uploaded:                'לא הועלה',
    uploaded_used:               'הועלה ונעשה שימוש',
    uploaded_blocked:            'הועלה — חסום',
    uploaded_used_with_warnings: 'הועלה עם אזהרות',
  };
  return map[value] ?? String(value ?? 'לא ידוע');
}

function formatTotalsConfidence(value) {
  const map = { high: 'אמינות גבוהה', medium: 'אמינות בינונית', low: 'אמינות נמוכה' };
  return map[value] ?? String(value ?? 'לא ידוע');
}

function measurementEmptyMessage(trust) {
  if (trust === 'trusted')   return 'לא זוהו סיכוני מדידה — המעקב נראה תקין.';
  if (trust === 'untrusted') return 'אמון המדידה נמוך — יש לתקן מעקב לפני שינויים משמעותיים.';
  return 'לא זוהתה שגיאת מעקב חד-משמעית, אך אמון המדידה חלקי ולכן יש לפעול בזהירות.';
}

function summarizeCoverage(reportCoverage) {
  const s = { total: reportCoverage?.length ?? 0, used: 0, usedWithWarnings: 0, blocked: 0, notUploaded: 0, usable: 0 };
  for (const item of reportCoverage ?? []) {
    if (item.status === 'uploaded_used')               s.used += 1;
    if (item.status === 'uploaded_used_with_warnings') s.usedWithWarnings += 1;
    if (item.status === 'uploaded_blocked')            s.blocked += 1;
    if (item.status === 'not_uploaded')                s.notUploaded += 1;
    if (item.status === 'uploaded_used' || item.status === 'uploaded_used_with_warnings') s.usable += 1;
  }
  return s;
}
