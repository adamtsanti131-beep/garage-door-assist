/**
 * controlRisks.js
 * Rules that detect structural and bidding control issues in the account.
 */

import { THRESHOLDS as T } from '../thresholds.js';

export function controlRiskRules(data) {
  const findings = [];
  const { keywords = [], campaigns = [], adGroups = [] } = data;

  findings.push(...nonConvertingCampaigns(campaigns));
  findings.push(...highCpaKeywords(keywords));
  findings.push(...lowQualityScoreKeywords(keywords));
  findings.push(...broadMatchWithNoNegatives(keywords));
  findings.push(...lowImpressionShare(campaigns));

  return findings;
}

// ── Rules ─────────────────────────────────────────────────────────────────────

/**
 * Campaigns spending significantly with zero conversions.
 */
function nonConvertingCampaigns(campaigns) {
  const findings = [];
  for (const camp of campaigns) {
    if (!hasValue(camp.cost) || camp.cost < T.minSpendToFlag * 2) continue;
    if (camp.conversions !== 0 && camp.conversions !== null) continue;

    findings.push({
      category: 'controlRisk',
      severity: 'high',
      what:   `Campaign "${camp.campaign ?? 'Unknown'}" spent CA$${fmt(camp.cost)} with zero conversions recorded.`,
      why:    `An entire campaign with significant spend and no conversions suggests a fundamental issue: wrong targeting, broken landing page, or a tracking gap.`,
      action: `Pause new spend immediately. Check: (1) is conversion tracking firing? (2) are ads showing to the right audience? (3) does the landing page load correctly?`,
      data: camp,
    });
  }
  return findings;
}

/**
 * Keywords with conversions but CPA above the poor threshold.
 */
function highCpaKeywords(keywords) {
  const findings = [];
  for (const kw of keywords) {
    if (!hasValue(kw.conversions) || kw.conversions <= 0) continue;
    if (!hasValue(kw.cost)) continue;

    const cpa = kw.cost / kw.conversions;
    if (cpa < T.cpaPoor) continue;

    findings.push({
      category: 'controlRisk',
      severity: cpa >= T.cpoPoor * 1.5 ? 'high' : 'medium',
      what:   `Keyword "${kw.keyword ?? 'Unknown'}" [${kw.matchType ?? '?'}] is converting at CA$${fmt(cpa)}/conv — above the CA$${T.cpaPoor} poor threshold.`,
      why:    `At this cost per lead the keyword is likely not profitable. If average job value is ~CA$300–500, a CA$${fmt(cpa)} lead cost leaves little margin.`,
      action: `Reduce the bid by 20–30%. If CPA does not improve after 2 weeks, pause and review what searches are triggering this keyword.`,
      data: kw,
    });
  }
  return findings;
}

/**
 * Keywords with low Quality Scores — signals relevance issues that inflate CPC.
 */
function lowQualityScoreKeywords(keywords) {
  const findings = [];
  for (const kw of keywords) {
    if (!hasValue(kw.qualityScore)) continue;
    if (kw.qualityScore >= T.lowQualityScore) continue;
    if (!hasValue(kw.clicks) || kw.clicks < 5) continue; // not enough data

    findings.push({
      category: 'controlRisk',
      severity: kw.qualityScore <= 2 ? 'high' : 'medium',
      what:   `Keyword "${kw.keyword ?? 'Unknown'}" has a Quality Score of ${kw.qualityScore}/10.`,
      why:    `Low Quality Scores directly increase your cost per click. A QS of ${kw.qualityScore} means you are paying significantly more than competitors with better relevance.`,
      action: `Check ad copy relevance to the keyword, landing page alignment, and expected CTR. If all are poor, consider pausing this keyword and replacing it with tighter alternatives.`,
      data: kw,
    });
  }
  return findings;
}

/**
 * Broad or broad match modified keywords with high spend — signals poor control.
 */
function broadMatchWithNoNegatives(keywords) {
  const findings = [];
  const broadKeywords = keywords.filter(kw =>
    hasValue(kw.matchType) &&
    kw.matchType.toLowerCase().includes('broad') &&
    hasValue(kw.cost) &&
    kw.cost > T.minSpendToFlag &&
    (!hasValue(kw.conversions) || kw.conversions === 0)
  );

  if (broadKeywords.length >= 3) {
    const totalBroadSpend = broadKeywords.reduce((a, k) => a + (k.cost ?? 0), 0);
    findings.push({
      category: 'controlRisk',
      severity: 'medium',
      what:   `${broadKeywords.length} broad match keyword(s) have spent CA$${fmt(totalBroadSpend)} combined with zero conversions.`,
      why:    `Broad match without a strong negative keyword list often matches irrelevant searches. For a local service business this is a common source of wasted spend.`,
      action: `Review the Search Terms report for these broad match keywords. Add irrelevant terms as negatives. Consider switching to phrase or exact match for better control.`,
      data: { broadKeywords, totalBroadSpend },
    });
  }
  return findings;
}

/**
 * Converting campaigns with low impression share — you are winning but not capturing full demand.
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
      what:   `Campaign "${camp.campaign ?? 'Unknown'}" is converting but only showing ${fmt(is)}% of the time when triggered (impression share).`,
      why:    `You are winning leads from this campaign but missing 60%+ of eligible searches. Competitors may be capturing those leads instead.`,
      action: `Check if budget or ad rank is limiting impression share. If budget: increase it. If rank: improve Quality Score or raise bids on top-performing keywords.`,
      data: camp,
    });
  }
  return findings;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasValue(v) { return v !== null && v !== undefined; }
function fmt(n)      { return n != null ? n.toFixed(2) : '—'; }
