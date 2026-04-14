/**
 * waste.js
 * Rules that detect budget being spent with no meaningful return (zero leads).
 * Focus: lead generation efficiency, not profitability.
 */

import { THRESHOLDS as T } from '../thresholds.js';
import { pickWasteSource, sumMetric } from '../dataSources.js';

export function wasteRules(data) {
  const findings = [];
  const { searchTerms = [], keywords = [], adGroups = [] } = data;
  const wasteSource = pickWasteSource(data);

  findings.push(...zeroLeadsHighSpend([...searchTerms, ...keywords]));
  findings.push(...overallWastedSpendPct(wasteSource.rows, wasteSource.key));
  findings.push(...expensiveKeywordsNoLeads(keywords));
  findings.push(...nonConvertingAdGroups(adGroups));

  return findings;
}

// ── Individual rules ──────────────────────────────────────────────────────────

/**
 * Search terms or keywords with meaningful spend or clicks but zero leads.
 * Waste flagging logic:
 * - cost >= 75 CAD, OR
 * - clicks >= 15, OR
 * - (cost >= 50 AND clicks >= 15)
 */
function zeroLeadsHighSpend(rows) {
  const findings = [];
  for (const r of rows) {
    if (!hasValue(r.cost) || !hasValue(r.clicks)) continue;
    if (r.conversions !== 0 && r.conversions !== null) continue; // only zero leads

    // Check waste threshold
    const meetsWasteThreshold =
      r.cost >= T.minSpendForWaste ||
      r.clicks >= T.minClicksForWaste ||
      (r.cost >= T.minSpendWithClicksGate && r.clicks >= T.minClicksForWaste);

    if (!meetsWasteThreshold) continue;

    const label = r.searchTerm ?? r.keyword ?? 'מונח לא ידוע';
    const severity = r.cost >= T.minSpendForWaste ? 'high' : 'medium';

    findings.push({
      category: 'waste',
      severity,
      what: `"${label}" הוציא CA$${fmt(r.cost)} עם ${r.clicks} קליקים וללא המרות.`,
      why: 'נפח הנתונים מספיק גבוה כדי להחשיב זאת כבזבוז אמין ולא כרעש אקראי.',
      action: r.searchTerm
        ? `להוסיף את "${label}" כמילת מפתח שלילית, או לשלול רק את החלק הלא רלוונטי אם חלק מהמונח עדיין שימושי.`
        : 'לבדוק מונחי חיפוש קשורים ולהוסיף שלילות לשאילתות לא רלוונטיות לפני הגדלת תקציב.',
      data: r,
      signal: 'zero-leads-term',
    });
  }
  return findings;
}

/**
 * What percentage of total spend has zero leads?
 */
function overallWastedSpendPct(rows, sourceKey) {
  const totalSpend = sumMetric(rows, 'cost');
  if (!totalSpend || totalSpend === 0) return [];

  const wastedSpend = rows
    .filter(r => r.conversions === 0 && hasValue(r.cost) && r.cost > 5)
    .reduce((a, r) => a + r.cost, 0);

  const pct = wastedSpend / totalSpend;

  if (pct >= T.wastedSpendCritPct) {
    return [{
      category: 'waste',
      severity: 'high',
      what: `${pct100(pct)}% מההוצאה מתוך ${labelForSource(sourceKey)} יצרו אפס המרות (CA$${fmt(wastedSpend)} מתוך CA$${fmt(totalSpend)}).`,
      why: 'חלק גדול מהתקציב לא מייצר תוצאה מדידה ולכן פוגע מהותית ביעילות החשבון.',
      action: 'להריץ ניקוי בזבוז: להדק סוגי התאמה, להוסיף שלילות ממונחי החיפוש, ולהוריד הצעות מחיר בישויות לא ממירות.',
      data: { wastedSpend, totalSpend, source: sourceKey },
      signal: 'wasted-spend-share',
    }];
  }

  if (pct >= T.wastedSpendWarnPct) {
    return [{
      category: 'waste',
      severity: 'medium',
      what: `${pct100(pct)}% מההוצאה מתוך ${labelForSource(sourceKey)} יצרו אפס המרות (CA$${fmt(wastedSpend)} מתוך CA$${fmt(totalSpend)}).`,
      why: 'החשבון מדליף תקציב לאזורים שבשלב זה אינם ממירים.',
      action: 'לבדוק ישויות שאינן ממירות ולהדק טירגוט לפני הגדלה.',
      data: { wastedSpend, totalSpend, source: sourceKey },
      signal: 'wasted-spend-share',
    }];
  }

  return [];
}

/**
 * Keywords with significant clicks and spend but zero leads.
 */
function expensiveKeywordsNoLeads(keywords) {
  const findings = [];
  for (const kw of keywords) {
    if (!hasValue(kw.cost) || !hasValue(kw.clicks)) continue;
    if (kw.conversions !== 0 && kw.conversions !== null) continue;
    if (kw.clicks < T.minClicksForConfidentJudgment) continue; // need 15+ clicks for strong judgment

    findings.push({
      category: 'waste',
      severity: 'medium',
      what: `מילת המפתח "${kw.keyword ?? 'מילת מפתח לא ידועה'}" (${kw.matchType ?? 'סוג התאמה לא ידוע'}) קיבלה ${kw.clicks} קליקים והוצאה של CA$${fmt(kw.cost)} ללא המרות.`,
      why: 'בנפח קליקים כזה זו מועמדת חזקה לבזבוז.',
      action: 'להוריד הצעת מחיר ב-20%, לאמת כוונת חיפוש והתאמת דף נחיתה, ואז לעצור אם אין שיפור אחרי מחזור בדיקה.',
      data: kw,
      signal: 'non-converting-keyword',
    });
  }
  return findings;
}

/**
 * Ad groups spending significantly with zero leads.
 */
function nonConvertingAdGroups(adGroups) {
  const findings = [];
  for (const ag of adGroups) {
    if (!hasValue(ag.cost)) continue;
    if (ag.cost < T.minSpendForWaste * 2) continue; // need meaningful spend (2x threshold)
    if (ag.conversions !== 0 && ag.conversions !== null) continue;

    findings.push({
      category: 'waste',
      severity: 'medium',
      what: `קבוצת המודעות "${ag.adGroup ?? 'קבוצת מודעות לא ידועה'}" בקמפיין "${ag.campaign ?? 'קמפיין לא ידוע'}" הוציאה CA$${fmt(ag.cost)} ללא המרות.`,
      why: 'נראה שמדובר בבעיה מבנית ברמת קבוצת מודעות, לא במקרה נקודתי של מונח בודד.',
      action: 'לבצע ביקורת איכות מונחים, רלוונטיות מודעה והתאמת דף נחיתה; לעצור אם ניסיונות התיקון לא מצליחים.',
      data: ag,
      signal: 'non-converting-adgroup',
    });
  }
  return findings;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasValue(v) { return v !== null && v !== undefined; }
function fmt(n) { return n != null ? n.toFixed(2) : '—'; }
function pct100(n) { return (n * 100).toFixed(0); }

function labelForSource(sourceKey) {
  const labels = {
    campaigns: 'נתונים ברמת קמפיין',
    adGroups: 'נתונים ברמת קבוצת מודעות',
    keywords: 'נתונים ברמת מילת מפתח',
    searchTerms: 'נתונים ברמת מונח חיפוש',
    ads: 'נתונים ברמת מודעה',
    devices: 'נתונים ברמת מכשיר',
    locations: 'נתונים ברמת מיקום',
  };
  return labels[sourceKey] ?? 'מערך הנתונים שנבחר';
}
