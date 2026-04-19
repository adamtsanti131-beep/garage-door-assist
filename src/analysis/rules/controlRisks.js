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
    if (!hasValue(camp.clicks) || camp.clicks < 5) continue; // need 5+ clicks to judge a campaign
    if (camp.conversions == null || camp.conversions > 0) continue; // only explicit zero leads

    findings.push({
      category: 'controlRisk',
      severity: 'high',
      what: `קמפיין "${camp.campaign ?? '—'}": CA$${fmt(camp.cost)}, ${camp.clicks} קליקים, 0 לידים.`,
      why: 'קמפיין מוציא תקציב ללא המרות — בעיה בכוונת חיפוש, דף נחיתה, או מעקב.',
      action: 'לאמת מעקב המרות. לבדוק דף נחיתה ורלוונטיות מודעות. לשהות רק לאחר שתיקון הבעיה המבנית ברור.',
      data: camp,
      signal: 'non-converting-campaign',
    });
  }
  return findings;
}

/**
 * Keywords with leads but CPL above the "borderline" threshold.
 * Two tiers:
 *   HIGH  (>= CA$150): severe — act now
 *   MEDIUM (CA$96–149): expensive — reduce and test
 * SUPPRESSED: no low severity keywords (not actionable)
 */
function expensiveKeywords(keywords) {
  const findings = [];
  for (const kw of keywords) {
    if (!hasValue(kw.conversions) || kw.conversions <= 0) continue;
    if (!hasValue(kw.cost) || kw.clicks < T.minClicksForConfidentJudgment) continue;

    const cpl = kw.cost / kw.conversions;
    if (cpl <= T.cplBorderline) continue; // <= CA$95 → acceptable range

    const label = kw.keyword ?? 'מילת מפתח לא ידועה';
    const matchType = kw.matchType ?? 'סוג התאמה לא ידוע';

    // Tier HIGH: severe CPL (>= CA$150)
    if (cpl >= T.cplSevere) {
      findings.push({
        category: 'controlRisk',
        severity: 'high',
        what: `מילת מפתח "${label}" (${matchType}) עומדת על CA$${fmt(cpl)} CPL — בעל ביצועים דלי.`,
        why: `ה-CPL גבוה משמעותית מהיעד — כל דולר שמוצא כאן מניב פחות מהמצופה.`,
        action: 'להוריד הצעת מחיר ב-25%-35% מיד. אם לא שיפור תוך שבוע, להשהות את מילת המפתח.',
        data: kw,
        signal: 'expensive-keyword',
      });
      continue;
    }

    // Tier MEDIUM: expensive range (CA$96–149)
    findings.push({
      category: 'controlRisk',
      severity: 'medium',
      what: `מילת מפתח "${label}" (${matchType}) עומדת על CA$${fmt(cpl)} CPL — טווח יקר.`,
      why: 'CPL יקר — יעילות נמוכה שמצריכה שיפור רלוונטיות או הורדת הצעת מחיר.',
      action: 'שנה את ניסוח המודעה כדי להגביר רלוונטיות, והורד הצעת מחיר ב-10%-15% אם לא ישתפר בתוך שבוע.',
      data: kw,
      signal: 'expensive-keyword',
    });
  }
  return findings;
}

/**
 * Keywords with low Quality Score — signals relevance issues that inflate cost.
 * Only flag when there's sufficient impression volume to judge.
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
      what: `מילת מפתח "${kw.keyword ?? 'מילת מפתח לא ידועה'}" בציון איכות ${kw.qualityScore}/10.`,
      why: 'ציון איכות נמוך מגביר CPC וחוסם דירוג מודעה — אותה הוצאה מניבה פחות קליקים ולידים.',
      action: 'עדכן כותרות/תיאור מודעה להכללת מילת המפתח, ובדוק שדף הנחיתה תוקפים למה המשתמש חוקר.',
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
    kw.conversions === 0  // only explicit zero leads; null = unknown, excluded
  );

  const totalBroadSpend = broadKeywords.reduce((a, k) => a + (k.cost ?? 0), 0);
  // Require 4+ broad keywords AND CA$200+ total spend — smaller accounts often have a few
  // legitimate broad keywords with low spend that don't warrant action.
  if (broadKeywords.length >= 4 && totalBroadSpend >= 200) {
    findings.push({
      category: 'controlRisk',
      severity: 'high',
      what: `${broadKeywords.length} מילות מפתח בהתאמה רחבה הוציאו CA$${fmt(totalBroadSpend)} ללא לידים.`,
      why: 'התאמה רחבה ללא שלילות מפנה תקציב לשאילתות לא רלוונטיות — דפוס שיטתי.',
      action: 'לסקור דוח "Search Terms", להוסיף 10–15 שלילות מדויקות, ולשנות מילות מפתח רחבות לביטוי/מדויק.',
      data: { broadKeywords, totalBroadSpend },
      signal: 'broad-match-risk',
    });
  }
  return findings;
}

/**
 * Converting campaigns with low impression share — winning but missing volume.
 * If lost IS data is available, action text names the dominant loss driver directly.
 */
function lowImpressionShare(campaigns) {
  const findings = [];
  for (const camp of campaigns) {
    if (!hasValue(camp.searchImprShare)) continue;
    if (!hasValue(camp.conversions) || camp.conversions < 1) continue;

    const is = camp.searchImprShare; // already a percentage
    if (is >= T.lowImprShareWarn * 100) continue;

    const lostBudget = hasValue(camp.searchLostIsBudget) ? camp.searchLostIsBudget : null;
    const lostRank   = hasValue(camp.searchLostIsRank)   ? camp.searchLostIsRank   : null;

    // Build loss breakdown for the what text
    const lostParts = [];
    if (lostBudget != null) lostParts.push(`${fmt(lostBudget)}% מתקציב`);
    if (lostRank   != null) lostParts.push(`${fmt(lostRank)}% מדירוג`);
    const lostDesc = lostParts.length ? ` — ${lostParts.join(', ')}` : '';

    // Build action based on dominant loss driver
    let action;
    if (lostBudget != null && lostRank != null) {
      action = lostBudget > lostRank
        ? 'האובדן הרב מתקציב: הגדל תקציב יומי ב-15%-25% ונטר CPL ל-3 ימים.'
        : 'האובדן הרב מדירוג: הגדל הצעות ב-8%-12% או שפר ציון איכות.';
    } else if (lostBudget != null) {
      action = 'אובדן מתקציב בלבד: הגדל תקציב יומי ב-20% ונטר CPL ל-3 ימים.';
    } else if (lostRank != null) {
      action = 'אובדן מדירוג בלבד: הגדל הצעות ב-10% או שפר ציוני איכות. בדוק ש-CTR לא ירד.';
    } else {
      action = 'בדוק בדוח הקמפיין > עמודות אם החוסר מתקציב או דירוג. פעל בנקודה הדומיננטית.';
    }

    findings.push({
      category: 'controlRisk',
      severity: 'medium',
      what: `קמפיין "${camp.campaign ?? 'קמפיין לא ידוע'}" מחזיק רק ${fmt(is)}% נתח חשיפות${lostDesc}.`,
      why: 'הקמפיין ממיר אך מפספס ביקוש רלוונטי — הגדלת נוכחות יכולה להגדיל לידים בעלות דומה.',
      action,
      data: camp,
      signal: 'low-impression-share',
    });
  }
  return findings;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasValue(v) { return v !== null && v !== undefined; }
function fmt(n) { return typeof n === 'number' ? n.toFixed(2) : '—'; }
