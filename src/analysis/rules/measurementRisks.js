/**
 * measurementRisks.js
 * Rules that detect data quality and tracking issues.
 * These don't mean wasted spend, but rather: the data can't be trusted for decisions.
 */

import { THRESHOLDS as T } from '../thresholds.js';

export function measurementRiskRules(data) {
  const findings = [];
  const {
    searchTerms = [],
    keywords = [],
    campaigns = [],
    adGroups = [],
    ads = [],
    devices = [],
    locations = [],
  } = data;
  const allRows = [...campaigns, ...adGroups, ...searchTerms, ...keywords];

  findings.push(...manyClicksNoLeads([...searchTerms, ...keywords]));
  findings.push(...leadsExceedClicks(allRows));
  findings.push(...zeroLeadsWholeAccount(allRows));
  findings.push(...missingLeadData(campaigns));
  findings.push(...missingSegmentCoverage(ads, devices, locations));

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

    const label = r.searchTerm ?? r.keyword ?? 'מונח לא ידוע';
    findings.push({
      category: 'measurementRisk',
      severity: 'medium',
      what: `"${label}" עם ${r.clicks} קליקים ואפס המרות.`,
      why: 'בנפח כזה, או שהמעקב אינו שלם או שאיכות התנועה אינה ממוקדת מספיק.',
      action: 'לאמת קודם הגדרות מעקב המרות וייחוס, ואז לבדוק כוונת חיפוש והתאמת דף נחיתה.',
      data: r,
      signal: 'many-clicks-no-leads',
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

    const label = r.campaign ?? r.adGroup ?? r.keyword ?? r.searchTerm ?? 'ישות לא ידועה';
    findings.push({
      category: 'measurementRisk',
      severity: 'high',
      what: `"${label}" מציג ${r.conversions} המרות מתוך ${r.clicks} קליקים בלבד.`,
      why: 'יותר המרות מקליקים נגרם לרוב מספירה כפולה או מהגדרות המרה שגויות.',
      action: 'לבצע בדיקה של פעולות המרה, הגדרות מניעת כפילויות ולוגיקת הפעלת תגיות לפני שימוש בנתונים לאופטימיזציה.',
      data: r,
      signal: 'conversions-exceed-clicks',
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
    what: `לא נרשמו המרות בכלל הנתונים שהועלו למרות הוצאה של CA$${fmt(totalSpend)}.`,
    why: 'בדרך כלל זה מעיד על בעיית מדידה ולא בהכרח על ביצועים אמיתיים.',
    action: 'לבדוק פעולות המרה, הגדרות ראשי/משני ויישום תגיות ב-Google Ads וב-GTM.',
    data: { totalSpend, totalConvs },
    signal: 'account-zero-conversions',
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
    what: 'בדוח הקמפיינים אין ערכי המרות.',
    why: 'ללא המרות, היכולת לחשב CPA ולהסיק יעילות מוגבלת מאוד.',
    action: 'לייצא מחדש את דוח הקמפיינים כולל העמודות Conversions ו-Cost / conv.',
    data: {},
    signal: 'missing-campaign-conversions',
  }];
}

function missingSegmentCoverage(ads, devices, locations) {
  const missing = [];
  if (!ads.length) missing.push('Ads');
  if (!devices.length) missing.push('Devices');
  if (!locations.length) missing.push('Location');

  if (missing.length === 0 || missing.length === 3) return [];

  return [{
    category: 'measurementRisk',
    severity: 'low',
    what: `חסרים חלק ממערכי הנתונים הסגמנטליים האופציונליים: ${missing.join(', ')}.`,
    why: 'כיסוי חלקי של סגמנטים מפחית את רמת הביטחון בהמלצות ספציפיות לערוץ.',
    action: 'להעלות את כל הדוחות הסגמנטליים האופציונליים כשאפשר לקבלת אבחון מלא יותר.',
    data: { missingSegments: missing },
    signal: 'partial-segment-coverage',
  }];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasValue(v) { return v !== null && v !== undefined; }
function fmt(n) { return n != null ? n.toFixed(2) : '—'; }
