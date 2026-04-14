/**
 * rulesEngine.js
 * Orchestrates all rule groups and returns a flat sorted findings array.
 *
 * Input:  { campaign[], adGroup[], searchTerm[], keyword[], ad[], device[], location[] }
 * Output: Finding[]  sorted by severity (high → medium → low) within each category
 */

import { wasteRules }           from './rules/waste.js';
import { opportunityRules }     from './rules/opportunities.js';
import { controlRiskRules }     from './rules/controlRisks.js';
import { measurementRiskRules } from './rules/measurementRisks.js';

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

/**
 * Run all rules against the normalized data sets.
 * @param {DataSets} data
 * @returns {Finding[]}
 */
export function runRules(data) {
  const findings = [
    ...measurementRiskRules(data),  // measurement first — if data is bad, everything else is suspect
    ...wasteRules(data),
    ...controlRiskRules(data),
    ...opportunityRules(data),
  ];

  // Sort within each category by severity, then deduplicate near-identical findings
  findings.sort((a, b) => {
    const catOrder = { measurementRisk: 0, waste: 1, controlRisk: 2, opportunity: 3 };
    const catDiff = (catOrder[a.category] ?? 9) - (catOrder[b.category] ?? 9);
    if (catDiff !== 0) return catDiff;
    return (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);
  });

  return deduplicate(findings);
}

// ── Deduplication ─────────────────────────────────────────────────────────────

/**
 * Remove duplicate findings without collapsing distinct recommendations.
 * We dedupe only when category + signal + normalized subject + normalized action
 * all match.
 */
function deduplicate(findings) {
  const seen = new Set();

  return findings.filter(f => {
    const key = [
      f.category ?? 'unknown',
      f.signal ?? 'generic',
      extractSubject(f.what),
      normalizeText(f.action),
    ].join('::');

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractSubject(what) {
  const quoted = what?.match(/"([^"]+)"/);
  if (quoted) return normalizeText(quoted[1]);

  // Fallback to short normalized prefix if no explicit subject is quoted.
  return normalizeText((what ?? '').slice(0, 80));
}

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/ca\$\d+(\.\d+)?/g, 'amount')
    .replace(/\d+(\.\d+)?%/g, 'pct')
    .replace(/\d+(\.\d+)?/g, 'num')
    .replace(/\s+/g, ' ')
    .trim();
}
