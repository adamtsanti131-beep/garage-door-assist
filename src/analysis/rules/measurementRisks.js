/**
 * measurementRisks.js
 * Rules that detect data quality and tracking issues.
 * These don't mean wasted spend, but rather: the data can't be trusted for decisions.
 */

import { THRESHOLDS as T } from '../thresholds.js';

export function measurementRiskRules(data) {
  const findings = [];
  const {
    searchTerms = [],
    keywords = [],
    campaigns = [],
    adGroups = [],
    ads = [],
    devices = [],
    locations = [],
  } = data;
  const allRows = [...campaigns, ...adGroups, ...searchTerms, ...keywords];

  findings.push(...manyClicksNoLeads([...searchTerms, ...keywords]));
  findings.push(...leadsExceedClicks(allRows));
  findings.push(...zeroLeadsWholeAccount(allRows));
  findings.push(...missingLeadData(campaigns));
  findings.push(...missingSegmentCoverage(ads, devices, locations));

  return findings;
}

// ── Rules ─────────────────────────────────────────────────────────────────────

/**
 * Search terms or keywords with many clicks but zero leads — suggests tracking gap.
 */
function manyClicksNoLeads(rows) {
  const findings = [];
  for (const r of rows) {
    if (!hasValue(r.clicks) || r.clicks < T.minClicksNoLeadsForTracking) continue;
    if (r.conversions !== 0 && r.conversions !== null) continue;

    const label = r.searchTerm ?? r.keyword ?? 'Unknown term';
    findings.push({
      category: 'measurementRisk',
      severity: 'medium',
      what: `"${label}" has ${r.clicks} clicks and zero conversions.`,
      why: 'At this volume, either tracking is incomplete or traffic quality is materially off-target.',
      action: 'Validate conversion tracking and attribution setup first, then review intent and landing-page fit.',
      data: r,
      signal: 'many-clicks-no-leads',
    });
  }
  return findings;
}

/**
 * More leads than clicks recorded — almost always a tracking or config error.
 */
function leadsExceedClicks(rows) {
  const findings = [];
  for (const r of rows) {
    if (!hasValue(r.clicks) || !hasValue(r.conversions)) continue;
    if (r.clicks <= 0 || r.conversions <= r.clicks) continue;

    const label = r.campaign ?? r.adGroup ?? r.keyword ?? r.searchTerm ?? 'Unknown entity';
    findings.push({
      category: 'measurementRisk',
      severity: 'high',
      what: `"${label}" shows ${r.conversions} conversions from only ${r.clicks} clicks.`,
      why: 'More conversions than clicks is usually caused by duplicate counting or incorrect conversion definitions.',
      action: 'Audit conversion actions, dedup settings, and tag firing logic before using this data for optimization.',
      data: r,
      signal: 'conversions-exceed-clicks',
    });
  }
  return findings;
}

/**
 * Entire account shows zero leads — most likely a tracking setup issue.
 */
function zeroLeadsWholeAccount(rows) {
  if (!rows.length) return [];

  const rowsWithSpend = rows.filter(r => hasValue(r.cost) && r.cost > 10);
  if (!rowsWithSpend.length) return [];

  const totalConvs = rowsWithSpend.reduce((a, r) => a + (r.conversions ?? 0), 0);
  if (totalConvs > 0) return [];

  const totalSpend = rowsWithSpend.reduce((a, r) => a + (r.cost ?? 0), 0);

  return [{
    category: 'measurementRisk',
    severity: 'high',
    what: `No conversions are recorded across uploaded data despite CA$${fmt(totalSpend)} spend.`,
    why: 'This usually indicates a measurement problem, not pure performance reality.',
    action: 'Audit conversion actions, primary/secondary settings, and tag implementation in Google Ads and GTM.',
    data: { totalSpend, totalConvs },
    signal: 'account-zero-conversions',
  }];
}

/**
 * Campaign report has no leads column — limits analysis severely.
 */
function missingLeadData(campaigns) {
  if (!campaigns.length) return [];

  const missingAll = campaigns.every(c => c.conversions === null);
  if (!missingAll) return [];

  return [{
    category: 'measurementRisk',
    severity: 'medium',
    what: 'Campaign report has no conversion values.',
    why: 'Without conversions, CPA and efficiency findings are severely limited.',
    action: 'Re-export campaign data with Conversions and Cost / conv. columns included.',
    data: {},
    signal: 'missing-campaign-conversions',
  }];
}

function missingSegmentCoverage(ads, devices, locations) {
  const missing = [];
  if (!ads.length) missing.push('Ads');
  if (!devices.length) missing.push('Devices');
  if (!locations.length) missing.push('Location');

  if (missing.length === 0 || missing.length === 3) return [];

  return [{
    category: 'measurementRisk',
    severity: 'low',
    what: `Some optional segment datasets are missing: ${missing.join(', ')}.`,
    why: 'Partial segment coverage reduces confidence in channel-specific recommendations.',
    action: 'Upload all optional segment reports when available for fuller diagnostics.',
    data: { missingSegments: missing },
    signal: 'partial-segment-coverage',
  }];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasValue(v) { return v !== null && v !== undefined; }
function fmt(n) { return n != null ? n.toFixed(2) : '—'; }
