/**
 * reportBuilder.js
 * Assembles the final report object from rules engine findings.
 * Also derives the "Top 3 Actions" summary from the highest-priority findings.
 */

/**
 * Build a complete report object.
 * @param {Object[]} findings  - Output of rulesEngine.runRules()
 * @param {{ searchTerms, keywords, campaigns }} data - Parsed data sets
 * @returns {Object} Report object
 */
export function buildReport(findings, data) {
  const criticalIssues = findings.filter(f => f.type === 'critical');
  const improvements   = findings.filter(f => f.type === 'improvement');
  const whatsWorking   = findings.filter(f => f.type === 'working');

  return {
    timestamp: new Date().toISOString(),
    meta: {
      searchTermCount: data.searchTerms?.length || 0,
      keywordCount:    data.keywords?.length    || 0,
      campaignCount:   data.campaigns?.length   || 0,
    },
    criticalIssues,
    improvements,
    whatsWorking,
    topActions: deriveTopActions(criticalIssues, improvements, whatsWorking),
  };
}

// ── Top Actions ───────────────────────────────────────────────────────────────

/**
 * Pick the 3 most important actions from findings.
 * Logic: one from critical, one from improvements, one from working.
 * Fill with sensible generic defaults if a category is empty.
 */
function deriveTopActions(critical, improvements, working) {
  const actions = [];

  if (critical.length > 0) {
    actions.push({
      priority: 1,
      action: toActionText(critical[0]),
      reason: critical[0].title,
    });
  }

  if (improvements.length > 0) {
    actions.push({
      priority: 2,
      action: toActionText(improvements[0]),
      reason: improvements[0].title,
    });
  }

  if (working.length > 0) {
    actions.push({
      priority: 3,
      action: toActionText(working[0]),
      reason: working[0].title,
    });
  }

  // Fill remaining slots with practical defaults
  const defaults = [
    {
      priority: 1,
      action: 'Review your Search Terms report and add irrelevant queries as negative keywords.',
      reason: 'Regular negative keyword hygiene reduces wasted spend.',
    },
    {
      priority: 2,
      action: 'Check keyword Quality Scores — anything below 5 is costing you more per click.',
      reason: 'Low Quality Scores raise CPC and reduce ad rank.',
    },
    {
      priority: 3,
      action: 'Confirm your best-performing campaigns are not hitting budget caps mid-day.',
      reason: 'Budget limits on converting campaigns cap your lead volume.',
    },
  ];

  while (actions.length < 3) {
    actions.push(defaults[actions.length]);
  }

  return actions.slice(0, 3);
}

/**
 * Convert a finding into a short imperative action phrase.
 */
function toActionText(finding) {
  const t = finding.title.toLowerCase();
  const term = extractQuotedTerm(finding.title);

  if (t.includes('zero conversion') || t.includes('no conversion')) {
    return `Pause and add as negative keyword: "${term}"`;
  }
  if (t.includes('/conversion') || t.includes('cpa')) {
    return `Reduce bid or pause: "${term}" — cost per conversion is too high`;
  }
  if (t.includes('outperform') || t.includes('strong')) {
    return `Protect budget for: "${term}" — it is your best performer`;
  }
  if (t.includes('conv. rate') || t.includes('scaling')) {
    return `Increase bids to capture more volume: "${term}"`;
  }
  if (t.includes('ctr')) {
    return `Rewrite ad copy to better match intent for: "${term}"`;
  }
  if (t.includes('campaign')) {
    return `Review campaign "${term}" — check ad copy, landing page, and targeting`;
  }

  return finding.title;
}

/** Pull the first quoted string out of a title, or return the full title. */
function extractQuotedTerm(title) {
  const match = title.match(/"([^"]+)"/);
  return match ? match[1] : title;
}
