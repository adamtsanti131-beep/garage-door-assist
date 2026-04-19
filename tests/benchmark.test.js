/**
 * benchmark.test.js
 * Regression safety tests for the report classification, parsing, rules, and rendering pipeline.
 *
 * Each test verifies ONE of three things:
 *   1. Classification  — correct report type detected from headers
 *   2. Rules gate      — correct findings emitted (no false positives, correct suppression)
 *   3. Signal gate     — weak signals never reach the user-facing layer
 *
 * Run with: npm test
 */

import { describe, it, expect } from 'vitest';
import { detectReportType, normalizeRows } from '../src/parser/normalizer.js';
import { routeReport } from '../src/parser/reportRouter.js';
import { wasteRules } from '../src/analysis/rules/waste.js';
import { measurementRiskRules } from '../src/analysis/rules/measurementRisks.js';
import { controlRiskRules } from '../src/analysis/rules/controlRisks.js';
import { buildReport } from '../src/analysis/reportBuilder.js';
import { REPORT_TYPES } from '../src/parser/schemas.js';
import { THRESHOLDS as T } from '../src/analysis/thresholds.js';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function makeRow(overrides = {}) {
  return {
    campaign: 'Test Campaign',
    adGroup: null,
    searchTerm: null,
    keyword: null,
    matchType: null,
    device: null,
    location: null,
    finalUrl: null,
    adDescription: null,
    adStatus: null,
    clicks: null,
    impressions: null,
    cost: null,
    conversions: null,
    ctr: null,
    avgCpc: null,
    conversionRate: null,
    costPerConversion: null,
    searchImprShare: null,
    searchLostIsRank: null,
    searchLostIsBudget: null,
    qualityScore: null,
    reportType: 'campaign',
    ...overrides,
  };
}

/** Minimal valid CSV text for a given report type */
function campaignCsv(rows = []) {
  const header = 'Campaign,Clicks,Impressions,Cost,Conversions';
  const body = rows.map(r =>
    `${r.campaign ?? 'Test'},${r.clicks ?? 0},${r.impressions ?? 0},${r.cost ?? 0},${r.conversions ?? 0}`
  ).join('\n');
  return [header, body].join('\n');
}

function adGroupCsv(rows = []) {
  const header = 'Campaign,Ad group,Clicks,Impressions,Cost,Conversions';
  const body = rows.map(r =>
    `${r.campaign ?? 'Test'},${r.adGroup ?? 'Test AG'},${r.clicks ?? 0},${r.impressions ?? 0},${r.cost ?? 0},${r.conversions ?? 0}`
  ).join('\n');
  return [header, body].join('\n');
}

function searchTermsCsv(rows = []) {
  const header = 'Search term,Campaign,Ad group,Clicks,Impressions,Cost,Conversions';
  const body = rows.map(r =>
    `${r.searchTerm ?? 'test query'},${r.campaign ?? 'Test'},${r.adGroup ?? 'AG'},${r.clicks ?? 0},${r.impressions ?? 0},${r.cost ?? 0},${r.conversions ?? 0}`
  ).join('\n');
  return [header, body].join('\n');
}

function keywordsCsv(rows = []) {
  const header = 'Campaign,Ad group,Keyword,Match type,Clicks,Impressions,Cost,Conversions';
  const body = rows.map(r =>
    `${r.campaign ?? 'Test'},${r.adGroup ?? 'AG'},${r.keyword ?? 'garage door'},${r.matchType ?? 'Exact'},${r.clicks ?? 0},${r.impressions ?? 0},${r.cost ?? 0},${r.conversions ?? 0}`
  ).join('\n');
  return [header, body].join('\n');
}

function deviceCsv(rows = []) {
  const header = 'Campaign,Device,Clicks,Impressions,Cost,Conversions';
  const body = rows.map(r =>
    `${r.campaign ?? 'Test'},${r.device ?? 'Mobile'},${r.clicks ?? 0},${r.impressions ?? 0},${r.cost ?? 0},${r.conversions ?? 0}`
  ).join('\n');
  return [header, body].join('\n');
}

