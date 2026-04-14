/**
 * validator.js
 * Validates a set of normalized rows against a report schema.
 *
 * Returns a ValidationResult:
 * {
 *   ok:              boolean   — false if required columns are missing (blocks analysis)
 *   errors:          string[]  — fatal issues (required columns missing)
 *   warnings:        string[]  — non-fatal issues (preferred columns missing, suspicious values)
 *   missingRequired: string[]  — internal field names that were required but absent
 *   missingPreferred:string[]  — internal field names that were preferred but absent
 *   rowCount:        number
 * }
 */

import { SCHEMAS } from './schemas.js';

/**
 * Validate normalized rows for a given report type.
 * @param {Object[]} rows        — already-normalized rows from the parser
 * @param {string}   reportType  — one of REPORT_TYPES values
 * @param {string[]} foundFields — list of internal field keys actually found in the file
 * @returns {ValidationResult}
 */
export function validate(rows, reportType, foundFields) {
  const schema = SCHEMAS[reportType];
  if (!schema) {
    return fatal(`Unknown report type: "${reportType}"`);
  }

  const errors   = [];
  const warnings = [];

  // ── Required column check ─────────────────────────────────────────────────
  const missingRequired = schema.required.filter(f => !foundFields.includes(f));
  if (missingRequired.length > 0) {
    const labels = missingRequired.map(toLabel).join(', ');
    errors.push(`Missing required column(s): ${labels}. This report cannot be analyzed.`);
  }

  // ── Preferred column check ────────────────────────────────────────────────
  const missingPreferred = schema.preferred.filter(f => !foundFields.includes(f));
  if (missingPreferred.length > 0) {
    const labels = missingPreferred.map(toLabel).join(', ');
    warnings.push(`Missing preferred column(s): ${labels}. Some insights may be limited.`);
  }

  // ── Empty file check ──────────────────────────────────────────────────────
  if (rows.length === 0) {
    errors.push('No data rows found in this file after the header row.');
  }

  // ── Suspicious data checks (only if file is otherwise valid) ─────────────
  if (errors.length === 0 && rows.length > 0) {
    checkForSuspiciousData(rows, warnings);
  }

  return {
    ok:               errors.length === 0,
    errors,
    warnings,
    missingRequired,
    missingPreferred,
    rowCount:         rows.length,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fatal(message) {
  return { ok: false, errors: [message], warnings: [], missingRequired: [], missingPreferred: [], rowCount: 0 };
}

/**
 * Lightweight sanity checks that add warnings but never block analysis.
 */
function checkForSuspiciousData(rows, warnings) {
  const totalCost = sumNullable(rows, 'cost');
  const totalConv = sumNullable(rows, 'conversions');
  const totalClicks = sumNullable(rows, 'clicks');

  // All rows have 0 conversions recorded — could be tracking issue
  if (totalConv === 0 && totalCost !== null && totalCost > 0) {
    warnings.push('Zero conversions recorded across all rows. Verify your conversion tracking is set up correctly.');
  }

  // More conversions than clicks is almost always a tracking problem
  if (totalConv !== null && totalClicks !== null && totalConv > totalClicks && totalClicks > 0) {
    warnings.push(`Conversions (${totalConv}) exceed clicks (${totalClicks}). This usually indicates a conversion tracking configuration issue.`);
  }

  // Very high CTR on any row (>50% is almost always a data error or brand keyword issue)
  const highCtrRow = rows.find(r => r.ctr !== null && r.ctr > 50);
  if (highCtrRow) {
    warnings.push(`Unusually high CTR detected (${highCtrRow.ctr?.toFixed(1)}%). Check for data errors or very narrow branded keywords.`);
  }
}

/** Convert an internal field name back to a readable label. */
function toLabel(field) {
  const labels = {
    campaign:            'Campaign',
    adGroup:             'Ad group',
    searchTerm:          'Search term',
    keyword:             'Keyword',
    matchType:           'Match type',
    device:              'Device',
    location:            'User location',
    clicks:              'Clicks',
    impressions:         'Impressions',
    cost:                'Cost',
    conversions:         'Conversions',
    ctr:                 'CTR',
    avgCpc:              'Avg. CPC',
    conversionRate:      'Conv. rate',
    costPerConversion:   'Cost / conv.',
    searchImprShare:     'Search impr. share',
    searchLostIsRank:    'Search lost IS (rank)',
    searchLostIsBudget:  'Search lost IS (budget)',
    qualityScore:        'Quality Score',
    finalUrl:            'Final URL',
    adDescription:       'Description',
  };
  return labels[field] || field;
}

/** Sum a nullable field across rows. Returns null if no row has a value. */
function sumNullable(rows, field) {
  let total = null;
  for (const row of rows) {
    if (row[field] !== null && row[field] !== undefined) {
      total = (total ?? 0) + row[field];
    }
  }
  return total;
}
