/**
 * schemas.js
 * Defines required and preferred columns for each report type,
 * plus all known column name aliases from Google Ads exports.
 *
 * Column names in Google Ads exports vary slightly by:
 * - language settings
 * - export date range
 * - report type
 * This file centralises all known variants.
 */

// ── Report type identifiers ───────────────────────────────────────────────────

export const REPORT_TYPES = {
  CAMPAIGN:     'campaign',
  AD_GROUP:     'adGroup',
  SEARCH_TERMS: 'searchTerm',
  KEYWORDS:     'keyword',
  ADS:          'ad',
  DEVICES:      'device',
  LOCATION:     'location',
};

// ── Column alias map ──────────────────────────────────────────────────────────
// Maps every known Google Ads column name variant → internal field key.
// More specific patterns first (e.g. "cost / conv." before "cost").

export const COLUMN_ALIASES = [
  // Identity fields
  { aliases: ['campaign'],                                                  field: 'campaign' },
  { aliases: ['ad group', 'adgroup'],                                       field: 'adGroup' },
  { aliases: ['search term', 'search query'],                               field: 'searchTerm' },
  { aliases: ['keyword', 'keyword text'],                                   field: 'keyword' },
  { aliases: ['match type'],                                                field: 'matchType' },
  { aliases: ['device'],                                                    field: 'device' },
  { aliases: ['user location', 'location', 'country/territory'],           field: 'location' },
  { aliases: ['final url', 'destination url'],                             field: 'finalUrl' },
  { aliases: ['description line 1', 'description 1', 'ad description'],   field: 'adDescription' },
  { aliases: ['ad status', 'status'],                                       field: 'adStatus' },

  // Derived cost metrics — must come before bare 'cost' to avoid partial match
  { aliases: ['cost / conv.', 'cost/conv.', 'cost per conv.', 'cost per conversion', 'cost / conversion'], field: 'costPerConversion' },

  // Core performance metrics
  { aliases: ['clicks'],                                                    field: 'clicks' },
  { aliases: ['impressions', 'impr.'],                                      field: 'impressions' },
  { aliases: ['ctr'],                                                       field: 'ctr' },
  { aliases: ['avg. cpc', 'avg cpc', 'average cpc'],                       field: 'avgCpc' },
  { aliases: ['cost'],                                                      field: 'cost' },
  { aliases: ['conv. rate', 'conv rate', 'conversion rate'],               field: 'conversionRate' },
  { aliases: ['conversions'],                                               field: 'conversions' },

  // Campaign impression share metrics
  { aliases: ['search impr. share', 'search impression share'],            field: 'searchImprShare' },
  { aliases: ['search lost is (rank)', 'search lost is (ad rank)'],        field: 'searchLostIsRank' },
  { aliases: ['search lost is (budget)'],                                  field: 'searchLostIsBudget' },

  // Keywords-specific
  { aliases: ['quality score', 'qual. score'],                             field: 'qualityScore' },
];

// ── Schema definitions ────────────────────────────────────────────────────────
// required: analysis is BLOCKED if any of these are missing
// preferred: analysis continues with a WARNING if missing

export const SCHEMAS = {
  [REPORT_TYPES.CAMPAIGN]: {
    label: 'Campaign Report',
    required:  ['campaign', 'clicks', 'impressions', 'cost', 'conversions'],
    preferred: ['ctr', 'avgCpc', 'conversionRate', 'costPerConversion',
                'searchImprShare', 'searchLostIsRank', 'searchLostIsBudget'],
  },

  [REPORT_TYPES.AD_GROUP]: {
    label: 'Ad Group Report',
    required:  ['campaign', 'adGroup', 'clicks', 'impressions', 'cost', 'conversions'],
    preferred: ['ctr', 'avgCpc', 'conversionRate', 'costPerConversion'],
  },

  [REPORT_TYPES.SEARCH_TERMS]: {
    label: 'Search Terms Report',
    required:  ['searchTerm', 'campaign', 'clicks', 'cost', 'conversions'],
    preferred: ['adGroup', 'impressions', 'ctr', 'avgCpc', 'conversionRate',
                'costPerConversion', 'matchType'],
  },

  [REPORT_TYPES.KEYWORDS]: {
    label: 'Keywords Report',
    required:  ['keyword', 'campaign', 'adGroup', 'matchType', 'clicks', 'cost', 'conversions'],
    preferred: ['impressions', 'ctr', 'avgCpc', 'conversionRate', 'costPerConversion', 'qualityScore'],
  },

  [REPORT_TYPES.ADS]: {
    label: 'Ads Report',
    required:  ['campaign', 'adGroup', 'clicks', 'impressions', 'cost', 'conversions'],
    preferred: ['ctr', 'finalUrl', 'adDescription'],
  },

  [REPORT_TYPES.DEVICES]: {
    label: 'Devices Report',
    required:  ['device', 'campaign', 'clicks', 'cost', 'conversions'],
    preferred: ['impressions', 'ctr', 'avgCpc', 'conversionRate', 'costPerConversion'],
  },

  [REPORT_TYPES.LOCATION]: {
    label: 'Location Report',
    required:  ['location', 'campaign', 'clicks', 'cost', 'conversions'],
    preferred: ['impressions', 'ctr', 'avgCpc', 'conversionRate', 'costPerConversion'],
  },
};

// ── Auto-detection signals ────────────────────────────────────────────────────
// Used as a fallback only when the upload slot type is ambiguous.
// Each report type has a set of fields that, if present together, strongly suggest it.

export const DETECTION_SIGNALS = [
  { type: REPORT_TYPES.SEARCH_TERMS, fields: ['searchTerm'] },
  { type: REPORT_TYPES.KEYWORDS,     fields: ['keyword', 'matchType'] },
  { type: REPORT_TYPES.AD_GROUP,     fields: ['adGroup', 'campaign'] },
  { type: REPORT_TYPES.DEVICES,      fields: ['device'] },
  { type: REPORT_TYPES.LOCATION,     fields: ['location'] },
  { type: REPORT_TYPES.ADS,          fields: ['adDescription', 'finalUrl'] },
  { type: REPORT_TYPES.CAMPAIGN,     fields: ['campaign'] },  // weakest signal — check last
];