function locationCsv(rows = []) {
  const header = 'Campaign,Most specific location,Clicks,Impressions,Cost,Conversions';
  const body = rows.map(r =>
    `${r.campaign ?? 'Test'},${r.location ?? 'Vancouver'},${r.clicks ?? 0},${r.impressions ?? 0},${r.cost ?? 0},${r.conversions ?? 0}`
  ).join('\n');
  return [header, body].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. REPORT CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────

describe('Report classification — detectReportType', () => {
  it('correctly identifies Campaign report headers', () => {
    const result = detectReportType(['Campaign', 'Clicks', 'Impressions', 'Cost', 'Conversions', 'Search impr. share']);
    expect(result?.type).toBe(REPORT_TYPES.CAMPAIGN);
  });

  it('correctly identifies Ad Group report headers', () => {
    const result = detectReportType(['Campaign', 'Ad group', 'Clicks', 'Impressions', 'Cost', 'Conversions']);
    expect(result?.type).toBe(REPORT_TYPES.AD_GROUP);
  });

  it('correctly identifies Search Terms report headers', () => {
    const result = detectReportType(['Search term', 'Campaign', 'Ad group', 'Clicks', 'Impressions', 'Cost', 'Conversions', 'Match type']);
    expect(result?.type).toBe(REPORT_TYPES.SEARCH_TERMS);
  });

  it('correctly identifies Keywords report headers', () => {
    const result = detectReportType(['Campaign', 'Ad group', 'Keyword', 'Match type', 'Clicks', 'Impressions', 'Cost', 'Conversions']);
    expect(result?.type).toBe(REPORT_TYPES.KEYWORDS);
  });

  it('correctly identifies Device report headers', () => {
    const result = detectReportType(['Campaign', 'Device', 'Clicks', 'Impressions', 'Cost', 'Conversions']);
    expect(result?.type).toBe(REPORT_TYPES.DEVICES);
  });

  it('correctly identifies Location report from specific location header', () => {
    const result = detectReportType(['Campaign', 'Most specific location', 'Clicks', 'Impressions', 'Cost', 'Conversions']);
    expect(result?.type).toBe(REPORT_TYPES.LOCATION);
    expect(result?.strength).toBeGreaterThanOrEqual(3);
  });

  it('does NOT classify Ad Group report as Location due to generic "User location" column', () => {
    // Ad Group reports can contain a "User location" column — must not be classified as Location
    const result = detectReportType(['Campaign', 'Ad group', 'User location', 'Clicks', 'Impressions', 'Cost', 'Conversions']);
    expect(result?.type).not.toBe(REPORT_TYPES.LOCATION);
  });

  it('does NOT classify Search Terms report as Location when it has a location column', () => {
    const result = detectReportType(['Search term', 'Campaign', 'Ad group', 'User location', 'Clicks', 'Cost', 'Conversions']);
    expect(result?.type).not.toBe(REPORT_TYPES.LOCATION);
  });

  it('does NOT classify Keywords report as Location when it has a location column', () => {
    const result = detectReportType(['Campaign', 'Ad group', 'Keyword', 'Match type', 'User location', 'Cost', 'Conversions']);
    expect(result?.type).not.toBe(REPORT_TYPES.LOCATION);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. REPORT ROUTING — slot match / mismatch
// ─────────────────────────────────────────────────────────────────────────────

describe('routeReport — slot match state', () => {
  it('confirms match when Campaign CSV uploaded to campaign slot', () => {
    const csv = campaignCsv([{ campaign: 'Garage Door', clicks: 50, cost: 100, conversions: 2 }]);
    const result = routeReport(csv, REPORT_TYPES.CAMPAIGN);
    expect(result.validation.slotMatch?.state).toBe('match_confirmed');
    // No mismatch warnings — preferred-column warnings are expected and fine
    expect(result.validation.warnings.some(w => w.includes('מתאים יותר'))).toBe(false);
  });

  it('confirms match when Search Terms CSV uploaded to searchTerm slot', () => {
    const csv = searchTermsCsv([{ searchTerm: 'garage door repair', clicks: 10, cost: 50 }]);
    const result = routeReport(csv, REPORT_TYPES.SEARCH_TERMS);
    expect(result.validation.slotMatch?.state).toBe('match_confirmed');
    expect(result.validation.warnings.some(w => w.includes('מתאים יותר'))).toBe(false);
  });

  it('confirms match when Keywords CSV uploaded to keyword slot', () => {
    const csv = keywordsCsv([{ keyword: 'garage door repair', clicks: 10, cost: 40, conversions: 1 }]);
    const result = routeReport(csv, REPORT_TYPES.KEYWORDS);
    expect(result.validation.slotMatch?.state).toBe('match_confirmed');
    expect(result.validation.warnings.some(w => w.includes('מתאים יותר'))).toBe(false);
  });

  it('emits strong_mismatch when Campaign CSV is uploaded to keyword slot', () => {
    // Campaign CSV (has searchImprShare, no keyword) uploaded to keyword slot
    const csv = 'Campaign,Clicks,Impressions,Cost,Conversions,Search impr. share\nTest,100,1000,200,5,45%';
    const result = routeReport(csv, REPORT_TYPES.KEYWORDS);
    // Must have strong_mismatch or at least a warning
    const hasWarning = result.validation.warnings.length > 0 || result.validation.slotMatch?.state === 'strong_mismatch';
    expect(hasWarning).toBe(true);
  });

  it('does NOT emit mismatch warning for Ad Group CSV uploaded to adGroup slot', () => {
    // Ad Group report can legitimately have a "Locations of interest" column
    const csv = adGroupCsv([{ campaign: 'Test', adGroup: 'AG1', clicks: 20, cost: 50 }]);
    const result = routeReport(csv, REPORT_TYPES.AD_GROUP);
    // No type-mismatch warning — preferred-column warnings are fine
    expect(result.validation.warnings.some(w => w.includes('מתאים יותר'))).toBe(false);
    expect(result.validation.slotMatch?.state).not.toBe('strong_mismatch');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. NORMALIZER — aggregate row filtering
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeRows — aggregate row filtering', () => {
  it('drops English "Total" aggregate row', () => {
    const raw = [
      { Campaign: 'Garage Door Campaign', Clicks: '50', Cost: '100', Conversions: '2' },
      { Campaign: 'Total', Clicks: '50', Cost: '100', Conversions: '2' },
    ];
    const { rows, droppedAggregateRows } = normalizeRows(raw, REPORT_TYPES.CAMPAIGN);
    expect(droppedAggregateRows).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].campaign).toBe('Garage Door Campaign');
  });

  it('drops Hebrew "סה"כ" aggregate row', () => {
    const raw = [
      { Campaign: 'קמפיין ראשי', Clicks: '30', Cost: '80', Conversions: '1' },
      { Campaign: 'סה"כ', Clicks: '30', Cost: '80', Conversions: '1' },
    ];
    const { rows, droppedAggregateRows } = normalizeRows(raw, REPORT_TYPES.CAMPAIGN);
    expect(droppedAggregateRows).toBe(1);
    expect(rows).toHaveLength(1);
  });

  it('drops Hebrew "כולל" aggregate row', () => {
    const raw = [
      { Campaign: 'Test Campaign', Clicks: '10', Cost: '40', Conversions: '0' },
      { Campaign: 'כולל', Clicks: '10', Cost: '40', Conversions: '0' },
    ];
    const { rows, droppedAggregateRows } = normalizeRows(raw, REPORT_TYPES.CAMPAIGN);
    expect(droppedAggregateRows).toBe(1);
    expect(rows).toHaveLength(1);
  });

  it('drops Hebrew "סיכום" aggregate row', () => {
    const raw = [
      { Campaign: 'Test Campaign', Clicks: '10', Cost: '40', Conversions: '0' },
      { Campaign: 'סיכום', Clicks: '10', Cost: '40', Conversions: '0' },
    ];
    const { rows, droppedAggregateRows } = normalizeRows(raw, REPORT_TYPES.CAMPAIGN);
    expect(droppedAggregateRows).toBe(1);
    expect(rows).toHaveLength(1);
  });

  it('does NOT drop real campaign rows', () => {
    const raw = [
      { Campaign: 'Garage Door Install', Clicks: '30', Cost: '80', Conversions: '2' },
      { Campaign: 'Emergency Repair', Clicks: '20', Cost: '55', Conversions: '1' },
    ];
    const { rows, droppedAggregateRows } = normalizeRows(raw, REPORT_TYPES.CAMPAIGN);
    expect(droppedAggregateRows).toBe(0);
    expect(rows).toHaveLength(2);
  });

  it('treats null conversions as null — never as 0', () => {
    const raw = [
      { Campaign: 'Test', Clicks: '20', Cost: '60', Impressions: '200' },
    ];
    const { rows } = normalizeRows(raw, REPORT_TYPES.CAMPAIGN);
    expect(rows[0].conversions).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. WASTE RULES — null conversions gate
// ─────────────────────────────────────────────────────────────────────────────

describe('wasteRules — null-conversions gate', () => {
  it('does NOT fire waste finding when conversions column is absent (null)', () => {
    const rows = [
      makeRow({ searchTerm: 'garage door repair', clicks: 20, cost: 100, conversions: null }),
    ];
    const findings = wasteRules({ searchTerms: rows, keywords: [], adGroups: [] });
    const wasteFinding = findings.find(f => f.signal === 'zero-leads-term');
    expect(wasteFinding).toBeUndefined();
  });

  it('DOES fire waste finding when conversions is explicitly 0', () => {
    const rows = [
      makeRow({ searchTerm: 'garage door repair', clicks: 20, cost: 100, conversions: 0 }),
    ];
    const findings = wasteRules({ searchTerms: rows, keywords: [], adGroups: [] });
    const wasteFinding = findings.find(f => f.signal === 'zero-leads-term');
    expect(wasteFinding).toBeDefined();
  });

  it('does NOT fire keyword waste when keyword conversions column is null', () => {
    const rows = [
      makeRow({ keyword: 'garage door opener', clicks: 20, cost: 100, conversions: null, reportType: 'keyword' }),
    ];
    const findings = wasteRules({ keywords: rows, searchTerms: [], adGroups: [] });
    const kwFinding = findings.find(f => f.signal === 'non-converting-keyword');
    expect(kwFinding).toBeUndefined();
  });

  it('DOES fire keyword waste when keyword has explicit zero conversions and enough clicks', () => {
    const rows = [
      makeRow({ keyword: 'garage door opener', clicks: T.minClicksForConfidentJudgment + 1, cost: 100, conversions: 0, reportType: 'keyword' }),
    ];
    const findings = wasteRules({ keywords: rows, searchTerms: [], adGroups: [] });
    const kwFinding = findings.find(f => f.signal === 'non-converting-keyword');
    expect(kwFinding).toBeDefined();
    expect(kwFinding.severity).toBe('high');
  });

  it('suppresses soft-watch waste finding (severity low) from reaching actionable tier', () => {
    // 8 clicks, $22 spend, explicit 0 conversions — should be low severity
    const rows = [
      makeRow({ searchTerm: 'garage door spring', clicks: 8, cost: 22, conversions: 0 }),
    ];
    const findings = wasteRules({ searchTerms: rows, keywords: [], adGroups: [] });
    const softWatch = findings.find(f => f.signal === 'zero-leads-watch');
    expect(softWatch).toBeDefined();
    expect(softWatch.severity).toBe('low'); // must not reach UI
  });

  it('does NOT fire ad group waste when conversions is null', () => {
    const rows = [
      makeRow({
        adGroup: 'Garage Door Repair',
        campaign: 'Main',
        clicks: 20,
        cost: T.minSpendForWaste * 2 + 10,
        conversions: null,
        reportType: 'adGroup',
      }),
    ];
    const findings = wasteRules({ adGroups: rows, keywords: [], searchTerms: [] });
    const agFinding = findings.find(f => f.signal === 'non-converting-adgroup');
    expect(agFinding).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. MEASUREMENT RISK RULES — click threshold gate
// ─────────────────────────────────────────────────────────────────────────────

describe('measurementRiskRules — click threshold gate', () => {
  it('does NOT fire manyClicksNoLeads below T.minClicksNoLeadsForTracking (50)', () => {
    const rows = [
      makeRow({ searchTerm: 'garage door', clicks: T.minClicksNoLeadsForTracking - 1, conversions: 0 }),
    ];
    const findings = measurementRiskRules({ searchTerms: rows, keywords: [], campaigns: [], adGroups: [] });
    const f = findings.find(f => f.signal === 'many-clicks-no-leads');
    expect(f).toBeUndefined();
  });

  it('DOES fire manyClicksNoLeads at exactly T.minClicksNoLeadsForTracking (50)', () => {
    const rows = [
      makeRow({ searchTerm: 'garage door', clicks: T.minClicksNoLeadsForTracking, conversions: 0 }),
    ];
    const findings = measurementRiskRules({ searchTerms: rows, keywords: [], campaigns: [], adGroups: [] });
    const f = findings.find(f => f.signal === 'many-clicks-no-leads');
    expect(f).toBeDefined();
    expect(f.severity).toBe('high');
  });

  it('does NOT fire manyClicksNoLeads when conversions is null (column absent)', () => {
    const rows = [
      makeRow({ searchTerm: 'garage door', clicks: 60, conversions: null }),
    ];
    const findings = measurementRiskRules({ searchTerms: rows, keywords: [], campaigns: [], adGroups: [] });
    const f = findings.find(f => f.signal === 'many-clicks-no-leads');
    expect(f).toBeUndefined();
  });

  it('fires leadsExceedClicks when conversions > clicks', () => {
    const rows = [makeRow({ campaign: 'Test', clicks: 5, conversions: 10 })];
    const findings = measurementRiskRules({ campaigns: rows, searchTerms: [], keywords: [], adGroups: [] });
    const f = findings.find(f => f.signal === 'conversions-exceed-clicks');
    expect(f).toBeDefined();
    expect(f.severity).toBe('high');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. SYNTHETIC MEASUREMENT FINDINGS — must not reach UI as finding cards
// ─────────────────────────────────────────────────────────────────────────────

describe('reportBuilder — synthetic measurement section', () => {
  it('synthetic measurement guardrail has severity low (filtered from UI cards)', () => {
    // No measurement findings in data → synthetic guardrail should be low severity
    const data = {
      campaigns: [makeRow({ campaign: 'Test', clicks: 10, cost: 50, conversions: 2 })],
      adGroups: [], searchTerms: [], keywords: [], ads: [], devices: [], locations: [],
    };
    const findings = []; // no rules fired
    const reportStatuses = {};
    const report = buildReport(findings, data, {}, reportStatuses);

    // measurementRisks should be either empty or all low-severity
    for (const f of report.measurementRisks) {
      expect(['low', undefined]).toContain(f.severity);
    }
  });

  it('real measurement findings ARE surfaced normally', () => {
    const data = {
      campaigns: [],
      adGroups: [],
      searchTerms: [makeRow({ searchTerm: 'test query', clicks: 60, conversions: 0, reportType: 'searchTerm' })],
      keywords: [], ads: [], devices: [], locations: [],
    };
    // Simulate measurement rules firing
    const findings = [
      {
        category: 'measurementRisk',
        severity: 'high',
        what: 'Test finding',
        why: 'Test reason',
        action: 'Fix it',
        signal: 'many-clicks-no-leads',
        data: { clicks: 60, conversions: 0 },
      },
    ];
    const report = buildReport(findings, data, {}, {});
    const highFindings = report.measurementRisks.filter(f => f.severity === 'high');
    expect(highFindings).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. LOW SEVERITY FINDINGS — must not appear in actionable findings
// ─────────────────────────────────────────────────────────────────────────────

describe('Low-severity finding gate', () => {
  it('soft-watch waste findings (severity low) are excluded from report.waste', () => {
    const data = {
      campaigns: [],
      adGroups: [],
      searchTerms: [
        // 8 clicks, $25 spend, explicit 0 conversions → soft-watch only
        makeRow({ searchTerm: 'test term', clicks: 8, cost: 25, conversions: 0, reportType: 'searchTerm' }),
      ],
      keywords: [], ads: [], devices: [], locations: [],
    };
    const lowFindings = [
      {
        category: 'waste',
        severity: 'low',
        what: 'Soft watch',
        why: 'Low volume',
        action: 'Monitor',
        signal: 'zero-leads-watch',
        data: { clicks: 8, cost: 25 },
      },
    ];
    const report = buildReport(lowFindings, data, {}, {});
    // report.waste only has actionable findings (severity >= medium)
    expect(report.waste).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. CONTROL RISK RULES — null-conversions gates
// ─────────────────────────────────────────────────────────────────────────────

describe('controlRiskRules — null-conversions gates', () => {
  it('nonConvertingCampaigns does NOT fire when campaign conversions is null', () => {
    const campaigns = [
      makeRow({
        campaign: 'Garage Door Emergency',
        cost: T.minSpendForWaste * 2 + 20,
        conversions: null,
      }),
    ];
    const findings = controlRiskRules({ campaigns, keywords: [], adGroups: [] });
    const f = findings.find(f => f.signal === 'non-converting-campaign');
    expect(f).toBeUndefined();
  });

  it('nonConvertingCampaigns DOES fire when campaign has explicit zero conversions', () => {
    const campaigns = [
      makeRow({
        campaign: 'Garage Door Emergency',
        cost: T.minSpendForWaste * 2 + 20,
        clicks: 10,  // 5+ clicks required now
        conversions: 0,
      }),
    ];
    const findings = controlRiskRules({ campaigns, keywords: [], adGroups: [] });
    const f = findings.find(f => f.signal === 'non-converting-campaign');
    expect(f).toBeDefined();
    expect(f.severity).toBe('high');
  });

  it('broadMatchWithoutNegatives does NOT include keywords with null conversions', () => {
    // 3 broad-match keywords, each with null conversions — should not trigger the finding
    const keywords = [1, 2, 3].map(i => makeRow({
      keyword: `broad keyword ${i}`,
      matchType: 'Broad',
      cost: T.minSpendForWaste + 10,
      conversions: null,
      reportType: 'keyword',
    }));
    const findings = controlRiskRules({ keywords, campaigns: [], adGroups: [] });
    const f = findings.find(f => f.signal === 'broad-match-risk');
    expect(f).toBeUndefined();
  });

  it('broadMatchWithoutNegatives DOES fire when 4+ broad-match keywords with CA$200+ total spend have explicit zero conversions', () => {
    // New thresholds: 4+ keywords AND total spend >= CA$200
    const keywords = [1, 2, 3, 4].map(i => makeRow({
      keyword: `broad keyword ${i}`,
      matchType: 'Broad',
      cost: 80,  // 4 × CA$80 = CA$320 total, above CA$200 gate; each passes the per-keyword CA$75 filter
      conversions: 0,
      reportType: 'keyword',
    }));
    const findings = controlRiskRules({ keywords, campaigns: [], adGroups: [] });
    const f = findings.find(f => f.signal === 'broad-match-risk');
    expect(f).toBeDefined();
    expect(f.severity).toBe('high');
  });

  it('broadMatchWithoutNegatives does NOT fire with only 3 broad-match keywords below spend gate', () => {
    const keywords = [1, 2, 3].map(i => makeRow({
      keyword: `broad keyword ${i}`,
      matchType: 'Broad',
      cost: T.minSpendForWaste + 10,
      conversions: 0,
      reportType: 'keyword',
    }));
    const findings = controlRiskRules({ keywords, campaigns: [], adGroups: [] });
    const f = findings.find(f => f.signal === 'broad-match-risk');
    expect(f).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. AGGREGATE ROW FILTER — false-positive prevention
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeRows — aggregate regex false-positive prevention', () => {
  it('does NOT drop campaign named "Total Remodeling LLC"', () => {
    const raw = [
      { Campaign: 'Total Remodeling LLC', Clicks: '25', Cost: '80', Conversions: '2' },
    ];
    const { rows, droppedAggregateRows } = normalizeRows(raw, REPORT_TYPES.CAMPAIGN);
    expect(droppedAggregateRows).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].campaign).toBe('Total Remodeling LLC');
  });

  it('does NOT drop campaign named "Totals & Beyond"', () => {
    const raw = [
      { Campaign: 'Totals & Beyond', Clicks: '10', Cost: '40', Conversions: '1' },
    ];
    const { rows, droppedAggregateRows } = normalizeRows(raw, REPORT_TYPES.CAMPAIGN);
    expect(droppedAggregateRows).toBe(0);
    expect(rows).toHaveLength(1);
  });

  it('still drops a row that is exactly "Total"', () => {
    const raw = [
      { Campaign: 'Real Campaign', Clicks: '10', Cost: '30', Conversions: '1' },
      { Campaign: 'Total', Clicks: '10', Cost: '30', Conversions: '1' },
    ];
    const { rows, droppedAggregateRows } = normalizeRows(raw, REPORT_TYPES.CAMPAIGN);
    expect(droppedAggregateRows).toBe(1);
    expect(rows).toHaveLength(1);
  });

  it('still drops a row that is exactly "Grand Total"', () => {
    const raw = [
      { Campaign: 'Garage Door Install', Clicks: '20', Cost: '60', Conversions: '2' },
      { Campaign: 'Grand Total', Clicks: '20', Cost: '60', Conversions: '2' },
    ];
    const { rows, droppedAggregateRows } = normalizeRows(raw, REPORT_TYPES.CAMPAIGN);
    expect(droppedAggregateRows).toBe(1);
    expect(rows).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. NEGATIVE VALUES — treated as null
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeRows — negative metric values treated as null', () => {
  it('negative cost is treated as null (not a valid spend)', () => {
    const raw = [{ Campaign: 'Test', Clicks: '10', Cost: '-50', Conversions: '1' }];
    const { rows } = normalizeRows(raw, REPORT_TYPES.CAMPAIGN);
    expect(rows[0].cost).toBeNull();
  });

  it('negative clicks is treated as null', () => {
    const raw = [{ Campaign: 'Test', Clicks: '-5', Cost: '40', Conversions: '1' }];
    const { rows } = normalizeRows(raw, REPORT_TYPES.CAMPAIGN);
    expect(rows[0].clicks).toBeNull();
  });

  it('negative conversions is treated as null', () => {
    const raw = [{ Campaign: 'Test', Clicks: '10', Cost: '40', Conversions: '-2' }];
    const { rows } = normalizeRows(raw, REPORT_TYPES.CAMPAIGN);
    expect(rows[0].conversions).toBeNull();
  });

  it('negative impressions is treated as null', () => {
    const raw = [{ Campaign: 'Test', Clicks: '10', Cost: '40', Impressions: '-100', Conversions: '1' }];
    const { rows } = normalizeRows(raw, REPORT_TYPES.CAMPAIGN);
    expect(rows[0].impressions).toBeNull();
  });

  it('valid positive values still parse correctly', () => {
    const raw = [{ Campaign: 'Test', Clicks: '10', Cost: '50', Impressions: '200', Conversions: '2' }];
    const { rows } = normalizeRows(raw, REPORT_TYPES.CAMPAIGN);
    expect(rows[0].clicks).toBe(10);
    expect(rows[0].cost).toBe(50);
    expect(rows[0].impressions).toBe(200);
    expect(rows[0].conversions).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. STRING "0" CONVERSIONS — parsed as explicit zero, not null
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeRows — string "0" conversions is explicit zero', () => {
  it('string "0" in conversions column is parsed as the number 0 (not null)', () => {
    const raw = [{ Campaign: 'Test', Clicks: '10', Cost: '40', Conversions: '0' }];
    const { rows } = normalizeRows(raw, REPORT_TYPES.CAMPAIGN);
    expect(rows[0].conversions).toBe(0);
  });

  it('string "0" conversion triggers non-converting campaign rule (explicit zero, not null)', () => {
    const campaigns = [makeRow({
      reportType: REPORT_TYPES.CAMPAIGN,
      campaign: 'Zero Lead Campaign',
      cost: 200,
      clicks: 50,
      conversions: 0,   // explicit zero from parseValue("0")
    })];
    const findings = controlRiskRules({ campaigns, keywords: [], adGroups: [] });
    const relevant = findings.filter(f => f.signal === 'non-converting-campaign');
    expect(relevant.length).toBeGreaterThan(0);
  });

  it('null conversions does NOT trigger non-converting campaign rule', () => {
    const campaigns = [makeRow({
      reportType: REPORT_TYPES.CAMPAIGN,
      campaign: 'No Conversion Data',
      cost: 200,
      clicks: 50,
      conversions: null,   // truly absent column
    })];
    const findings = controlRiskRules({ campaigns, keywords: [], adGroups: [] });
    const relevant = findings.filter(f => f.signal === 'non-converting-campaign');
    expect(relevant).toHaveLength(0);
  });

  it('"--" in conversions column is parsed as null (not zero)', () => {
    const raw = [{ Campaign: 'Test', Clicks: '10', Cost: '40', Conversions: '--' }];
    const { rows } = normalizeRows(raw, REPORT_TYPES.CAMPAIGN);
    expect(rows[0].conversions).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. LOW-SEVERITY ISOLATION — never leaks to summary counts or topActions
// ─────────────────────────────────────────────────────────────────────────────

describe('buildReport — low-severity findings are fully isolated from outputs', () => {
  it('all-low-severity findings produce empty waste/control/opportunity arrays', () => {
    const lowFindings = [
      { category: 'waste',       severity: 'low', signal: 'soft-watch', what: 'a', why: 'b', action: 'c', data: {} },
      { category: 'controlRisk', severity: 'low', signal: 'soft-watch', what: 'a', why: 'b', action: 'c', data: {} },
      { category: 'opportunity', severity: 'low', signal: 'soft-watch', what: 'a', why: 'b', action: 'c', data: {} },
    ];
    const report = buildReport(lowFindings, { campaigns: [], adGroups: [], searchTerms: [], keywords: [], ads: [], devices: [], locations: [] }, {}, {});
    expect(report.waste).toHaveLength(0);
    expect(report.controlRisks).toHaveLength(0);
    // opportunities is now a structured object, not a flat array
    expect(report.opportunities.actionableNow).toHaveLength(0);
    expect(report.opportunities.reviewBeforeActing).toHaveLength(0);
  });

  it('low-severity findings do not increment summary.highSeverityCount', () => {
    const lowFindings = [
      { category: 'waste', severity: 'low', signal: 'soft-watch', what: 'a', why: 'b', action: 'c', data: {} },
    ];
    const report = buildReport(lowFindings, { campaigns: [], adGroups: [], searchTerms: [], keywords: [], ads: [], devices: [], locations: [] }, {}, {});
    expect(report.summary?.highSeverityCount ?? 0).toBe(0);
  });

  it('low-severity findings do not appear in topActions', () => {
    const lowFindings = [
      { category: 'waste', severity: 'low', signal: 'soft-watch', what: 'low action text', why: 'b', action: 'do nothing', data: {} },
    ];
    const report = buildReport(lowFindings, { campaigns: [], adGroups: [], searchTerms: [], keywords: [], ads: [], devices: [], locations: [] }, {}, {});
    const topActionTexts = (report.topActions ?? []).map(a => a.action ?? a.what ?? '');
    expect(topActionTexts.some(t => t.includes('low action text') || t.includes('do nothing'))).toBe(false);
  });

  it('high-severity findings still increment summary.highSeverityCount normally', () => {
    const findings = [
      { category: 'waste', severity: 'high', signal: 'zero-leads-high-spend', what: 'X spent Y with 0 leads', why: 'b', action: 'c', data: {} },
    ];
    const report = buildReport(findings, { campaigns: [], adGroups: [], searchTerms: [], keywords: [], ads: [], devices: [], locations: [] }, {}, {});
    expect(report.summary?.highSeverityCount ?? 0).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. CROSS-CATEGORY DEDUP — waste suppressed when measurement explains same entity
// ─────────────────────────────────────────────────────────────────────────────

describe('reportBuilder — cross-category dedup (waste suppressed by measurement)', () => {
  const emptyData = { campaigns: [], adGroups: [], searchTerms: [], keywords: [], ads: [], devices: [], locations: [] };

  it('waste zero-leads-term is suppressed when measurement many-clicks-no-leads covers same entity', () => {
    const findings = [
      {
        category: 'measurementRisk',
        severity: 'high',
        signal: 'many-clicks-no-leads',
        what: '"garage door repair" קיבל 60 קליקים ואפס לידים',
        why: 'tracking broken',
        action: 'check tracking',
        data: { searchTerm: 'garage door repair', clicks: 60, conversions: 0 },
      },
      {
        category: 'waste',
        severity: 'high',
        signal: 'zero-leads-term',
        what: '"garage door repair" הוציא CA$90 עם 60 קליקים ללא שום ליד',
        why: 'wasted spend',
        action: 'add negative',
        data: { searchTerm: 'garage door repair', cost: 90, clicks: 60, conversions: 0 },
      },
    ];
    const report = buildReport(findings, emptyData, {}, {});
    expect(report.waste).toHaveLength(0);
    expect(report.measurementRisks.filter(f => f.signal === 'many-clicks-no-leads')).toHaveLength(1);
  });

  it('waste non-converting-keyword is suppressed when measurement covers same keyword', () => {
    const findings = [
      {
        category: 'measurementRisk',
        severity: 'high',
        signal: 'many-clicks-no-leads',
        what: '"emergency garage door" קיבל 55 קליקים ואפס לידים',
        why: 'tracking broken',
        action: 'check tracking',
        data: { keyword: 'emergency garage door', clicks: 55, conversions: 0 },
      },
      {
        category: 'waste',
        severity: 'high',
        signal: 'non-converting-keyword',
        what: 'מילת מפתח "emergency garage door" קיבלה 55 קליקים ללא לידים',
        why: 'zero leads keyword',
        action: 'pause keyword',
        data: { keyword: 'emergency garage door', cost: 110, clicks: 55, conversions: 0 },
      },
    ];
    const report = buildReport(findings, emptyData, {}, {});
    expect(report.waste).toHaveLength(0);
  });

  it('waste finding for a DIFFERENT entity is NOT suppressed', () => {
    const findings = [
      {
        category: 'measurementRisk',
        severity: 'high',
        signal: 'many-clicks-no-leads',
        what: '"garage door repair" קיבל 60 קליקים',
        why: 'tracking',
        action: 'check',
        data: { searchTerm: 'garage door repair', clicks: 60, conversions: 0 },
      },
      {
        category: 'waste',
        severity: 'high',
        signal: 'zero-leads-term',
        what: '"overhead door" הוציא CA$90 ללא ליד',
        why: 'wasted',
        action: 'add negative',
        data: { searchTerm: 'overhead door', cost: 90, clicks: 20, conversions: 0 },
      },
    ];
    const report = buildReport(findings, emptyData, {}, {});
    expect(report.waste).toHaveLength(1);
    expect(report.waste[0].data.searchTerm).toBe('overhead door');
  });

  it('account-level waste (wasted-spend-share) is NOT suppressed by measurement', () => {
    const findings = [
      {
        category: 'measurementRisk',
        severity: 'high',
        signal: 'many-clicks-no-leads',
        what: '"term" קיבל 60 קליקים',
        why: 'tracking',
        action: 'check',
        data: { searchTerm: 'term', clicks: 60, conversions: 0 },
      },
      {
        category: 'waste',
        severity: 'high',
        signal: 'wasted-spend-share',
        what: '30% מהתקציב הוציא אפס לידים',
        why: 'budget waste',
        action: 'stop zero-lead campaigns',
        data: { wastedSpend: 300, totalSpend: 1000 },
      },
    ];
    const report = buildReport(findings, emptyData, {}, {});
    expect(report.waste).toHaveLength(1);
    expect(report.waste[0].signal).toBe('wasted-spend-share');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. ADS DETECTION — alternate signal (adDescription + adStatus, no finalUrl)
// ─────────────────────────────────────────────────────────────────────────────

describe('detectReportType — Ads report alternate signal', () => {
  it('detects Ads report via adDescription + finalUrl (primary signal)', () => {
    const result = detectReportType(['Campaign', 'Ad description', 'Final URL', 'Impressions', 'Clicks', 'Cost']);
    expect(result?.type).toBe(REPORT_TYPES.ADS);
    expect(result?.strength).toBe(2);
  });

  it('detects Ads report via adDescription + adStatus when finalUrl is absent', () => {
    const result = detectReportType(['Campaign', 'Ad description', 'Ad status', 'Impressions', 'Clicks', 'Cost']);
    expect(result?.type).toBe(REPORT_TYPES.ADS);
    expect(result?.strength).toBe(2);
  });

  it('does NOT detect Ads report from adDescription alone (below strength 2, no mismatch warning)', () => {
    // adDescription without a second confirming field is not strong enough for mismatch detection
    const result = detectReportType(['Campaign', 'Ad description', 'Cost', 'Conversions']);
    // Either no match or a lower-strength match — should NOT produce a strength-2 ads match
    if (result?.type === REPORT_TYPES.ADS) {
      expect(result.strength).toBeLessThan(2);
    } else {
      expect(result?.type).not.toBe(REPORT_TYPES.ADS);
    }
  });

  it('routeReport uploaded to correct Ads slot gets match_confirmed with alternate signal', () => {
    // Ads CSV with adDescription + adStatus but no finalUrl — secondary signal
    const csv = [
      'Campaign,Ad description,Ad status,Impressions,Cost,Conversions',
      'Test Campaign,Buy now - fast service,Enabled,1000,50,2',
    ].join('\n');
    const result = routeReport(csv, REPORT_TYPES.ADS);
    // Should be recognized as matching the Ads slot
    expect(result.validation.slotMatch?.state).toBe('match_confirmed');
  });
});
