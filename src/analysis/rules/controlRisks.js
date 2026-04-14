/**
 * controlRisks.js
 * Rules that detect structural and control issues in the account.
 * These don't mean wasted spend directly, but indicate problems that could inflate CPL.
 * Language: Hebrew, practical and direct.
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
      what: `קמפיין "${camp.campaign ?? 'לא ידוע'}" — הוצאה CA$${fmt(camp.cost)} ללא לידים.`,
      why: `קמפיין שלם עם הוצאה משמעותית ובלי לידים. זה יכול להיות בעיה במעקב, בכיוונון או בעמוד הנחיתה.`,
      action: `קודם בדוק: האם מעקב הלידים פועל? האם כיוונון תקין? האם דף הנחיתה טוען כראוי? אם הכל בסדר, שקול הפסקה או תיקון.`,
      data: camp,
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
      what: `"${kw.keyword ?? 'לא ידוע'}" [${kw.matchType ?? '?'}] — עלות לליד CA$${fmt(cpl)}.`,
      why: `עלות הליד גבוהה מהרף המקסימלי (CA$${T.cplPoor}). לידים כאלה יקרים ביחס לשווי שהם מביאים.`,
      action: `צמצם את ההצעה ב-20-30%. עקוב לשבוע. אם הוצאה לא משתפרת, שקול הפסקה او בדיקה של איכות התנועה.`,
      data: kw,
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
      what: `"${kw.keyword ?? 'לא ידוע'}" — איכות ${kw.qualityScore}/10.`,
      why: `איכות נמוכה משמעותה עלויות גבוהות יותר. המתחרים שלך עם ציוני איכות טובים משלמים פחות לקליק.`,
      action: `בדוק: את המודעה מתאימה? דף הנחיתה רלוונטי? קצב קליקים מצופה טוב? אם הכל לא בסדר — שקול הפסקה והחלפה.`,
      data: kw,
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
      what: `${broadKeywords.length} מילות broad match — CA$${fmt(totalBroadSpend)} בלי לידים.`,
      why: `Broad match ללא רשימה חזקה של מילים שליליות לעיתים קרובות לוכדת שאילתות שלא רלוונטיות. זה מקור נפוץ לבזבוז.`,
      action: `בדוק דוח מילות חיפוש. הוסף כל שאילתה לא רלוונטית כמילה שלילית. שקול להעביר ל-phrase או exact match לשליטה טובה יותר.`,
      data: { broadKeywords, totalBroadSpend },
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
      what: `קמפיין "${camp.campaign ?? 'לא ידוע'}" — נתח חשיפה רק ${fmt(is)}%.`,
      why: `אתה מנצח לידים מהקמפיין הזה אבל רק בחלק מהחיפושים. המתחרים לוכדים את השאר.`,
      action: `בדוק אם התקציב או דירוג המודעות הם הבעיה. אם תקציב — הגדל. אם דירוג — משפר Quality Score או הגדל הצעה.`,
      data: camp,
    });
  }
  return findings;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasValue(v) { return v !== null && v !== undefined; }
function fmt(n) { return n != null ? n.toFixed(2) : '—'; }
