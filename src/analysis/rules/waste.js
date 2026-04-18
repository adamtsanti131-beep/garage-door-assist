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
    const isHardWaste =
      (r.cost >= T.minSpendForWaste && r.clicks >= 3) ||
      r.clicks >= T.minClicksForWaste;

    if (isHardWaste) {
      const severity = r.cost >= T.minSpendForWaste ? 'high' : 'medium';
      findings.push({
        category: 'waste',
        severity,
        what: `"${label}" הוציא CA$${fmt(r.cost)} עם ${r.clicks} קליקים ללא שום ליד.`,
        why: `בנפח זה (${r.clicks} קליקים), זה לא רעש — זה בזבוז יציב. כל שקל הוא הפסדה.`,
        action: r.searchTerm
          ? `תוסיף "${label}" כשלילית עכשיו. אם הביטוי משומש חלקית, ייצא מונחים חיפוש והוסף רק את החלק הלא-רלוונטי.`
          : 'לסקור את דוח מונחי החיפוש, לזהות אילו שאילתות לא רלוונטיות, ולהוסיף לשליליות.',
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
        what: `"${label}" קיבל ${r.clicks} קליקים ו-CA$${fmt(r.cost)} ללא לידים — עדיין נפח קטן.`,
        why: `עדיין מעט נתונים לעריכת דין סופי. בעוד ${15 - r.clicks} קליקים נוספים תהיה תמונה ברורה.`,
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
      what: `${pct100(pct)}% מהתקציב שלך ב${labelForSource(sourceKey)} בוזבזו ללא לידים (CA$${fmt(wastedSpend)} מתוך CA$${fmt(totalSpend)}).`,
      why: 'חלק ענק מהתקציב אובד ללא תוצאה. זו בעיה מבנית, לא נקודתית.',
      action: wastedSpendShareAction(sourceKey, 'critical'),
      data: { wastedSpend, totalSpend, source: sourceKey },
      signal: 'wasted-spend-share',
    }];
  }

  if (pct >= T.wastedSpendWarnPct) {
    return [{
      category: 'waste',
      severity: 'high',
      what: `${pct100(pct)}% מהתקציב שלך ב${labelForSource(sourceKey)} בוזבזו ללא לידים (CA$${fmt(wastedSpend)} מתוך CA$${fmt(totalSpend)}).`,
      why: 'בעיה משמעותית בשליטה על תקציב — החשבון מדליף כסף לישויות שלא ממירות.',
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
      what: `מילת מפתח "${kw.keyword ?? 'מילת מפתח לא ידועה'}" (${kw.matchType ?? 'סוג התאמה לא ידוע'}) קיבלה ${kw.clicks} קליקים וCA$${fmt(kw.cost)} בלי לידים.`,
      why: 'בנפח קליקים זה, זו מועמדת חזקה לבזבוז. זה לא רעש — זה משהו שלא עובד.',
      action: 'הפסק את מילת המפתח עכשיו או הוריד הצעת מחיר ב-30%-40%. אם אין שיפור תוך 5 ימים, השהה.',
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
      what: `קבוצת מודעות "${ag.adGroup ?? 'קבוצת מודעות לא ידועה'}" בקמפיין "${ag.campaign ?? 'קמפיין לא ידוע'}" הוציאה CA$${fmt(ag.cost)} ללא לידים.`,
      why: 'בעיה מבנית בקבוצה זו — מונחים לא רלוונטיים, מודעות חלשות, או דף נחיתה לא תקין. לא חד-פעמי.',
      action: 'בדוק רשימת מילות המפתח בקבוצה זו. אם הן לא רלוונטיות, מחק את הקבוצה. אם כן, עדכן מודעות או דף נחיתה.',
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
