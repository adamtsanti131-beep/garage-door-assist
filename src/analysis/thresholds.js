/**
 * thresholds.js
 * Configurable thresholds for the rules engine — lead-generation focus.
 * Tuned for garage door repair/installation account in Vancouver, BC.
 * Metrics: CPL (Cost Per Lead), not profitability or revenue.
 * Leads = Google Ads conversions (calls, form submissions) only.
 */

export const THRESHOLDS = {

  // ── CPL ZONES (עלות לליד) — in CAD ────────────────────────────────────────
  cplExcellent:            55,   // <= 55  — strong leader, protect budget
  cplGood:                 75,   // 56–75 — good performer, maintain
  cplBorderline:           95,   // 76–95 — borderline, watch closely
  cplExpensive:           120,   // 96–120 — expensive, reduce or test
  cplPoor:                150,   // 121–150 — poor, flag for review
  cplSevere:              150,   // > 150 — severe, immediate attention

  // ── WASTE DETECTION — zero leads ──────────────────────────────────────────
  // Tier HIGH  (act now):  cost >= minSpendForWaste AND clicks >= 3,
  //                     OR clicks >= minClicksForWaste
  // Tier MEDIUM (watch):   clicks 5–14 AND cost >= minSpendForSoftCaution
  //                     OR cost >= minSpendWithClicksGate AND clicks 5–14
  // Tier NONE  (suppress): clicks < 5
  minSpendForWaste:        75,   // CAD — hard waste tier, spend threshold
  minClicksForWaste:       15,   // clicks — hard waste tier, click threshold
  minSpendWithClicksGate:  50,   // CAD — hard waste combined gate
  minClicksForSoftCaution:  5,   // clicks — soft watch tier starts here
  minSpendForSoftCaution:  20,   // CAD — minimum spend to show soft watch

  // ── DATA SUFFICIENCY ──────────────────────────────────────────────────────
  minClicksForJudgment:           5,   // basic judgment threshold
  minClicksForConfidentJudgment:  15,  // strong judgment (pause, cut bid)
  minImpressionsForCtr:           50,  // CTR judgment gate
  minImpressionsForQS:            50,  // Quality Score judgment gate

  // ── LEADS & SCALING ───────────────────────────────────────────────────────
  minLeadsForScaling:             3,   // need 3+ leads to recommend scaling
  minLeadsForWinner:              3,   // need 3+ leads to call "strong performer"
  strongConvRatePct:              5.0, // 5%+ lead rate = high-intent signal

  // ── QUALITY SIGNALS ───────────────────────────────────────────────────────
  lowQualityScore:                4,   // QS < 4 = flag (only if impressions >= 50)
  lowCtrPct:                      1.5, // CTR < 1.5% = flag (only if impressions >= 50)
  lowImprShareWarn:               0.40, // IS < 40% on converting campaigns
  highLostIsBudgetWarn:           0.30, // > 30% lost to budget limit

  // ── MEASUREMENT RISKS ─────────────────────────────────────────────────────
  minClicksNoLeadsForTracking:    50,  // 50+ clicks with 0 leads = high-confidence tracking gap (stricter than waste thresholds)

  // ── ACCOUNT-LEVEL WASTE ───────────────────────────────────────────────────
  wastedSpendWarnPct:             0.15, // 15% of total spend with 0 leads = warning
  wastedSpendCritPct:             0.25, // 25% of total spend with 0 leads = critical
};
