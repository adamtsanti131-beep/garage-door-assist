/**
 * opportunities.js
 * Rules that identify strong performers and scaling opportunities.
 * Focus: lead generation efficiency, growth potential.
 */

import { THRESHOLDS as T } from '../thresholds.js';

export function opportunityRules(data) {
  const findings = [];
  const {
    searchTerms = [],
    keywords = [],
    campaigns = [],
    devices = [],
    locations = [],
  } = data;

  findings.push(...strongLeaders([...searchTerms, ...keywords]));
  findings.push(...scalingCandidates([...searchTerms, ...keywords]));
  findings.push(...outperformingCampaigns(campaigns));
  findings.push(...budgetLimitedWinners(campaigns));
  findings.push(...highIntentDevices(devices));
  findings.push(...highIntentLocations(locations));

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

    const label = r.searchTerm ?? r.keyword ?? 'Unknown term';
    const isExcellent = cpl <= T.cplExcellent;
    const clicks = r.clicks ?? 0;

    // Excellent CPL: Always opportunity
    if (isExcellent) {
      findings.push({
        category: 'opportunity',
        severity: 'high',
        what: `"${label}" generated ${r.conversions} conversions at CA$${fmt(cpl)} CPA (CA$${fmt(r.cost)} spend).`,
        why: 'This is a high-efficiency winner with enough data to protect and scale.',
        action: r.searchTerm
          ? `Promote this query to an exact-match keyword and increase bid carefully while monitoring CPA.`
          : 'Protect budget share and test measured bid increases to scale volume.',
        data: r,
        signal: 'strong-leader',
      });
    }
    // Good CPL with meaningful volume: Opportunity to scale
    else if (clicks >= 10) {
      findings.push({
        category: 'opportunity',
        severity: 'medium',
        what: `"${label}" generated ${r.conversions} conversions at CA$${fmt(cpl)} CPA (CA$${fmt(r.cost)} spend).`,
        why: 'Performance is efficient with usable volume, making it a practical scaling candidate.',
        action: r.searchTerm
          ? 'Increase bid by 15-25% in controlled steps and track CPA stability.'
          : 'Scale bids gradually and monitor conversion efficiency each cycle.',
        data: r,
        signal: 'strong-leader',
      });
    }
    // Good CPL but low volume: Just good performer, don't push scaling
    else {
      findings.push({
        category: 'opportunity',
        severity: 'low',
        what: `"${label}" generated ${r.conversions} conversions at CA$${fmt(cpl)} CPA.`,
        why: 'Efficiency is good but sample size is still limited.',
        action: r.searchTerm
          ? 'Keep this term protected and convert it to exact match if not already isolated.'
          : 'Maintain current support and reconsider scaling when volume increases.',
        data: r,
        signal: 'strong-leader',
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

    const label = r.searchTerm ?? r.keyword ?? 'Unknown term';
    findings.push({
      category: 'opportunity',
      severity: 'medium',
      what: `"${label}" has a ${fmt(r.conversionRate)}% conversion rate with only CA$${fmt(r.cost)} spend.`,
      why: 'High conversion rate at low spend suggests untapped volume potential.',
      action: 'Increase bids by 15-20% and monitor CPA while volume expands.',
      data: r,
      signal: 'scale-candidate',
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
      what: `Campaign "${camp.campaign ?? 'Unknown campaign'}" is at CA$${fmt(cpl)} CPA, at least 25% better than account average CA$${fmt(avgCpl)}.`,
      why: 'Budget shifted here is likely to increase conversions more efficiently than average.',
      action: 'Protect this campaign budget first and reallocate from weaker campaigns where needed.',
      data: camp,
      signal: 'outperforming-campaign',
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
      what: `Campaign "${camp.campaign ?? 'Unknown campaign'}" is losing ${fmt(camp.searchLostIsBudget)}% search impression share to budget.`,
      why: 'The campaign converts but is budget constrained, so lead volume is likely capped.',
      action: 'Increase daily budget in controlled increments and confirm CPA remains acceptable.',
      data: camp,
      signal: 'budget-limited-winner',
    });
  }
  return findings;
}

function highIntentDevices(devices) {
  const findings = [];
  for (const row of devices) {
    if (!hasValue(row.device) || !hasValue(row.conversions) || !hasValue(row.cost)) continue;
    if (row.conversions < T.minLeadsForScaling) continue;

    const cpl = row.cost / row.conversions;
    if (cpl > T.cplGood) continue;

    findings.push({
      category: 'opportunity',
      severity: cpl <= T.cplExcellent ? 'high' : 'medium',
      what: `Device segment "${row.device}" produced ${row.conversions} conversions at CA$${fmt(cpl)} CPA.`,
      why: 'Device-level efficiency indicates where additional bid support can produce incremental leads.',
      action: `Apply positive bid adjustments for ${row.device} while monitoring conversion quality.`,
      data: row,
      signal: 'high-intent-device',
    });
  }
  return findings;
}

function highIntentLocations(locations) {
  const findings = [];
  for (const row of locations) {
    if (!hasValue(row.location) || !hasValue(row.conversions) || !hasValue(row.cost)) continue;
    if (row.conversions < T.minLeadsForScaling) continue;

    const cpl = row.cost / row.conversions;
    if (cpl > T.cplGood) continue;

    findings.push({
      category: 'opportunity',
      severity: cpl <= T.cplExcellent ? 'high' : 'medium',
      what: `Location segment "${row.location}" produced ${row.conversions} conversions at CA$${fmt(cpl)} CPA.`,
      why: 'Location-level performance supports targeted geo bid or budget expansion.',
      action: `Prioritize high-efficiency location "${row.location}" with controlled bid or budget increases.`,
      data: row,
      signal: 'high-intent-location',
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
