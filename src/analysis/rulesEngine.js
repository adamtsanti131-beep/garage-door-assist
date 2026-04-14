/**
 * rulesEngine.js
 * Deterministic rules that detect issues, improvements, and wins
 * in Google Ads data for a garage door business in Vancouver, BC.
 *
 * Each rule returns an array of findings with this shape:
 *   { type, severity, title, detail, data }
 *   type:     'critical' | 'improvement' | 'working'
 *   severity: 1 (highest priority) → 3 (lowest), used for sorting within a type
 */

// Thresholds tuned for a CAD 5,000–7,000/month garage door account
const T = {
  highSpendNoConvMin:        30,   // CAD — flag spend with 0 conversions above this
  wastedPctWarning:          0.20, // 20% of total spend with no conversions → warning
  wastedPctCritical:         0.35, // 35% → critical
  highCpaGood:               80,   // CAD — CPA at or below this is strong
  highCpaBad:                200,  // CAD — CPA above this needs action
  minClicksSignificant:      10,   // Rows with fewer clicks are not yet significant
  minImpressionsSignificant: 50,
  lowCtrThreshold:           1.5,  // % — below this suggests poor relevance
  goodConvRateThreshold:     5.0,  // % — above this is strong for this industry
};

/**
 * Run all rules against the uploaded data sets.
 * @param {{ searchTerms: Object[], keywords: Object[], campaigns: Object[] }} data
 * @returns {Object[]} Sorted array of finding objects
 */
export function runRules(data) {
  const { searchTerms = [], keywords = [], campaigns = [] } = data;
  const allRows = [...searchTerms, ...keywords, ...campaigns];

  const context = buildContext(allRows, campaigns);

  const findings = [
    ...ruleHighSpendNoConversions(searchTerms, keywords),
    ...ruleWastedSpendOverall(allRows, context),
    ...ruleExpensiveWeakKeywords(keywords),
    ...ruleHighCpaKeywords(keywords, context),
    ...ruleStrongConverters(searchTerms, keywords),
    ...ruleLowCtr(keywords),
    ...ruleScalingOpportunities(searchTerms, keywords),
    ...ruleCampaignPerformance(campaigns, context),
  ];

  // Sort: critical first, then by severity number (1 = most urgent)
  const typeOrder = { critical: 0, improvement: 1, working: 2 };
  findings.sort((a, b) => {
    const typeDiff = typeOrder[a.type] - typeOrder[b.type];
    return typeDiff !== 0 ? typeDiff : a.severity - b.severity;
  });

  return findings;
}

// ── Context ───────────────────────────────────────────────────────────────────

function buildContext(allRows, campaigns) {
  // Prefer campaign-level totals if we have that data; otherwise roll up everything
  const source = campaigns.length > 0 ? campaigns : allRows;
  const totalSpend = sum(source, 'cost');
  const totalConversions = sum(source, 'conversions');
  const avgCostPerConversion = totalConversions > 0 ? totalSpend / totalConversions : 0;

  return { totalSpend, totalConversions, avgCostPerConversion };
}

// ── Rules ─────────────────────────────────────────────────────────────────────

/** Rule 1: Specific terms or keywords with notable spend and zero conversions */
function ruleHighSpendNoConversions(searchTerms, keywords) {
  const findings = [];
  const rows = [...searchTerms, ...keywords];

  for (const row of rows) {
    if (row.cost < T.highSpendNoConvMin || row.conversions !== 0 || row.clicks < 3) continue;

    const label = row.searchTerm || row.keyword || 'Unknown term';
    const isCritical = row.cost >= T.highSpendNoConvMin * 2;

    findings.push({
      type: isCritical ? 'critical' : 'improvement',
      severity: isCritical ? 1 : 2,
      title: `"${label}" — CA$${row.cost.toFixed(2)} spent, zero conversions`,
      detail: `${row.clicks} click(s), ${row.impressions} impressions. Add as negative keyword.`,
      data: row,
    });
  }

  return findings;
}

/** Rule 2: Overall wasted spend — what percentage of total budget is returning nothing */
function ruleWastedSpendOverall(allRows, context) {
  if (context.totalSpend === 0) return [];

  const wastedSpend = allRows
    .filter(r => r.conversions === 0 && r.cost > 5)
    .reduce((acc, r) => acc + r.cost, 0);

  const pct = wastedSpend / context.totalSpend;

  if (pct >= T.wastedPctCritical) {
    return [{
      type: 'critical',
      severity: 1,
      title: `${(pct * 100).toFixed(0)}% of total spend generated zero conversions`,
      detail: `CA$${wastedSpend.toFixed(2)} of CA$${context.totalSpend.toFixed(2)} total spend has no return. Build out negative keywords urgently.`,
      data: { wastedSpend, totalSpend: context.totalSpend },
    }];
  }

  if (pct >= T.wastedPctWarning) {
    return [{
      type: 'improvement',
      severity: 2,
      title: `${(pct * 100).toFixed(0)}% of spend with zero conversions — needs attention`,
      detail: `CA$${wastedSpend.toFixed(2)} spent on non-converting terms. Review your negative keyword list.`,
      data: { wastedSpend, totalSpend: context.totalSpend },
    }];
  }

  return [];
}

