/**
 * accountDefaults.js
 * Single source of truth for business configuration defaults.
 *
 * These values are used when no user-supplied context is present.
 * They reflect the real Vancouver garage door account this tool is built for.
 *
 * NOTE: targetCpl intentionally matches thresholds.js cplExcellent (CA$55).
 * If the client's real CPL target changes, update BOTH values together.
 */

export const ACCOUNT_DEFAULTS = {
  /** CA$55 — current real-world CPL target for this account */
  targetCpl:                 55,

  /** Primary service area */
  serviceArea:               'Vancouver, BC',

  /** Services not offered (blank = none excluded) */
  excludedServices:          '',

  /** Preferred lead type (blank = any inbound) */
  preferredLeadType:         '',

  /** Average closed deal value — null until confirmed */
  averageDealValue:          null,

  /**
   * trackingTrusted: null = unknown until verified.
   * Keeping this null forces the system into "caution" measurement state,
   * which is the honest default. Do not set to true without verification.
   */
  trackingTrusted:           null,

  /** Whether offline conversions are imported into Google Ads */
  offlineConversionsImported: false,

  /** Free-text note about what counts as a good lead */
  goodLeadNote:              '',
};
