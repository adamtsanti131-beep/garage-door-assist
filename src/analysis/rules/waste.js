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
 * Search terms or keywords with zero leads — three confidence tiers:
 *
 * HIGH (act now):
 *   cost >= CA$75 AND clicks >= 3   ← spend is high enough + enough traffic to judge
 *   OR clicks >= 15                  ← enough traffic regardless of spend
 *
 * MEDIUM (soft caution — watch, not yet act):
 *   clicks 5–14 AND cost >= CA$20   ← early signal, not conclusive
 *   OR cost >= CA$50 AND clicks 5–14
 *
 * SUPPRESS (too early, no finding):
 *   clicks < 5
 */
function zeroLeadsHighSpend(rows) {
  const findings = [];
  for (const r of rows) {
    if (!hasValue(r.cost) || !hasValue(r.clicks)) continue;
    if (r.conversions == null || r.conversions > 0) continue; // only explicit zero leads; null = unknown, skip

    const label = r.searchTerm ?? r.keyword ?? 'מונח לא ידוע';

    // ── Tier HIGH: real waste signal ─────────────────────────────────────────
    // Require 5+ clicks for the spend+click combined path — 3 clicks is not enough data.
    const isHardWaste =
      (r.cost >= T.minSpendForWaste && r.clicks >= 5) ||
      r.clicks >= T.minClicksForWaste;

    if (isHardWaste) {
      const severity = r.cost >= T.minSpendForWaste ? 'high' : 'medium';
      findings.push({
        category: 'waste',
        severity,
        what: `"${label}": CA$${fmt(r.cost)} הוצאה, ${r.clicks} קליקים, 0 לידים.`,
        why: r.clicks >= T.minClicksForWaste
          ? `${r.clicks} קליקים ללא ליד אחד — אות ברור לכוונת חיפוש לא רלוונטית.`
          : `CA$${fmt(r.cost)} הוצאה ב-${r.clicks} קליקים ללא תוצאה — מספיק נתונים לפעולה.`,
        action: r.searchTerm
          ? `להוסיף "${label}" כשלילית. אם חלק מהביטוי רלוונטי, לסקור מונחי חיפוש ולהוסיף שלילה מדויקת לחלק שאינו.`
          : 'לסקור דוח מונחי חיפוש, לזהות שאילתות לא רלוונטיות ולהוסיפן לשליליות.',
        data: r,
        signal: 'zero-leads-term',
      });
      continue;
    }

    // ── Tier MEDIUM: early watch signal ──────────────────────────────────────
    const isSoftWatch =
      r.clicks >= T.minClicksForSoftCaution &&
      (r.cost >= T.minSpendForSoftCaution || r.cost >= T.minSpendWithClicksGate * 0.6);

    if (isSoftWatch) {
      findings.push({
        category: 'waste',
        severity: 'low',
        what: `"${label}": ${r.clicks} קליקים, CA$${fmt(r.cost)}, 0 לידים — נפח עדיין קטן.`,
        why: `עוד ${T.minClicksForWaste - r.clicks} קליקים יתנו תמונה ברורה. לא לפעול עדיין.`,
        action: r.searchTerm
          ? 'נטור — אם אין המרה בקליקים הבאים, שקול שלילה או בדיקת דף נחיתה.'
          : 'נטור את המטרה. אם נפח הקליקים יגיע ל-15 ללא המרה, טפל בתנאים בלבד.',
        data: r,
        signal: 'zero-leads-watch',
      });
    }
    // clicks < 5 → suppress silently (too early to judge at all)
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
      what: `${pct100(pct)}% מהתקציב ב${labelForSource(sourceKey)} הלכו ללא לידים (CA$${fmt(wastedSpend)} מתוך CA$${fmt(totalSpend)}).`,
      why: 'יותר מרבע התקציב לא מייצר תוצאות — בעיה מבנית שדורשת טיפול.',
      action: wastedSpendShareAction(sourceKey, 'critical'),
      data: { wastedSpend, totalSpend, source: sourceKey },
      signal: 'wasted-spend-share',
    }];
  }

  if (pct >= T.wastedSpendWarnPct) {
    return [{
      category: 'waste',
      severity: 'high',
      what: `${pct100(pct)}% מהתקציב ב${labelForSource(sourceKey)} הלכו ללא לידים (CA$${fmt(wastedSpend)} מתוך CA$${fmt(totalSpend)}).`,
      why: 'שיעור הוצאה ללא תוצאה גבוה מהסף — כדאי לטפל לפני הגדלת תקציב.',
      action: wastedSpendShareAction(sourceKey, 'warn'),
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
    if (kw.conversions == null || kw.conversions > 0) continue; // only explicit zero leads
    if (kw.clicks < T.minClicksForConfidentJudgment) continue; // need 15+ clicks for strong judgment

    findings.push({
      category: 'waste',
      severity: 'high',
      what: `מילת מפתח "${kw.keyword ?? 'מילת מפתח לא ידועה'}" (${kw.matchType ?? '—'}): ${kw.clicks} קליקים, CA$${fmt(kw.cost)}, 0 לידים.`,
      why: `${kw.clicks} קליקים ללא ליד אחד — מספיק נתונים להחלטה על מילת מפתח זו.`,
      action: 'להוריד הצעת מחיר ב-30%–40% מיד. אם אין שיפור תוך שבוע, להשהות.',
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
    if (!hasValue(ag.cost) || !hasValue(ag.clicks)) continue;
    if (ag.cost < T.minSpendForWaste * 2) continue; // need meaningful spend (2x threshold)
    if (ag.clicks < T.minClicksForConfidentJudgment) continue; // need 15+ clicks to judge an ad group
    if (ag.conversions == null || ag.conversions > 0) continue; // only explicit zero leads

    findings.push({
      category: 'waste',
      severity: 'high',
      what: `קבוצה "${ag.adGroup ?? '—'}" (קמפיין "${ag.campaign ?? '—'}"): CA$${fmt(ag.cost)}, ${ag.clicks} קליקים, 0 לידים.`,
      why: 'הוצאה משמעותית בקבוצה ללא תוצאה — בעיה במילות מפתח, מודעה, או דף נחיתה.',
      action: 'לסקור מילות מפתח בקבוצה זו. אם לא רלוונטיות — להשהות את הקבוצה. אם כן — לעדכן מודעות ודף נחיתה.',
      data: ag,
      signal: 'non-converting-adgroup',
    });
  }
  return findings;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasValue(v) { return v !== null && v !== undefined; }
function fmt(n) { return typeof n === 'number' ? n.toFixed(2) : '—'; }
function pct100(n) { return typeof n === 'number' ? (n * 100).toFixed(0) : '—'; }

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

function wastedSpendShareAction(sourceKey, level) {
  if (sourceKey === 'searchTerms') {
    return level === 'critical'
      ? 'לבצע ניקוי מונחי חיפוש באופן מדורג: לזהות שאילתות לא רלוונטיות, להוסיף שלילות ממוקדות, ולהפחית חשיפה רק לקבוצות שממשיכות ללא לידים.'
      : 'להדק שליטה במונחי חיפוש: להוסיף שלילות ממוקדות, לצמצם התאמות רחבות בעייתיות, ולעקוב אחרי שינוי ההמרות לפני צעד נוסף.';
  }

  if (sourceKey === 'keywords') {
    return level === 'critical'
      ? 'לבצע בדיקה מדורגת של מילות מפתח ללא לידים, להפחית הצעות במילות מפתח חלשות, ולהשהות רק ישויות שממשיכות לבזבז.'
      : 'לבדוק מילות מפתח עם אפס לידים, לצמצם הצעות במוקדי בזבוז, ולעקוב אחרי יציבות עלות לליד.';
  }

  return level === 'critical'
    ? 'לבצע בדיקה שמרנית של ישויות עם 0 לידים: לאמת מעקב המרות, לבדוק כוונת חיפוש ודף נחיתה, ולהפחית חשיפה בהדרגה לפני עצירה.'
    : 'להדק שליטה בישויות עם אפס לידים באמצעות בדיקה מדורגת, שלילות ממוקדות וצמצום חשיפה נקודתי.';
}