/** Rule 3: Keywords with 10+ clicks but zero conversions — statistical waste */
function ruleExpensiveWeakKeywords(keywords) {
  const findings = [];

  for (const kw of keywords) {
    if (kw.cost <= 20 || kw.conversions !== 0 || kw.clicks < T.minClicksSignificant) continue;

    findings.push({
      type: 'improvement',
      severity: 2,
      title: `Keyword "${kw.keyword || 'Unknown'}" — CA$${kw.cost.toFixed(2)} spent, no conversions`,
      detail: `${kw.clicks} clicks at avg CA$${(kw.avgCpc || 0).toFixed(2)}/click. Pause, reduce bid, or tighten match type.`,
      data: kw,
    });
  }

  return findings;
}

/** Rule 4: Keywords where cost per conversion is very high */
function ruleHighCpaKeywords(keywords, context) {
  const findings = [];

  for (const kw of keywords) {
    if (kw.conversions <= 0 || kw.cost <= 0) continue;

    const cpa = kw.cost / kw.conversions;
    if (cpa < T.highCpaBad) continue;

    findings.push({
      type: 'improvement',
      severity: 2,
      title: `Keyword "${kw.keyword || 'Unknown'}" — CA$${cpa.toFixed(0)}/conversion`,
      detail: `${kw.conversions} conversion(s) at high cost. Reduce bid or tighten match type.`,
      data: kw,
    });
  }

  return findings;
}

/** Rule 5: Strong converters — worth scaling or protecting */
function ruleStrongConverters(searchTerms, keywords) {
  const findings = [];
  const rows = [...searchTerms, ...keywords];

  for (const row of rows) {
    if (row.conversions < 2 || row.cost <= 0) continue;

    const cpa = row.cost / row.conversions;
    if (cpa > T.highCpaGood) continue;

    const label = row.searchTerm || row.keyword || 'Unknown';
    findings.push({
      type: 'working',
      severity: 1,
      title: `"${label}" — ${row.conversions} conversions at CA$${cpa.toFixed(0)}/conv`,
      detail: `Strong performer. Protect budget and consider adding as exact match keyword if it's a search term.`,
      data: row,
    });
  }

  return findings;
}

/** Rule 6: Low CTR — ad copy or keyword relevance issue */
function ruleLowCtr(keywords) {
  const findings = [];

  for (const kw of keywords) {
    if (
      kw.impressions < T.minImpressionsSignificant ||
      kw.ctr >= T.lowCtrThreshold ||
      kw.conversions > 0
    ) continue;

    findings.push({
      type: 'improvement',
      severity: 3,
      title: `Keyword "${kw.keyword || 'Unknown'}" — low CTR at ${kw.ctr.toFixed(2)}%`,
      detail: `${kw.impressions} impressions but poor click rate. Ad copy may not match intent, or keyword may be too broad.`,
      data: kw,
    });
  }

  return findings;
}

/** Rule 7: Scaling opportunities — low spend but good conversion rate */
function ruleScalingOpportunities(searchTerms, keywords) {
  const findings = [];
  const rows = [...searchTerms, ...keywords];

  for (const row of rows) {
    if (row.conversions < 1 || row.cost >= 50 || row.convRate < T.goodConvRateThreshold) continue;

    const label = row.searchTerm || row.keyword || 'Unknown';
    findings.push({
      type: 'working',
      severity: 2,
      title: `"${label}" — ${row.convRate.toFixed(1)}% conversion rate with low spend`,
      detail: `Only CA$${row.cost.toFixed(2)} spent but converting well. Raise bids or budget to capture more volume.`,
      data: row,
    });
  }

  return findings;
}

/** Rule 8: Campaign-level performance — compare each campaign against account average */
function ruleCampaignPerformance(campaigns, context) {
  if (campaigns.length < 2) return [];

  const findings = [];
  const avgCpa = context.avgCostPerConversion;

  for (const camp of campaigns) {
    if (camp.cost < 20) continue;

    const cpa = camp.conversions > 0 ? camp.cost / camp.conversions : null;
    const name = camp.campaign || 'Unknown campaign';

    if (cpa === null && camp.cost >= T.highSpendNoConvMin) {
      findings.push({
        type: 'critical',
        severity: 1,
        title: `Campaign "${name}" — CA$${camp.cost.toFixed(2)} spend, zero conversions`,
        detail: `Entire campaign is not converting. Review ad copy, landing page, and targeting.`,
        data: camp,
      });
    } else if (cpa !== null && avgCpa > 0 && cpa <= avgCpa * 0.7) {
      findings.push({
        type: 'working',
        severity: 1,
        title: `Campaign "${name}" — outperforming average CPA`,
        detail: `CA$${cpa.toFixed(0)}/conv vs account avg CA$${avgCpa.toFixed(0)}/conv. Protect budget here first.`,
        data: camp,
      });
    } else if (cpa !== null && avgCpa > 0 && cpa >= avgCpa * 1.5) {
      findings.push({
        type: 'improvement',
        severity: 2,
        title: `Campaign "${name}" — CPA is 50%+ above account average`,
        detail: `CA$${cpa.toFixed(0)}/conv vs account avg CA$${avgCpa.toFixed(0)}/conv. Review keywords and bids.`,
        data: camp,
      });
    }
  }

  return findings;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sum(rows, key) {
  return rows.reduce((acc, r) => acc + (parseFloat(r[key]) || 0), 0);
}
