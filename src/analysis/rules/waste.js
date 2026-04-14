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
 * Search terms or keywords with meaningful spend or clicks but zero leads.
 * Waste flagging logic:
 * - cost >= 75 CAD, OR
 * - clicks >= 15, OR
 * - (cost >= 50 AND clicks >= 15)
 */
function zeroLeadsHighSpend(rows) {
  const findings = [];
  for (const r of rows) {
    if (!hasValue(r.cost) || !hasValue(r.clicks)) continue;
    if (r.conversions !== 0 && r.conversions !== null) continue; // only zero leads

    // Check waste threshold
    const meetsWasteThreshold =
      r.cost >= T.minSpendForWaste ||
      r.clicks >= T.minClicksForWaste ||
      (r.cost >= T.minSpendWithClicksGate && r.clicks >= T.minClicksForWaste);

    if (!meetsWasteThreshold) continue;

    const label = r.searchTerm ?? r.keyword ?? 'Unknown term';
    const severity = r.cost >= T.minSpendForWaste ? 'high' : 'medium';

    findings.push({
      category: 'waste',
      severity,
      what: `"${label}" spent CA$${fmt(r.cost)} with ${r.clicks} clicks and zero conversions.`,
      why: 'The volume is high enough to treat this as reliable waste, not a random fluctuation.',
      action: r.searchTerm
        ? `Add "${label}" as a negative keyword, or negate only the irrelevant fragment if part of the term is still useful.`
        : 'Inspect related search terms and add non-relevant queries as negatives before allocating more budget.',
      data: r,
      signal: 'zero-leads-term',
    });
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
      what: `${pct100(pct)}% of spend from ${labelForSource(sourceKey)} generated zero conversions (CA$${fmt(wastedSpend)} of CA$${fmt(totalSpend)}).`,
      why: 'A large share of spend is producing no measurable outcome, which materially weakens account efficiency.',
      action: 'Run a waste clean-up pass: tighten match types, add negatives from search terms, and reduce bids on non-converting entities.',
      data: { wastedSpend, totalSpend, source: sourceKey },
      signal: 'wasted-spend-share',
    }];
  }

  if (pct >= T.wastedSpendWarnPct) {
    return [{
      category: 'waste',
      severity: 'medium',
      what: `${pct100(pct)}% of spend from ${labelForSource(sourceKey)} generated zero conversions (CA$${fmt(wastedSpend)} of CA$${fmt(totalSpend)}).`,
      why: 'The account is leaking budget in areas that currently do not convert.',
      action: 'Review non-converting entities and tighten targeting before scaling.',
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
    if (kw.conversions !== 0 && kw.conversions !== null) continue;
    if (kw.clicks < T.minClicksForConfidentJudgment) continue; // need 15+ clicks for strong judgment

    findings.push({
      category: 'waste',
      severity: 'medium',
      what: `Keyword "${kw.keyword ?? 'Unknown keyword'}" (${kw.matchType ?? 'unknown match type'}) has ${kw.clicks} clicks and CA$${fmt(kw.cost)} spend with zero conversions.`,
      why: 'At this click volume, the keyword is a strong waste candidate.',
      action: 'Lower bid by 20%, validate intent and landing-page fit, then pause if no improvement after a review cycle.',
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
    if (!hasValue(ag.cost)) continue;
    if (ag.cost < T.minSpendForWaste * 2) continue; // need meaningful spend (2x threshold)
    if (ag.conversions !== 0 && ag.conversions !== null) continue;

    findings.push({
      category: 'waste',
      severity: 'medium',
      what: `Ad group "${ag.adGroup ?? 'Unknown ad group'}" in campaign "${ag.campaign ?? 'Unknown campaign'}" spent CA$${fmt(ag.cost)} with zero conversions.`,
      why: 'The issue appears structural at ad-group scope, not isolated to a single term.',
      action: 'Audit term quality, ad relevance, and landing page alignment; pause if correction attempts fail.',
      data: ag,
      signal: 'non-converting-adgroup',
    });
  }
  return findings;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasValue(v) { return v !== null && v !== undefined; }
function fmt(n) { return n != null ? n.toFixed(2) : '—'; }
function pct100(n) { return (n * 100).toFixed(0); }

function labelForSource(sourceKey) {
  const labels = {
    campaigns: 'campaign-level data',
    adGroups: 'ad-group-level data',
    keywords: 'keyword-level data',
    searchTerms: 'search-term-level data',
    ads: 'ad-level data',
    devices: 'device-level data',
    locations: 'location-level data',
  };
  return labels[sourceKey] ?? 'the selected dataset';
}
