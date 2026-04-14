/**
 * normalizer.js
 * Converts a raw parsed row (string values, Google Ads column names)
 * into a NormalizedRow with typed, nullable fields.
 *
 * Rules:
 * - Use the exported value when present and parseable.
 * - Derive a metric from source fields when the column is absent but sources exist.
 * - Use null when neither is possible.
 * - Never default to 0 for a missing value.
 */

import { COLUMN_ALIASES, DETECTION_SIGNALS, REPORT_TYPES } from './schemas.js';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Normalize an array of raw CSV rows for a given report type.
 * @param {Object[]} rawRows     — from csvParser, keys are original column names
 * @param {string}   reportType  — one of REPORT_TYPES values
 * @returns {{ rows: NormalizedRow[], foundFields: string[] }}
 */
export function normalizeRows(rawRows, reportType) {
  if (!rawRows.length) return { rows: [], foundFields: [], droppedAggregateRows: 0 };

  // Build a column→field map from the first row's keys
  const colMap = buildColumnMap(Object.keys(rawRows[0]));
  const foundFields = [...new Set(Object.values(colMap))];

  const normalized = rawRows.map(raw => normalizeRow(raw, colMap, reportType));
  const rows = normalized.filter(row => !isAggregateNormalizedRow(row));
  const droppedAggregateRows = normalized.length - rows.length;

  return { rows, foundFields, droppedAggregateRows };
}

/**
 * Attempt to detect the report type from column names alone (fallback only).
 * Returns null if detection is ambiguous.
 * @param {string[]} columnNames — raw column names from the CSV header
 * @returns {string|null}
 */
export function detectReportType(columnNames) {
  const colMap  = buildColumnMap(columnNames);
  const present = new Set(Object.values(colMap));

  for (const { type, fields } of DETECTION_SIGNALS) {
    if (fields.every(f => present.has(f))) return type;
  }
  return null;
}

// ── Row normalizer ────────────────────────────────────────────────────────────

function normalizeRow(raw, colMap, reportType) {
  // Step 1: map raw keys → internal field names, parse values
  const mapped = {};
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    const field = colMap[rawKey.toLowerCase().trim()];
    if (!field) continue;
    mapped[field] = parseValue(rawValue, field);
  }

  // Step 2: derive preferred metrics when absent but source fields exist
  deriveMetrics(mapped);

  // Step 3: build the final NormalizedRow with all expected fields present as null
  return {
    reportType,

    // Identity
    campaign:           mapped.campaign          ?? null,
    adGroup:            mapped.adGroup           ?? null,
    searchTerm:         mapped.searchTerm        ?? null,
    keyword:            mapped.keyword           ?? null,
    matchType:          mapped.matchType         ?? null,
    device:             mapped.device            ?? null,
    location:           mapped.location          ?? null,
    finalUrl:           mapped.finalUrl          ?? null,
    adDescription:      mapped.adDescription     ?? null,
    adStatus:           mapped.adStatus          ?? null,

    // Core metrics
    clicks:             mapped.clicks            ?? null,
    impressions:        mapped.impressions        ?? null,
    cost:               mapped.cost              ?? null,
    conversions:        mapped.conversions        ?? null,

    // Preferred metrics (may be derived)
    ctr:                mapped.ctr               ?? null,
    avgCpc:             mapped.avgCpc            ?? null,
    conversionRate:     mapped.conversionRate     ?? null,
    costPerConversion:  mapped.costPerConversion  ?? null,

    // Campaign-only
    searchImprShare:    mapped.searchImprShare    ?? null,
    searchLostIsRank:   mapped.searchLostIsRank   ?? null,
    searchLostIsBudget: mapped.searchLostIsBudget ?? null,

    // Keywords-only
    qualityScore:       mapped.qualityScore       ?? null,
  };
}

// ── Derive metrics ────────────────────────────────────────────────────────────

/**
 * Fills in preferred metrics that can be calculated from source fields
 * when they are absent from the export.
 * Only sets a derived value if both source fields are valid numbers > 0.
 */
function deriveMetrics(mapped) {
  const { clicks, impressions, cost, conversions } = mapped;

  if (mapped.ctr == null && isPositive(clicks) && isPositive(impressions)) {
    mapped.ctr = round((clicks / impressions) * 100, 2);
  }

  if (mapped.avgCpc == null && isPositive(cost) && isPositive(clicks)) {
    mapped.avgCpc = round(cost / clicks, 2);
  }

  if (mapped.conversionRate == null && isNumber(conversions) && isPositive(clicks)) {
    mapped.conversionRate = round((conversions / clicks) * 100, 2);
  }

  if (mapped.costPerConversion == null && isPositive(cost) && isPositive(conversions)) {
    mapped.costPerConversion = round(cost / conversions, 2);
  }
}

// ── Column map builder ────────────────────────────────────────────────────────

/**
 * Build a lowercase-column → internal-field map from a list of raw column names.
 */
function buildColumnMap(rawColumns) {
  const map = {};
  for (const rawCol of rawColumns) {
    const lower = rawCol.toLowerCase().trim();
    const match = COLUMN_ALIASES.find(({ aliases }) =>
      aliases.some(alias => lower === alias || lower.includes(alias))
    );
    if (match) map[lower] = match.field;
  }
  return map;
}

// ── Value parsers ─────────────────────────────────────────────────────────────

/**
 * Parse a raw string value from a Google Ads export.
 * Returns null for blank, "--", or unparseable values.
 * Handles: "1,234"  "12.34%"  "CA$1.23"  "$5.00"  "--"  ""
 */
function parseValue(raw, field) {
  if (raw == null) return null;
  const str = String(raw).trim();
  if (str === '' || str === '--' || str === 'N/A' || str === 'n/a') return null;

  // String fields — return as-is
  if (isStringField(field)) return str;

  // Percentage fields — strip % and return number
  const pctCleaned = str.replace('%', '').trim();
  if (str.endsWith('%')) {
    const n = parseFloat(pctCleaned.replace(/,/g, ''));
    return isNaN(n) ? null : n;
  }

  // Impression share fields can be "< 10%" — treat as the number
  if (str.startsWith('<') || str.startsWith('>')) {
    const n = parseFloat(str.replace(/[<>,%\s]/g, ''));
    return isNaN(n) ? null : n;
  }

  // Numeric fields — strip currency symbols and thousands separators
  const cleaned = str.replace(/[CA$£€,\s]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

const STRING_FIELDS = new Set([
  'campaign', 'adGroup', 'searchTerm', 'keyword', 'matchType',
  'device', 'location', 'finalUrl', 'adDescription', 'adStatus',
]);

function isStringField(field) { return STRING_FIELDS.has(field); }
function isNumber(v)   { return typeof v === 'number' && !isNaN(v); }
function isPositive(v) { return isNumber(v) && v > 0; }
function round(n, dp)  { return Math.round(n * 10 ** dp) / 10 ** dp; }

function isAggregateNormalizedRow(row) {
  const identityValues = [
    row.searchTerm,
    row.keyword,
    row.adGroup,
    row.campaign,
    row.device,
    row.location,
  ].filter(v => typeof v === 'string' && v.trim() !== '');

  if (identityValues.length === 0) return false;
  const first = normalizeLabel(identityValues[0]);
  return /^(total|subtotal|grand total|total:|total\s*-|sum\s+of)/i.test(first);
}

function normalizeLabel(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/["']/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}
