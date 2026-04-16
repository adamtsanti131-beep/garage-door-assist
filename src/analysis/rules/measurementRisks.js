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
  } = data;
  const allRows = [...campaigns, ...adGroups, ...searchTerms, ...keywords];

  findings.push(...manyClicksNoLeads([...searchTerms, ...keywords]));
  findings.push(...leadsExceedClicks(allRows));
  findings.push(...zeroLeadsWholeAccount(allRows));
  findings.push(...missingLeadData(campaigns));

  return findings;
}

// ── Rules ─────────────────────────────────────────────────────────────────────

/**
 * Search terms or keywords with many clicks but zero leads.
 * VERY HIGH confidence only: 50+ clicks with zero leads = likely tracking gap.
 * Lower thresholds suppressed (too speculative).
 */
function manyClicksNoLeads(rows) {
  const findings = [];
  for (const r of rows) {
    if (!hasValue(r.clicks) || r.clicks < 50) continue; // Much stricter: only 50+ clicks
    if (r.conversions !== 0 && r.conversions !== null) continue;

    const label = r.searchTerm ?? r.keyword ?? 'מונח לא ידוע';
    findings.push({
      category: 'measurementRisk',
      severity: 'high',
      what: `"${label}" קיבל ${r.clicks} קליקים ואפס לידים — סימן חזק למעקב שבור.`,
      why: 'בנפח של 50+ קליקים, אפס המרות הוא כמעט תמיד בעיית מדידה, לא כוונת חיפוש.',
      action: 'בדוק Firebase/GA4 בעמודי נחיתה — ודא שתגיות מעקב מורות בעמודיה התוקפות.',
      data: r,
      signal: 'many-clicks-no-leads',
    });
  }
  return findings;
}

/**
 * More leads than clicks recorded — almost always a tracking or config error.
 * This is HIGH severity because it's nearly impossible naturally.
 */
function leadsExceedClicks(rows) {
  const findings = [];
  for (const r of rows) {
    if (!hasValue(r.clicks) || !hasValue(r.conversions)) continue;
    if (r.clicks < 3 || r.conversions <= r.clicks) continue;

    const label = r.campaign ?? r.adGroup ?? r.keyword ?? r.searchTerm ?? 'ישות לא ידועה';
    findings.push({
      category: 'measurementRisk',
      severity: 'high',
      what: `"${label}" מציג ${r.conversions} לידים מתוך ${r.clicks} קליקים בלבד — נתונים כושלים.`,
      why: 'יותר המרות מקליקים בלתי אפשרי. זה תמיד בעיית מדידה — ספירה כפולה או הגדרה שגויה.',
      action: 'אל תסתמך על נתונים אלה להחלטות. בדוק Google Ads > Tools > Conversions וודא הגדרות מניעת כפילויות.',
      data: r,
      signal: 'conversions-exceed-clicks',
    });
  }
  return findings;
}

/**
 * Entire account shows zero leads — most likely a tracking setup issue.
 * This is HIGH confidence — entire account with no conversions is a red flag.
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
    what: `החשבון כולו מציג אפס לידים למרות הוצאה של CA$${fmt(totalSpend)}.`,
    why: 'זהו כמעט תמיד בעיית מדידה של אתחול. אתה מוציא כסף אך לא מותקן מעקב.',
    action: 'עצור קמפיינים מ-עכשיו. בדוק: 1) Google Ads > Tools > Conversions — פעולה ראשית פעילה?, 2) GTM — כל התגיות מורות?',
    data: { totalSpend, totalConvs },
    signal: 'account-zero-conversions',
  }];
}

/**
 * Campaign report has no leads column — severely limits analysis.
 * Only flag if ALL campaigns are missing data (not just sparse).
 */
function missingLeadData(campaigns) {
  if (!campaigns.length) return [];

  const missingAll = campaigns.every(c => c.conversions === null);
  if (!missingAll) return [];

  return [{
    category: 'measurementRisk',
    severity: 'high',
    what: 'בדוח הקמפיינים לא קיימת עמודת לידים כלל.',
    why: 'ללא לידים, לא ניתן לחשב יעילות או לקבל החלטות. בדוח זה אי אפשר להסתמך.',
    action: 'ייצא את דוח הקמפיינים מחדש עם עמודות "Conversions" ו-"Cost / conv". ודא שמעקב הוגדר.',
    data: {},
    signal: 'missing-campaign-conversions',
  }];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasValue(v) { return v !== null && v !== undefined; }
function fmt(n) { return typeof n === 'number' ? n.toFixed(2) : '—'; }
