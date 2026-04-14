/**
 * controlRisks.js
 * Rules that detect structural and control issues in the account.
 * These don't mean wasted spend directly, but indicate problems that could inflate CPL.
 */

import { THRESHOLDS as T } from '../thresholds.js';

export function controlRiskRules(data) {
  const findings = [];
  const { keywords = [], campaigns = [], adGroups = [] } = data;

  findings.push(...nonConvertingCampaigns(campaigns));
  findings.push(...expensiveKeywords(keywords));
  findings.push(...lowQualityScoreKeywords(keywords));
  findings.push(...broadMatchWithoutNegatives(keywords));
  findings.push(...lowImpressionShare(campaigns));

  return findings;
}

// ── Rules ─────────────────────────────────────────────────────────────────────

/**
 * Campaigns spending significantly with zero leads — suggests structural issue.
 */
function nonConvertingCampaigns(campaigns) {
  const findings = [];
  for (const camp of campaigns) {
    if (!hasValue(camp.cost) || camp.cost < T.minSpendForWaste * 2) continue;
    if (camp.conversions !== 0 && camp.conversions !== null) continue;

    findings.push({
      category: 'controlRisk',
      severity: 'high',
      what: `הקמפיין "${camp.campaign ?? 'קמפיין לא ידוע'}" הוציא CA$${fmt(camp.cost)} ללא המרות.`,
      why: 'קמפיין שלם שמוציא תקציב ללא תוצאות המרה מצביע על בעיית טירגוט או ביצוע מבנית.',
      action: 'לאמת קודם מעקב המרות, ואז לבדוק טירגוט והתאמת דף נחיתה. לעצור עד תיקון במקרה הצורך.',
      data: camp,
      signal: 'non-converting-campaign',
    });
  }
  return findings;
}

/**
 * Keywords with leads but CPL above the "poor" threshold.
 */
function expensiveKeywords(keywords) {
  const findings = [];
  for (const kw of keywords) {
    if (!hasValue(kw.conversions) || kw.conversions <= 0) continue;
    if (!hasValue(kw.cost) || kw.clicks < T.minClicksForConfidentJudgment) continue;

    const cpl = kw.cost / kw.conversions;
    if (cpl < T.cplPoor) continue;

    const severity = cpl >= T.cplSevere ? 'high' : 'medium';

    findings.push({
      category: 'controlRisk',
      severity,
      what: `מילת המפתח "${kw.keyword ?? 'מילת מפתח לא ידועה'}" (${kw.matchType ?? 'סוג התאמה לא ידוע'}) עומדת על CA$${fmt(cpl)} CPA.`,
      why: `ה-CPA גבוה מסף ביצועים חלש (CA$${T.cplPoor}) וסביר שאינו בר קיימא לצמיחה יעילה.`,
      action: 'להוריד הצעת מחיר ב-20%-30%, לבדוק איכות כוונת חיפוש, ולעצור אם היעילות לא משתפרת.',
      data: kw,
      signal: 'expensive-keyword',
    });
  }
  return findings;
}

/**
 * Keywords with low Quality Score — signals relevance issues that inflate cost.
 */
function lowQualityScoreKeywords(keywords) {
  const findings = [];
  for (const kw of keywords) {
    if (!hasValue(kw.qualityScore)) continue;
    if (kw.qualityScore >= T.lowQualityScore) continue;
    if (!hasValue(kw.impressions) || kw.impressions < T.minImpressionsForQS) continue;

    findings.push({
      category: 'controlRisk',
      severity: kw.qualityScore <= 2 ? 'high' : 'medium',
      what: `מילת המפתח "${kw.keyword ?? 'מילת מפתח לא ידועה'}" עם ציון איכות ${kw.qualityScore}/10.`,
      why: 'ציון איכות נמוך בדרך כלל מעלה CPC ומחליש את דירוג המודעה בתחרות.',
      action: 'לשפר רלוונטיות מודעה, CTR צפוי והתאמת דף נחיתה לקבוצת המילים הזו.',
      data: kw,
      signal: 'low-quality-score',
    });
  }
  return findings;
}

/**
 * Broad or broad modified keywords with high spend and no leads — signals poor control.
 */
function broadMatchWithoutNegatives(keywords) {
  const findings = [];
  const broadKeywords = keywords.filter(kw =>
    hasValue(kw.matchType) &&
    kw.matchType.toLowerCase().includes('broad') &&
    hasValue(kw.cost) &&
    kw.cost > T.minSpendForWaste &&
    (!hasValue(kw.conversions) || kw.conversions === 0)
  );

  if (broadKeywords.length >= 3) {
    const totalBroadSpend = broadKeywords.reduce((a, k) => a + (k.cost ?? 0), 0);
    findings.push({
      category: 'controlRisk',
      severity: 'medium',
      what: `${broadKeywords.length} מילות מפתח בהתאמה רחבה הוציאו CA$${fmt(totalBroadSpend)} ללא המרות.`,
      why: 'התאמה רחבה ללא כיסוי שלילות חזק גורמת לרוב לזליגת תקציב לשאילתות עם כוונה נמוכה.',
      action: 'לבדוק מונחי חיפוש, להרחיב רשימת שלילות, ולהעביר מונחים רחבים בעייתיים להתאמה ביטויית או מדויקת כשצריך.',
      data: { broadKeywords, totalBroadSpend },
      signal: 'broad-match-risk',
    });
  }
  return findings;
}

/**
 * Converting campaigns with low impression share — winning but missing volume.
 */
function lowImpressionShare(campaigns) {
  const findings = [];
  for (const camp of campaigns) {
    if (!hasValue(camp.searchImprShare)) continue;
    if (!hasValue(camp.conversions) || camp.conversions < 1) continue;

    const is = camp.searchImprShare; // already a percentage
    if (is >= T.lowImprShareWarn * 100) continue;

    findings.push({
      category: 'controlRisk',
      severity: 'medium',
      what: `לקמפיין "${camp.campaign ?? 'קמפיין לא ידוע'}" יש רק ${fmt(is)}% נתח חשיפות בחיפוש.`,
      why: 'הקמפיין ממיר אך מפספס חלק גדול מהביקוש הזכאי.',
      action: 'לזהות אם האובדן נובע מתקציב או דירוג, ואז להתאים תקציב, הצעת מחיר או איכות בהתאם.',
      data: camp,
      signal: 'low-impression-share',
    });
  }
  return findings;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasValue(v) { return v !== null && v !== undefined; }
function fmt(n) { return n != null ? n.toFixed(2) : '—'; }
