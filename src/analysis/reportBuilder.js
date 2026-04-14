/**
 * reportBuilder.js
 * Assembles the final report from rules engine findings.
 * Adds a summary section with account-level metrics.
 */

/**
 * @param {Finding[]} findings  — from rulesEngine.runRules()
 * @param {DataSets}  data      — normalized data sets
 * @returns {Report}
 */
export function buildReport(findings, data) {
  const allRows = [
    ...(data.campaigns   ?? []),
    ...(data.adGroups    ?? []),
    ...(data.searchTerms ?? []),
    ...(data.keywords    ?? []),
  ];

  return {
    timestamp:        new Date().toISOString(),
    summary:          buildSummary(findings, allRows, data.campaigns ?? []),
    waste:            findings.filter(f => f.category === 'waste'),
    opportunities:    findings.filter(f => f.category === 'opportunity'),
    controlRisks:     findings.filter(f => f.category === 'controlRisk'),
    measurementRisks: findings.filter(f => f.category === 'measurementRisk'),
    topActions:       deriveTopActions(findings),
  };
}

// ── Summary ───────────────────────────────────────────────────────────────────

function buildSummary(findings, allRows, campaigns) {
  // Prefer campaign-level totals; fall back to all rows
  const source = campaigns.length > 0 ? campaigns : allRows;

  const totalSpend       = sumNN(source, 'cost');
  const totalConversions = sumNN(source, 'conversions');
  const avgCpa           = totalConversions > 0 ? totalSpend / totalConversions : null;

  const highCount = findings.filter(f => f.severity === 'high').length;
  const bestPerformer = findBestPerformer([...allRows]);

  return {
    totalSpend:       totalSpend   > 0   ? totalSpend       : null,
    totalConversions: totalConversions > 0 ? totalConversions : null,
    avgCpa,
    highSeverityCount: highCount,
    bestPerformer,
  };
}

/**
 * Find the single best-performing row (lowest CPA with at least 2 conversions).
 */
function findBestPerformer(rows) {
  const candidates = rows.filter(r =>
    hasValue(r.conversions) && r.conversions >= 2 &&
    hasValue(r.cost) && r.cost > 0
  );
  if (!candidates.length) return null;

  candidates.sort((a, b) => (a.cost / a.conversions) - (b.cost / b.conversions));
  const best = candidates[0];
  const label = best.searchTerm ?? best.keyword ?? best.campaign ?? best.adGroup ?? 'Unknown';
  return {
    label,
    cpa:         best.cost / best.conversions,
    conversions: best.conversions,
    cost:        best.cost,
  };
}

// ── Top Actions ───────────────────────────────────────────────────────────────

/**
 * Pick the 3 most important actions from findings.
 * Priority: high severity first, then by category order.
 */
function deriveTopActions(findings) {
  const catPriority = { measurementRisk: 0, waste: 1, controlRisk: 2, opportunity: 3 };
  const sevPriority = { high: 0, medium: 1, low: 2 };

  const sorted = [...findings].sort((a, b) => {
    const s = sevPriority[a.severity] - sevPriority[b.severity];
    if (s !== 0) return s;
    return (catPriority[a.category] ?? 9) - (catPriority[b.category] ?? 9);
  });

  const top = sorted.slice(0, 3);

  // Fill with defaults if fewer than 3 findings
  const defaults = [
    { action: 'Review your Search Terms report and add irrelevant queries as negative keywords.',      reason: 'Negative keyword hygiene is the highest-ROI maintenance task in a local PPC account.' },
    { action: 'Check that conversion tracking is firing correctly for calls and form submissions.',    reason: 'Without accurate conversion data, optimisation decisions are based on incomplete information.' },
    { action: 'Ensure your best-converting campaigns are not hitting their daily budget cap early.',   reason: 'Budget limits on converting campaigns directly cap lead volume.' },
  ];

  const actions = top.map((f, i) => ({
    priority: i + 1,
    action:   f.action,
    reason:   f.what,
    severity: f.severity,
  }));

  while (actions.length < 3) {
    const d = defaults[actions.length];
    actions.push({ priority: actions.length + 1, action: d.action, reason: d.reason, severity: 'low' });
  }

  return actions;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasValue(v)    { return v !== null && v !== undefined; }
function sumNN(rows, k) { return rows.reduce((a, r) => a + (r[k] ?? 0), 0); }
