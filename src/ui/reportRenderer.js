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
  renderTopActionsBar(report.topActions);
  renderAccountStatus(report.decisionFlow?.accountStatus);
  renderCategoryFindings(report);
  const coverageVisible = renderCoveragePanel(report.decisionFlow?.reportCoverage ?? []);
  const limitationsVisible = renderLimitations(report.decisionFlow?.knowledgeBoundaries);
  updateCoveragePanelVisibility(section, coverageVisible, limitationsVisible);

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

// ── Top-3 actions bar ─────────────────────────────────────────────────────────

function renderTopActionsBar(topActions) {
  const container = document.getElementById('top-actions-summary');
  if (!container) return;

  if (!topActions || topActions.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = '';

  const items = topActions.slice(0, 3).map((a, i) => {
    const bucket = a.sourceBucket ?? 'secondary';
    return `
      <div class="top-action-item top-action-item--${esc(bucket)}">
        <span class="top-action-number">${i + 1}</span>
        <div class="top-action-content">
          <strong>${esc(a.action)}</strong>
          <span>${esc(a.reason)}</span>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="top-actions-bar">
      <div class="top-actions-title">3 הפעולות הדחופות להיום</div>
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
      ? `<span class="status-tag status-tag--alert">דחופות: ${esc(String(status.highPriorityActions))}</span>`
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
      showIfEmpty: measurementTrust !== 'trusted',
    },
    {
      key:     'opportunity',
      icon:    '🚀',
      label:   'הזדמנויות',
      items:   (report.opportunities ?? []).filter(isActionableFinding),
      emptyMsg: 'לא זוהו הזדמנויות סקייל ברורות בנתונים הנוכחיים.',
      showIfEmpty: false,
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

function renderCategorySection({ key, icon, label, items, emptyMsg }) {
  const highCount  = items.filter(i => i.severity === 'high').length;
  const totalCount = items.length;

  const badge = highCount > 0
    ? `<span class="category-count category-count--alert">${highCount} דחוף</span>`
    : totalCount > 0
    ? `<span class="category-count">${totalCount}</span>`
    : '';

  let bodyHtml;
  if (!items.length) {
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

function buildFindingCardHtml(f) {
  const detailId     = `fd-${Math.random().toString(36).slice(2, 8)}`;
  const severity     = f.severity ?? 'low';
  const evidenceHtml = buildFindingEvidence(f.data);
  const hint         = getDataHint(f);

  return `
    <div class="finding-card finding-card--${severity}">
      <div class="finding-header">
        <span class="severity-dot severity-dot--${severity}" title="${formatSeverity(severity)}"></span>
        <span class="finding-badge">${esc(f.category === 'opportunity' ? 'הזדמנות' : f.category === 'waste' ? 'בזבוז' : f.category === 'controlRisk' ? 'סיכון' : 'מדידה')}</span>
      </div>
      ${f.what    ? `<p class="finding-what"><strong>ממצא:</strong> ${esc(f.what)}</p>` : ''}
      ${f.why     ? `<p class="finding-why"><strong>סיכון:</strong> ${esc(f.why)}</p>` : ''}
      ${f.action  ? `<p class="finding-action"><strong>מה לעשות:</strong> ${esc(f.action)}</p>` : ''}
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
  return lines.map(l => `<span class="evidence-chip">${esc(l)}</span>`).join('');
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
    .filter(item => item.status !== 'uploaded_used' || item.status === 'uploaded_blocked' || item.status === 'not_uploaded' || (item.warnings?.length > 0) || (item.errors?.length > 0))
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
    buildLimitationGroup('מאומת מתוך הנתונים', boundaries.confirmed),
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
  return 'אמון המדידה במצב זהירות — מומלץ לאמת הגדרות מעקב.';
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
