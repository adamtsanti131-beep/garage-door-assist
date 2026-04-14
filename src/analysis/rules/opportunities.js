/**
 * opportunities.js
 * Rules that identify what is working and what can be scaled.
 */

import { THRESHOLDS as T } from '../thresholds.js';

export function opportunityRules(data) {
  const findings = [];
  const { searchTerms = [], keywords = [], campaigns = [], adGroups = [] } = data;

  findings.push(...strongConverters([...searchTerms, ...keywords]));
  findings.push(...scalingCandidates([...searchTerms, ...keywords]));
  findings.push(...outperformingCampaigns(campaigns));
  findings.push(...budgetLimitedWinners(campaigns));

  return findings;
}

// ── Rules ─────────────────────────────────────────────────────────────────────

/**
 * Terms/keywords with multiple conversions at a strong CPA.
 */
function strongConverters(rows) {
  const findings = [];
  for (const r of rows) {
    if (!hasValue(r.conversions) || r.conversions < T.minConversionsWinner) continue;
    if (!hasValue(r.cost) || r.cost === 0) continue;

    const cpa = r.cost / r.conversions;
    if (cpa > T.cpaAcceptable) continue;

    const label = r.searchTerm ?? r.keyword ?? 'Unknown';
    const isExcellent = cpa <= T.cpaExcellent;

    findings.push({
      category: 'opportunity',
      severity: isExcellent ? 'high' : 'medium',
      what:   `"${label}" generated ${r.conversions} conversion(s) at CA$${fmt(cpa)}/conv (CA$${fmt(r.cost)} total spend).`,
      why:    isExcellent
        ? `This term is converting at an excellent CPA — well below your CA$${T.cpaExcellent} target. This is your best use of budget.`
        : `This term is converting within an acceptable range. Protecting its budget prevents losing leads.`,
      action: r.searchTerm
        ? `Add "${label}" as an exact match keyword if not already. Ensure this term has enough budget to run all day.`
        : `Protect this keyword's budget. Consider increasing its bid to capture more impression share.`,
      data: r,
    });
  }
  return findings;
}

/**
 * Terms/keywords converting well but with low spend — room to scale.
 */
function scalingCandidates(rows) {
  const findings = [];
  for (const r of rows) {
    if (!hasValue(r.conversions) || r.conversions < 1) continue;
    if (!hasValue(r.cost) || r.cost >= 60) continue;
    if (!hasValue(r.conversionRate) || r.conversionRate < T.strongConvRatePct) continue;

    const label = r.searchTerm ?? r.keyword ?? 'Unknown';
    findings.push({
      category: 'opportunity',
      severity: 'medium',
      what:   `"${label}" has a ${fmt(r.conversionRate)}% conversion rate with only CA$${fmt(r.cost)} spent.`,
      why:    `A high conversion rate on low spend means this term could generate significantly more leads if given more budget or a higher bid.`,
      action: `Increase the bid for this term by 15–25%. Monitor CPA closely as volume grows. Consider adding as a dedicated ad group if it is a search term.`,
      data: r,
    });
  }
  return findings;
}

/**
 * Campaigns performing above the account average CPA.
 */
function outperformingCampaigns(campaigns) {
  if (campaigns.length < 2) return [];

  const avgCpa = computeAvgCpa(campaigns);
  if (!avgCpa) return [];

  const findings = [];
  for (const camp of campaigns) {
    if (!hasValue(camp.conversions) || camp.conversions < T.minConversionsWinner) continue;
    if (!hasValue(camp.cost)) continue;

    const cpa = camp.cost / camp.conversions;
    if (cpa > avgCpa * 0.75) continue; // needs to be meaningfully better

    findings.push({
      category: 'opportunity',
      severity: 'high',
      what:   `Campaign "${camp.campaign ?? 'Unknown'}" is converting at CA$${fmt(cpa)}/conv — 25%+ below the account average of CA$${fmt(avgCpa)}.`,
      why:    `This campaign is outperforming the rest of the account. Cutting its budget to fund weaker campaigns would reduce overall lead volume.`,
      action: `Protect or increase this campaign's budget first before adjusting others. This is where the account's best returns are coming from.`,
      data: camp,
    });
  }
  return findings;
}

/**
 * Campaigns limited by budget where impression share data suggests they could do more.
 */
function budgetLimitedWinners(campaigns) {
  const findings = [];
  for (const camp of campaigns) {
    if (!hasValue(camp.searchLostIsBudget)) continue;
    if (camp.searchLostIsBudget < T.highLostIsBudgetWarn * 100) continue;
    if (!hasValue(camp.conversions) || camp.conversions < 1) continue;

    const cpa = hasValue(camp.cost) && camp.conversions > 0
      ? camp.cost / camp.conversions
      : null;

    if (cpa && cpa > T.cpaPoor) continue; // don't recommend scaling a poor performer

    findings.push({
      category: 'opportunity',
      severity: 'medium',
      what:   `Campaign "${camp.campaign ?? 'Unknown'}" is losing ${fmt(camp.searchLostIsBudget)}% of impressions due to budget limits.`,
      why:    `Budget is actively preventing this campaign from showing ads to people searching for your services. You are leaving leads on the table.`,
      action: `Increase this campaign's daily budget or reallocate from non-converting campaigns. Even a 20% budget increase could meaningfully lift lead volume.`,
      data: camp,
    });
  }
  return findings;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasValue(v) { return v !== null && v !== undefined; }
function fmt(n)      { return n != null ? n.toFixed(2) : '—'; }

function computeAvgCpa(campaigns) {
  const valid = campaigns.filter(c => hasValue(c.conversions) && c.conversions > 0 && hasValue(c.cost));
  if (!valid.length) return null;
  const totalCost = valid.reduce((a, c) => a + c.cost, 0);
  const totalConv = valid.reduce((a, c) => a + c.conversions, 0);
  return totalConv > 0 ? totalCost / totalConv : null;
}
