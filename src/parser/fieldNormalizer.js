/**
 * fieldNormalizer.js
 * Maps raw Google Ads column names to clean, consistent internal keys.
 * Google Ads exports vary slightly depending on the report type and date range settings.
 */

// Map of lowercase partial patterns → internal field name.
// More specific patterns must come before broader ones (e.g. "cost / conv." before "cost").
const FIELD_MAP = [
  // Identifiers
  { patterns: ['search term', 'search query'],            key: 'searchTerm' },
  { patterns: ['keyword text', 'keyword'],                key: 'keyword' },
  { patterns: ['campaign'],                               key: 'campaign' },
  { patterns: ['ad group'],                               key: 'adGroup' },
  { patterns: ['match type'],                             key: 'matchType' },

  // Derived cost metrics — must come before 'cost' to avoid partial matches
  { patterns: ['cost / conv.', 'cost/conv', 'cost per conv', 'cost per conversion'], key: 'costPerConversion' },

  // Core performance metrics
  { patterns: ['clicks'],                                 key: 'clicks' },
  { patterns: ['impressions', 'impr.'],                   key: 'impressions' },
  { patterns: ['ctr'],                                    key: 'ctr' },
  { patterns: ['avg. cpc', 'avg cpc', 'average cpc'],    key: 'avgCpc' },
  { patterns: ['cost'],                                   key: 'cost' },
  { patterns: ['conv. rate', 'conv rate', 'conversion rate'], key: 'convRate' },
  { patterns: ['conversions'],                            key: 'conversions' },
  { patterns: ['quality score', 'qual. score'],           key: 'qualityScore' },
];

/**
 * Normalize a single raw row: map Google Ads column names → internal keys,
 * and parse numeric/percentage string values into numbers.
 * Unknown columns are left as-is.
 * @param {Object} rawRow
 * @returns {Object} Normalized row
 */
export function normalizeRow(rawRow) {
  const normalized = {};

  for (const [rawKey, rawValue] of Object.entries(rawRow)) {
    const internalKey = resolveKey(rawKey);
    normalized[internalKey || rawKey] = internalKey
      ? parseMetricValue(rawValue, internalKey)
      : rawValue;
  }

  return normalized;
}

/**
 * Normalize an array of raw rows.
 * @param {Object[]} rows
 * @returns {Object[]}
 */
export function normalizeRows(rows) {
  return rows.map(normalizeRow);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Find the internal key for a raw Google Ads column name.
 * Returns null if no match is found.
 */
function resolveKey(rawKey) {
  const lower = rawKey.toLowerCase().trim();
  for (const { patterns, key } of FIELD_MAP) {
    if (patterns.some(p => lower.includes(p))) {
      return key;
    }
  }
  return null;
}

/**
 * Parse a raw Google Ads metric string into a number.
 * Handles: "1,234"  "12.34%"  "CA$1.23"  "$5.00"  "--" (no data)
 */
function parseMetricValue(raw) {
  if (raw === '--' || raw === '' || raw == null) return 0;

  // Remove currency symbols, spaces, and thousands separators
  let cleaned = String(raw).replace(/[CA$£€,\s]/g, '');

  // Handle percentage values
  if (cleaned.endsWith('%')) {
    return parseFloat(cleaned) || 0;
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? raw : num;
}
