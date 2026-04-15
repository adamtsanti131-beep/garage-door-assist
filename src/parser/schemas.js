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
// Aliases are matched with lower-cased exact equality OR substring includes.

export const COLUMN_ALIASES = [
  // Identity fields
  { aliases: ['campaign', 'campaign name'],                                              field: 'campaign' },
  { aliases: ['ad group', 'adgroup', 'ad group name'],                                  field: 'adGroup' },
  { aliases: ['search term', 'search query', 'search terms'],                           field: 'searchTerm' },
  // 'search keyword' must come before bare 'keyword' to win the includes check
  { aliases: ['search keyword'],                                                         field: 'keyword' },
  { aliases: ['keyword', 'keyword text'],                                                field: 'keyword' },
  { aliases: ['match type', 'search term match type', 'keyword match type'],            field: 'matchType' },
  { aliases: ['device'],                                                                 field: 'device' },
  { aliases: ['user location', 'location', 'matched location', 'country/territory'],   field: 'location' },
  { aliases: ['final url', 'destination url'],                                          field: 'finalUrl' },
  // 'description 1' must come before bare 'description' to avoid false ads-header match
  { aliases: ['description line 1', 'description 1', 'ad description'],               field: 'adDescription' },
  { aliases: ['ad status', 'status'],                                                   field: 'adStatus' },

  // Derived cost metrics — must come before bare 'cost' to avoid partial match
  { aliases: ['cost / conv.', 'cost/conv.', 'cost per conv.', 'cost per conversion',
              'cost / conversion', 'cost / all conv.'],                                 field: 'costPerConversion' },

  // Core performance metrics
  { aliases: ['clicks', 'interactions'],                                                field: 'clicks' },
  { aliases: ['impressions', 'impr.', 'impr'],                                          field: 'impressions' },
  { aliases: ['ctr', 'click-through rate'],                                             field: 'ctr' },
  { aliases: ['avg. cpc', 'avg cpc', 'average cpc'],                                   field: 'avgCpc' },
  { aliases: ['cost', 'amount spent', 'spend'],                                        field: 'cost' },
  { aliases: ['conv. rate', 'conv rate', 'conversion rate', 'cvr'],                   field: 'conversionRate' },
  { aliases: ['conversions'],                                                           field: 'conversions' },

  // Campaign impression share metrics
  { aliases: ['search impr. share', 'search impression share'],                        field: 'searchImprShare' },
  { aliases: ['search lost is (rank)', 'search lost is (ad rank)',
              'search lost top is (rank)', 'search lost top is (ad rank)'],            field: 'searchLostIsRank' },
  { aliases: ['search lost is (budget)'],                                              field: 'searchLostIsBudget' },

  // Keywords-specific
  { aliases: ['quality score', 'qual. score'],                                         field: 'qualityScore' },
];

// ── Schema definitions ────────────────────────────────────────────────────────
// required: analysis is BLOCKED if any of these are missing
// preferred: analysis continues with a WARNING if missing
//
// Design rationale (real Google Ads export compatibility):
//   - "campaign" is absent from Ad Group, Search Terms, Keywords, Location, and
//     some Device exports — it MUST NOT be required for those report types.
//   - "clicks" is absent from the Campaign export but cost + conversions suffice
//     for all campaign-level analysis rules.
//   - For Ads, only impressions/cost/conversions are reliably present; campaign
//     and ad group names appear in the Ad group column but routing is slot-based.
//   Fields downgraded to preferred still appear in warnings so the user knows
//   what insights may be reduced, but they no longer block analysis.

