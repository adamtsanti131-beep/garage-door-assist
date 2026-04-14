/**
 * measurementRisks.js
 * Rules that detect data quality and conversion tracking issues.
 * These don't mean money is wasted — they mean the data can't be trusted.
 */

import { THRESHOLDS as T } from '../thresholds.js';

export function measurementRiskRules(data) {
  const findings = [];
  const { searchTerms = [], keywords = [], campaigns = [], adGroups = [] } = data;
  const allRows = [...campaigns, ...adGroups, ...searchTerms, ...keywords];

  findings.push(...manyClicksNoConversions([...searchTerms, ...keywords]));
  findings.push(...conversionExceedsClicks(allRows));
  findings.push(...zeroConversionsWholeAccount(allRows));
  findings.push(...missingConversionData(campaigns));

  return findings;
}

// ── Rules ─────────────────────────────────────────────────────────────────────

/**
 * Terms or keywords with many clicks but zero conversions — possible tracking gap.
 * Different from waste rules: here the concern is measurement, not just poor performance.
 */
function manyClicksNoConversions(rows) {
  const findings = [];
  for (const r of rows) {
    if (!hasValue(r.clicks) || r.clicks < T.highClicksNoConvLimit) continue;
    if (r.conversions !== 0 && r.conversions !== null) continue;

    const label = r.searchTerm ?? r.keyword ?? 'Unknown';
    findings.push({
      category: 'measurementRisk',
      severity: 'medium',
      what:   `"${label}" received ${r.clicks} clicks with zero conversions recorded.`,
      why:    `${r.clicks} clicks with no conversions is unusual for a high-intent service like garage door repair. This may indicate a tracking gap rather than poor performance.`,
      action: `Test the conversion path: call the phone number on the landing page, submit the contact form. Verify conversions fire correctly in Google Tag Manager or Google Ads.`,
      data: r,
    });
  }
  return findings;
}

/**
 * More conversions than clicks recorded — almost always a tracking misconfiguration.
 */
function conversionExceedsClicks(rows) {
  const findings = [];
  for (const r of rows) {
    if (!hasValue(r.clicks) || !hasValue(r.conversions)) continue;
    if (r.clicks <= 0 || r.conversions <= r.clicks) continue;

    const label = r.campaign ?? r.adGroup ?? r.keyword ?? r.searchTerm ?? 'Unknown';
    findings.push({
      category: 'measurementRisk',
      severity: 'high',
      what:   `"${label}" shows ${r.conversions} conversions from only ${r.clicks} clicks — more conversions than clicks.`,
      why:    `This is mathematically impossible for standard conversion tracking. It almost always means conversions are being double-counted or the wrong conversion action is selected.`,
      action: `Audit your conversion actions in Google Ads. Check for duplicate conversion tags or incorrectly configured cross-device attribution. Fix before trusting any CPA data.`,
      data: r,
    });
  }
  return findings;
}

/**
 * Entire account shows zero conversions — most likely a tracking setup issue.
 */
function zeroConversionsWholeAccount(rows) {
  if (!rows.length) return [];

  const rowsWithSpend = rows.filter(r => hasValue(r.cost) && r.cost > 10);
  if (!rowsWithSpend.length) return [];

  const totalConv = rowsWithSpend.reduce((a, r) => a + (r.conversions ?? 0), 0);
  if (totalConv > 0) return [];

  const totalSpend = rowsWithSpend.reduce((a, r) => a + (r.cost ?? 0), 0);

  return [{
    category: 'measurementRisk',
    severity: 'high',
    what:   `Zero conversions recorded across all uploaded data. Total analyzed spend: CA$${fmt(totalSpend)}.`,
    why:    `It is highly unlikely a garage door business in Vancouver receives zero calls or form fills from CA$${fmt(totalSpend)} in ad spend. This strongly suggests conversion tracking is not set up or is broken.`,
    action: `Check Google Ads → Tools → Conversions. Verify at least one conversion action is active and tracking correctly. Test by submitting a form or calling the tracking number.`,
    data: { totalSpend, totalConv },
  }];
}

/**
 * Campaigns where conversion data is entirely absent (null) vs. recorded as zero.
 * Null means the column wasn't in the export — different problem from 0 conversions.
 */
function missingConversionData(campaigns) {
  if (!campaigns.length) return [];

  const missingAll = campaigns.every(c => c.conversions === null);
  if (!missingAll) return [];

  return [{
    category: 'measurementRisk',
    severity: 'medium',
    what:   `The Campaign report does not include a Conversions column.`,
    why:    `Without conversion data the analysis cannot identify waste or calculate CPA. This limits the usefulness of every other finding.`,
    action: `Re-export the Campaign report from Google Ads and include the "Conversions" and "Cost / conv." columns. Check your column settings before downloading.`,
    data: {},
  }];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasValue(v) { return v !== null && v !== undefined; }
function fmt(n)      { return n != null ? n.toFixed(2) : '—'; }
