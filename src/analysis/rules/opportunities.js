/**
 * opportunities.js
 * Rules that identify strong performers and scaling opportunities.
 * Focus: lead generation efficiency, growth potential.
 * Language: Hebrew, practical and direct.
 */

import { THRESHOLDS as T } from '../thresholds.js';

export function opportunityRules(data) {
  const findings = [];
  const { searchTerms = [], keywords = [], campaigns = [], adGroups = [] } = data;

  findings.push(...strongLeaders([...searchTerms, ...keywords]));
  findings.push(...scalingCandidates([...searchTerms, ...keywords]));
  findings.push(...outperformingCampaigns(campaigns));
  findings.push(...budgetLimitedWinners(campaigns));

  return findings;
}

// ── Rules ─────────────────────────────────────────────────────────────────────

/**
 * Search terms/keywords with strong lead generation and good CPL.
 * Excellent (≤55): Always flag as opportunity to protect and scale.
 * Good (56–75): Only flag if there's real volume to justify scaling.
 */
function strongLeaders(rows) {
  const findings = [];
  for (const r of rows) {
    if (!hasValue(r.conversions) || r.conversions < T.minLeadsForWinner) continue;
    if (!hasValue(r.cost) || r.cost === 0) continue;

    const cpl = r.cost / r.conversions;
    if (cpl > T.cplGood) continue; // only <= 75 CAD

    const label = r.searchTerm ?? r.keyword ?? 'לא ידוע';
    const isExcellent = cpl <= T.cplExcellent;
    const clicks = r.clicks ?? 0;

    // Excellent CPL: Always opportunity
    if (isExcellent) {
      findings.push({
        category: 'opportunity',
        severity: 'high',
        what: `"${label}" — ${r.conversions} לידים בעלות CA$${fmt(cpl)}/ליד (סה״כ CA$${fmt(r.cost)}).`,
        why: `ביצועים מצוינים. זה הקמפיין שיביא לך הכי הרבה לקוחות בעבור כל דולר.`,
        action: r.searchTerm
          ? `הגן על המידע שלך בטו. כדאי להרחיב בעדינות. הוסף כמילה מדוקדקת אם עדיין לא.`
          : `הגן על הצעת הקמפיין. שקול להרחיב את ההצעה. בדוק שתקציב מספיק כדי להרוץ כל היום.`,
        data: r,
      });
    }
    // Good CPL with meaningful volume: Opportunity to scale
    else if (clicks >= 10) {
      findings.push({
        category: 'opportunity',
        severity: 'medium',
        what: `"${label}" — ${r.conversions} לידים בעלות CA$${fmt(cpl)}/ליד (סה״כ CA$${fmt(r.cost)}).`,
        why: `ביצועים טובים עם נפח טוב. יש כאן פוטנציאל אמיתי להרחבה.`,
        action: r.searchTerm
          ? `כדאי להגדיל את ההצעה ב-15–25%. עקוב על עלות הליד כשנפח גדל.`
          : `כדאי לשקול הרחבה של הצעה. הגדל בעדינות ועקוב על ביצועים.`,
        data: r,
      });
    }
    // Good CPL but low volume: Just good performer, don't push scaling
    else {
      findings.push({
        category: 'opportunity',
        severity: 'low',
        what: `"${label}" — ${r.conversions} לידים בעלות CA$${fmt(cpl)}/ליד.`,
        why: `ביצועים טובים. זה מה שכדאי להגן עליו.`,
        action: r.searchTerm
          ? `הגן על הביצוע. הוסף כמילה מדוקדקת אם עדיין לא.`
          : `הגן על הצעה. אל תוריד. כשנפח גדל, שקול להרחיב.`,
        data: r,
      });
    }
  }
  return findings;
}

/**
 * Search terms/keywords with good lead rate but low spend — scalable.
 * 2+ leads, < 50 CAD spend, conversion rate > 5%.
 */
