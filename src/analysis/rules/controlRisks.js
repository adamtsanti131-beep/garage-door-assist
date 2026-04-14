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
      what: `Campaign "${camp.campaign ?? 'Unknown campaign'}" spent CA$${fmt(camp.cost)} with zero conversions.`,
      why: 'A whole campaign spending without conversion output points to structural targeting or execution issues.',
      action: 'Verify tracking first, then audit targeting and landing page alignment. Pause until corrected if needed.',
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
      what: `Keyword "${kw.keyword ?? 'Unknown keyword'}" (${kw.matchType ?? 'unknown match type'}) is at CA$${fmt(cpl)} CPA.`,
      why: `CPA is above the poor threshold (CA$${T.cplPoor}) and likely unsustainable for efficient growth.`,
      action: 'Reduce bid by 20-30%, review intent quality, and pause if efficiency does not recover.',
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
      what: `Keyword "${kw.keyword ?? 'Unknown keyword'}" has Quality Score ${kw.qualityScore}/10.`,
      why: 'Low quality score usually increases CPC and reduces competitive ad rank.',
      action: 'Improve ad relevance, expected CTR, and landing page alignment for this keyword cluster.',
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
      what: `${broadKeywords.length} broad-match keywords spent CA$${fmt(totalBroadSpend)} with zero conversions.`,
      why: 'Broad match without strong negative coverage often leaks spend to low-intent queries.',
      action: 'Audit search terms, expand negatives, and shift fragile broad terms to phrase or exact where appropriate.',
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
      what: `Campaign "${camp.campaign ?? 'Unknown campaign'}" has only ${fmt(is)}% search impression share.`,
      why: 'The campaign converts but misses a large share of eligible demand.',
      action: 'Identify whether loss is budget- or rank-driven, then adjust budget, bid, or quality inputs accordingly.',
      data: camp,
      signal: 'low-impression-share',
    });
  }
  return findings;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasValue(v) { return v !== null && v !== undefined; }
function fmt(n) { return n != null ? n.toFixed(2) : '—'; }
