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
 * Returns { type, strength } for the best match, or null if ambiguous.
 * Only signals with strength >= 2 (specific field sets) are considered strong.
 * @param {string[]} columnNames — raw column names from the CSV header
 * @returns {{ type: string, strength: number }|null}
 */
const LOCATION_SPECIFIC_KEYWORDS = [
  'most specific location',
  'matched location',
  'location type',
  'country/territory',
  'country',
  'region',
  'city',
  'metro area',
  'postal code',
  'province',
  'state',
  'suburb',
  'locality',
];
const LOCATION_GENERIC_KEYWORDS = [
  'location',
  'locations of interest',
  'user location',
];

export function detectReportType(columnNames) {
  const lowerHeaders = columnNames.map(col => col.toLowerCase().trim());
  const colMap  = buildColumnMap(columnNames);
  const present = new Set(Object.values(colMap));

  let best = null;
  for (const signal of DETECTION_SIGNALS) {
    if (signal.type === REPORT_TYPES.LOCATION) continue;
    if (signal.fields.every(f => present.has(f))) {
      if (!best || (signal.strength ?? 1) > (best.strength ?? 1)) {
        best = signal;
      }
    }
  }

  const locationSignal = detectLocationReport(lowerHeaders, present);
  if (locationSignal && (!best || locationSignal.strength > (best.strength ?? 1))) {
    best = locationSignal;
  }

  if (!best) return null;
  return { type: best.type, strength: best.strength ?? 1 };
}

function detectLocationReport(lowerHeaders, presentFields) {
  const hasSpecificLocation = lowerHeaders.some(header =>
    LOCATION_SPECIFIC_KEYWORDS.some(keyword => header.includes(keyword))
  );
  const hasGenericLocation = lowerHeaders.some(header =>
    LOCATION_GENERIC_KEYWORDS.some(keyword => header.includes(keyword))
  );

  // If the file contains strong identity signals for other report types,
  // do not treat a generic location header as a location report.
  const hasOtherIdentity = presentFields.has('adGroup') || presentFields.has('searchTerm') ||
    presentFields.has('keyword') || presentFields.has('device') || presentFields.has('adDescription') ||
    presentFields.has('finalUrl');

  if (hasSpecificLocation && !hasOtherIdentity) {
    return { type: REPORT_TYPES.LOCATION, strength: 3 };
  }

  if (hasSpecificLocation && hasOtherIdentity) {
    return { type: REPORT_TYPES.LOCATION, strength: 1 };
  }

  if (hasGenericLocation && !hasOtherIdentity) {
    return { type: REPORT_TYPES.LOCATION, strength: 2 };
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
  if (isNaN(n)) return null;
  // Google Ads never exports negative metric values — treat as parsing artifact
  if (n < 0 && NON_NEGATIVE_FIELDS.has(field)) return null;
  return n;
}

const STRING_FIELDS = new Set([
  'campaign', 'adGroup', 'searchTerm', 'keyword', 'matchType',
  'device', 'location', 'finalUrl', 'adDescription', 'adStatus',
]);

// These fields can never be negative in a valid Google Ads export.
// Negative values indicate a parsing artifact — treat as null.
const NON_NEGATIVE_FIELDS = new Set([
  'clicks', 'impressions', 'cost', 'conversions',
  'ctr', 'avgCpc', 'conversionRate', 'costPerConversion',
  'searchImprShare', 'searchLostIsRank', 'searchLostIsBudget', 'qualityScore',
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
  // Require the entire label to be a known aggregate keyword (no trailing text).
  // This prevents false positives on campaign names like "Total Remodeling LLC".
  // English patterns + Hebrew equivalents (Google Ads exports in Hebrew locale).
  return /^(total|subtotal|grand total|total:|total\s*-|sum\s+of|total row|סה"כ|סהכ|כולל|סיכום|סך הכל|שורת סיכום)\s*$/i.test(first);
}

function normalizeLabel(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/["']/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}