function scalingCandidates(rows) {
  const findings = [];
  for (const r of rows) {
    if (!hasValue(r.conversions) || r.conversions < 1) continue;
    if (!hasValue(r.cost) || r.cost >= 50) continue;
    if (!hasValue(r.conversionRate) || r.conversionRate < T.strongConvRatePct) continue;

    const label = r.searchTerm ?? r.keyword ?? 'לא ידוע';
    findings.push({
      category: 'opportunity',
      severity: 'medium',
      what: `"${label}" — ${fmt(r.conversionRate)}% שיעור לידים עם רק CA$${fmt(r.cost)} הוצאה.`,
      why: `שיעור לידים גבוה בהוצאה נמוכה. יש פוטנציאל להרחבה ממשית.`,
      action: `הגדל את ההצעה ב-15–20%. עקוב על עלות הליד כשנפח גדל.`,
      data: r,
    });
  }
  return findings;
}

/**
 * Campaigns performing better than the account average CPL.
 */
function outperformingCampaigns(campaigns) {
  if (campaigns.length < 2) return [];

  const avgCpl = computeAvgCpl(campaigns);
  if (!avgCpl) return [];

  const findings = [];
  for (const camp of campaigns) {
    if (!hasValue(camp.conversions) || camp.conversions < T.minLeadsForWinner) continue;
    if (!hasValue(camp.cost)) continue;

    const cpl = camp.cost / camp.conversions;
    if (cpl > avgCpl * 0.75) continue; // needs to be meaningfully better (25%+)

    findings.push({
      category: 'opportunity',
      severity: 'high',
      what: `קמפיין "${camp.campaign ?? 'לא ידוע'}" — עלות לליד CA$${fmt(cpl)}, שהוא 25% יותר טוב מנתון הממוצע (CA$${fmt(avgCpl)}).`,
      why: `הקמפיין הזה עובד יותר טוב מממוצע החשבון. הגדלת תקציב כאן תביא יותר לידים יעילים.`,
      action: `הגן על תקציב הקמפיין. שקול להגדיל אותו מקמפיינים פחות יעילים.`,
      data: camp,
    });
  }
  return findings;
}

/**
 * Campaigns limited by budget based on lost impression share data.
 */
function budgetLimitedWinners(campaigns) {
  const findings = [];
  for (const camp of campaigns) {
    if (!hasValue(camp.searchLostIsBudget)) continue;
    if (camp.searchLostIsBudget < T.highLostIsBudgetWarn * 100) continue;
    if (!hasValue(camp.conversions) || camp.conversions < 1) continue;

    const cpl = hasValue(camp.cost) && camp.conversions > 0
      ? camp.cost / camp.conversions
      : null;

    if (cpl && cpl > T.cplPoor) continue; // don't recommend scaling a poor performer

    findings.push({
      category: 'opportunity',
      severity: 'medium',
      what: `קמפיין "${camp.campaign ?? 'לא ידוע'}" — מפסיד ${fmt(camp.searchLostIsBudget)}% נתח חשיפה בגלל תקציב.`,
      why: `אתה מקבל לידים מהקמפיין הזה, אבל התקציב מונע מהמודעות להופיע בכל הזמנים שאתה יכול. זה אומר לידים אבודים.`,
      action: `הגדל את התקציב היומי. אפילו +CA$20–30 יומיים יוכל להניב עוד לידים.`,
      data: camp,
    });
  }
  return findings;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasValue(v) { return v !== null && v !== undefined; }
function fmt(n) { return n != null ? n.toFixed(2) : '—'; }

function computeAvgCpl(campaigns) {
  const valid = campaigns.filter(c => hasValue(c.conversions) && c.conversions > 0 && hasValue(c.cost));
  if (!valid.length) return null;
  const totalCost = valid.reduce((a, c) => a + c.cost, 0);
  const totalConvs = valid.reduce((a, c) => a + c.conversions, 0);
  return totalConvs > 0 ? totalCost / totalConvs : null;
}
