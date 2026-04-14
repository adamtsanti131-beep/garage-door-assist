/**
 * waste.js
 * Rules that detect budget being spent with no meaningful return.
 */

import { THRESHOLDS as T } from '../thresholds.js';

/**
 * @param {Object} data — { campaign[], adGroup[], searchTerm[], keyword[], ... }
 * @returns {Finding[]}
 */
export function wasteRules(data) {
  const findings = [];
  const { searchTerms = [], keywords = [], campaigns = [], adGroups = [] } = data;

  findings.push(...highSpendNoConversions([...searchTerms, ...keywords]));
  findings.push(...overallWastedSpendPct([...campaigns, ...adGroups, ...searchTerms, ...keywords]));
  findings.push(...expensiveKeywordsNoReturn(keywords));
  findings.push(...nonConvertingAdGroups(adGroups));

  return findings;
}

// ── Individual rules ──────────────────────────────────────────────────────────

/**
 * Terms or keywords with notable spend and zero conversions.
 */
function highSpendNoConversions(rows) {
  const findings = [];
  for (const r of rows) {
    if (!hasValue(r.cost) || !hasValue(r.clicks)) continue;
    if (r.cost < T.minSpendToFlag || r.clicks < 3) continue;
    if (r.conversions !== 0 && r.conversions !== null) continue;

    const label = r.searchTerm ?? r.keyword ?? 'Unknown';
    const severity = r.cost >= T.minSpendToFlag * 3 ? 'high' : 'medium';

    findings.push({
      category: 'waste',
      severity,
      what:   `"${label}" spent CA$${fmt(r.cost)} with zero conversions (${r.clicks} clicks).`,
      why:    `Every dollar spent here produced no leads. At CA$${fmt(r.cost)} this is money that could go to converting terms.`,
      action: r.searchTerm
        ? `Add "${label}" as a negative keyword. If part of it is relevant, add the relevant fragment as an exact match keyword.`
        : `Pause this keyword. Review matched search terms first to check if any were relevant.`,
      data: r,
    });
  }
  return findings;
}

/**
 * What percentage of total spend has zero conversions?
 */
function overallWastedSpendPct(rows) {
  const totalSpend  = sumNN(rows, 'cost');
  if (!totalSpend || totalSpend === 0) return [];

  const wastedSpend = rows
    .filter(r => r.conversions === 0 && hasValue(r.cost) && r.cost > 5)
    .reduce((a, r) => a + r.cost, 0);

  const pct = wastedSpend / totalSpend;

  if (pct >= T.wastedSpendCritPct) {
    return [{
      category: 'waste',
      severity: 'high',
      what:   `${pct100(pct)}% of analyzed spend (CA$${fmt(wastedSpend)}) returned zero conversions.`,
      why:    `Over a third of your budget is producing no leads. This is the highest-priority issue in the account.`,
      action: `Run a full search terms audit. Add all irrelevant queries as negatives immediately. Review broad match keywords.`,
      data:   { wastedSpend, totalSpend },
    }];
  }

  if (pct >= T.wastedSpendWarnPct) {
    return [{
      category: 'waste',
      severity: 'medium',
      what:   `${pct100(pct)}% of analyzed spend (CA$${fmt(wastedSpend)}) returned zero conversions.`,
      why:    `A significant portion of budget is not converting. Left unchecked this grows over time.`,
      action: `Review your Search Terms report and add negatives for irrelevant queries. Check broad match keywords for off-topic matching.`,
      data:   { wastedSpend, totalSpend },
    }];
  }

  return [];
}

/**
 * Keywords with 10+ clicks and spend > threshold but still no conversions.
 */
function expensiveKeywordsNoReturn(keywords) {
  const findings = [];
  for (const kw of keywords) {
    if (!hasValue(kw.cost) || !hasValue(kw.clicks)) continue;
    if (kw.cost < T.minSpendToFlag || kw.clicks < T.minClicksToJudge) continue;
    if (kw.conversions !== 0 && kw.conversions !== null) continue;

    findings.push({
      category: 'waste',
      severity: 'medium',
      what:   `Keyword "${kw.keyword ?? 'Unknown'}" [${kw.matchType ?? '?'}] — ${kw.clicks} clicks, CA$${fmt(kw.cost)} spent, 0 conversions.`,
      why:    `With ${kw.clicks} clicks and no leads this keyword has proven it is not converting under current settings. Avg CPC was CA$${fmt(kw.avgCpc)}.`,
      action: `Pause or reduce bid. If the match type is broad or phrase, try switching to exact match to reduce irrelevant matching.`,
      data:   kw,
    });
  }
  return findings;
}

/**
 * Ad groups spending significantly with zero conversions.
 */
function nonConvertingAdGroups(adGroups) {
  const findings = [];
  for (const ag of adGroups) {
    if (!hasValue(ag.cost) || ag.cost < T.minSpendToFlag * 2) continue;
    if (ag.conversions !== 0 && ag.conversions !== null) continue;

    findings.push({
      category: 'waste',
      severity: 'medium',
      what:   `Ad group "${ag.adGroup ?? 'Unknown'}" (campaign: ${ag.campaign ?? '?'}) spent CA$${fmt(ag.cost)} with no conversions.`,
      why:    `The entire ad group has no recorded conversions. Either the keywords, ads, or landing page in this group are not matching buyer intent.`,
      action: `Review the keywords and ads inside this ad group. Check the landing page experience. Consider pausing low-quality keywords first.`,
      data:   ag,
    });
  }
  return findings;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function hasValue(v)     { return v !== null && v !== undefined; }
function fmt(n)          { return n != null ? n.toFixed(2) : '—'; }
function pct100(n)       { return (n * 100).toFixed(0); }
function sumNN(rows, k)  { return rows.reduce((a, r) => a + (r[k] ?? 0), 0); }
