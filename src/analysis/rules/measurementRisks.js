/**
 * measurementRisks.js
 * Rules that detect data quality and tracking issues.
 * These don't mean wasted spend, but rather: the data can't be trusted for decisions.
 * Language: Hebrew, practical and direct.
 */

import { THRESHOLDS as T } from '../thresholds.js';

export function measurementRiskRules(data) {
  const findings = [];
  const { searchTerms = [], keywords = [], campaigns = [], adGroups = [] } = data;
  const allRows = [...campaigns, ...adGroups, ...searchTerms, ...keywords];

  findings.push(...manyClicksNoLeads([...searchTerms, ...keywords]));
  findings.push(...leadsExceedClicks(allRows));
  findings.push(...zeroLeadsWholeAccount(allRows));
  findings.push(...missingLeadData(campaigns));

  return findings;
}

// ── Rules ─────────────────────────────────────────────────────────────────────

/**
 * Search terms or keywords with many clicks but zero leads — suggests tracking gap.
 */
function manyClicksNoLeads(rows) {
  const findings = [];
  for (const r of rows) {
    if (!hasValue(r.clicks) || r.clicks < T.minClicksNoLeadsForTracking) continue;
    if (r.conversions !== 0 && r.conversions !== null) continue;

    const label = r.searchTerm ?? r.keyword ?? 'לא ידוע';
    findings.push({
      category: 'measurementRisk',
      severity: 'medium',
      what: `"${label}" — ${r.clicks} קליקים ואפס לידים.`,
      why: `${r.clicks} קליקים בלי לידים זה משונה לעסק שירות. יכול שיש בעיית מעקב או רמת תנועה נמוכה.`,
      action: `בדוק את מערכת המעקב: התקשורות קורות? הטופס שולח לידים? בדוק Google Tag Manager או Google Ads. אם הכל בסדר — בעיית כיוונון/איכות.`,
      data: r,
    });
  }
  return findings;
}

/**
 * More leads than clicks recorded — almost always a tracking or config error.
 */
function leadsExceedClicks(rows) {
  const findings = [];
  for (const r of rows) {
    if (!hasValue(r.clicks) || !hasValue(r.conversions)) continue;
    if (r.clicks <= 0 || r.conversions <= r.clicks) continue;

    const label = r.campaign ?? r.adGroup ?? r.keyword ?? r.searchTerm ?? 'לא ידוע';
    findings.push({
      category: 'measurementRisk',
      severity: 'high',
      what: `"${label}" — ${r.conversions} לידים מ-${r.clicks} קליקים בלבד. זה לא אפשרי.`,
      why: `לא יכול להיות יותר לידים מקליקים. זה בדרך כלל אומר ספירה כפולה של לידים או בחירת קונברסיה השגויה.`,
      action: `בדוק Google Ads > כלים > קונברסיות. בדוק לטגים כפולים או שגויים. תקן לפני שמקבל החלטות על בסיס נתונים אלה.`,
      data: r,
    });
  }
  return findings;
}

/**
 * Entire account shows zero leads — most likely a tracking setup issue.
 */
function zeroLeadsWholeAccount(rows) {
  if (!rows.length) return [];

  const rowsWithSpend = rows.filter(r => hasValue(r.cost) && r.cost > 10);
  if (!rowsWithSpend.length) return [];

  const totalConvs = rowsWithSpend.reduce((a, r) => a + (r.conversions ?? 0), 0);
  if (totalConvs > 0) return [];

  const totalSpend = rowsWithSpend.reduce((a, r) => a + (r.cost ?? 0), 0);

  return [{
    category: 'measurementRisk',
    severity: 'high',
    what: `אפס לידים מכל הנתונים שהעלאת. כל ההוצאה: CA$${fmt(totalSpend)}.`,
    why: `בעיה חמורה. לא סביר שעסק שירותים מקומי מקבל אפס פניות או לידים מתוך הוצאה כזו. בעיה במעקב.`,
    action: `בדוק Google Ads > כלים > קונברסיות. האם יש קונברסיה אחת הפעלה? בדוק שהמעקב כללי ופעיל. בדוק ב-Google Tag Manager.`,
    data: { totalSpend, totalConvs },
  }];
}

/**
 * Campaign report has no leads column — limits analysis severely.
 */
function missingLeadData(campaigns) {
  if (!campaigns.length) return [];

  const missingAll = campaigns.every(c => c.conversions === null);
  if (!missingAll) return [];

  return [{
    category: 'measurementRisk',
    severity: 'medium',
    what: `דוח קמפיינים חסר עמודת לידים.`,
    why: `בלי נתוני לידים לא יכול לזהות בזבוז או לחשב עלות לליד. זה מגביל הרבה מסקנות.`,
    action: `בדוק את הדוח ב-Google Ads. ודא שכללת עמודות "קונברסיות" ו"עלות לקונברסיה". העלה דוח משודרג.`,
    data: {},
  }];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasValue(v) { return v !== null && v !== undefined; }
function fmt(n) { return n != null ? n.toFixed(2) : '—'; }