export const SCHEMAS = {
  [REPORT_TYPES.CAMPAIGN]: {
    label: 'דוח קמפיינים',
    // clicks absent from real Campaign export — downgraded to preferred
    required:  ['campaign', 'cost', 'conversions'],
    preferred: ['clicks', 'impressions', 'ctr', 'avgCpc', 'conversionRate',
                'costPerConversion', 'searchImprShare', 'searchLostIsRank',
                'searchLostIsBudget'],
  },

  [REPORT_TYPES.AD_GROUP]: {
    label: 'דוח קבוצות מודעות',
    // campaign + clicks absent from real Ad Group export
    required:  ['adGroup', 'cost', 'conversions'],
    preferred: ['campaign', 'clicks', 'impressions', 'ctr', 'avgCpc',
                'conversionRate', 'costPerConversion'],
  },

  [REPORT_TYPES.SEARCH_TERMS]: {
    label: 'דוח מונחי חיפוש',
    // campaign absent from real Search Terms export
    required:  ['searchTerm', 'clicks', 'cost', 'conversions'],
    preferred: ['campaign', 'adGroup', 'impressions', 'ctr', 'avgCpc',
                'conversionRate', 'costPerConversion', 'matchType'],
  },

  [REPORT_TYPES.KEYWORDS]: {
    label: 'דוח מילות מפתח',
    // campaign absent from some real Keyword exports; adGroup and matchType preferred
    required:  ['keyword', 'clicks', 'cost', 'conversions'],
    preferred: ['campaign', 'adGroup', 'matchType', 'impressions', 'ctr',
                'avgCpc', 'conversionRate', 'costPerConversion', 'qualityScore'],
  },

  [REPORT_TYPES.ADS]: {
    label: 'דוח מודעות',
    // campaign/adGroup absent as mapped fields in the real Ads export structure;
    // adGroup column present but named just "Ad group"; impressions+cost+conversions
    // are sufficient for weak-ad detection and CTR-based rules.
    required:  ['impressions', 'cost', 'conversions'],
    preferred: ['campaign', 'adGroup', 'clicks', 'ctr', 'finalUrl', 'adDescription'],
  },

  [REPORT_TYPES.DEVICES]: {
    label: 'דוח מכשירים',
    // campaign absent from some Device exports
    required:  ['device', 'cost', 'conversions'],
    preferred: ['campaign', 'clicks', 'impressions', 'ctr', 'avgCpc',
                'conversionRate', 'costPerConversion'],
  },

  [REPORT_TYPES.LOCATION]: {
    label: 'דוח מיקומים',
    // campaign absent from real Location export
    required:  ['location', 'cost', 'conversions'],
    preferred: ['campaign', 'clicks', 'impressions', 'ctr', 'avgCpc',
                'conversionRate', 'costPerConversion'],
  },
};

// ── Auto-detection signals ────────────────────────────────────────────────────
// Used ONLY when the upload slot type is ambiguous (should be rare — routing is
// always slot-first).  A mismatch warning is shown only when detection is
// STRONG AND CONFIDENT — that is, more than half the detection signals point
// to a different type.
//
// Signal priority reflects specificity:
//   searchTerm / keyword+matchType are uniquely identifying.
//   device is uniquely identifying (a field that only exists in Device exports).
//   location is uniquely identifying.
//   adDescription / finalUrl together are uniquely identifying.
//   adGroup alone is NOT uniquely identifying — it also appears in Device reports.
//   campaign alone is the weakest signal — present in almost every report type.

export const DETECTION_SIGNALS = [
  { type: REPORT_TYPES.SEARCH_TERMS, fields: ['searchTerm'],              strength: 3 },
  { type: REPORT_TYPES.KEYWORDS,     fields: ['keyword', 'matchType'],    strength: 3 },
  { type: REPORT_TYPES.DEVICES,      fields: ['device'],                  strength: 3 },
  { type: REPORT_TYPES.LOCATION,     fields: ['location'],                strength: 3 },
  { type: REPORT_TYPES.ADS,          fields: ['adDescription', 'finalUrl'], strength: 2 },
  { type: REPORT_TYPES.AD_GROUP,     fields: ['adGroup'],                 strength: 1 },
  { type: REPORT_TYPES.CAMPAIGN,     fields: ['campaign'],                strength: 1 },  // weakest
];
