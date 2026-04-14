/**
 * thresholds.js
 * Configurable thresholds for the rules engine.
 * Tuned for a garage door repair/installation account in Vancouver, BC.
 * Monthly spend: CAD 5,000–7,000 | Main conversions: calls + forms
 */

export const THRESHOLDS = {

  // ── Minimum spend/clicks before flagging anything ─────────────────────────
  // Avoids noisy alerts on terms that just started
  minSpendToFlag:        25,    // CAD — don't flag waste below this
  minClicksToJudge:       8,    // clicks — minimum before evaluating a keyword
  minImpressionsForCtr:  50,    // impressions — minimum before flagging low CTR

  // ── CPA benchmarks (CAD) ──────────────────────────────────────────────────
  cpaExcellent:           80,   // below this → strong winner, scale up
  cpaAcceptable:         150,   // below this → acceptable, monitor
  cpaPoor:               220,   // above this → flag for review or pause

  // ── Waste detection ───────────────────────────────────────────────────────
  wastedSpendWarnPct:    0.20,  // 20% of total spend with 0 conversions → warning
  wastedSpendCritPct:    0.35,  // 35% → high severity

  // ── Winners ───────────────────────────────────────────────────────────────
  minConversionsWinner:   2,    // at least 2 conversions to be called a winner
  strongConvRatePct:      5.0,  // conv. rate above this → scaling opportunity

  // ── CTR ───────────────────────────────────────────────────────────────────
  lowCtrPct:              2.0,  // CTR below this on non-brand terms → relevance issue

  // ── Measurement risks ─────────────────────────────────────────────────────
  highClicksNoConvLimit:  20,   // clicks without any conversion → possible tracking gap
  convExceedsClicksRatio: 1.0,  // conversions/clicks above 1.0 → tracking misconfiguration

  // ── Impression share thresholds ───────────────────────────────────────────
  lowImprShareWarn:      0.40,  // IS below 40% on a converting campaign → missing volume
  highLostIsBudgetWarn:  0.20,  // lost IS (budget) above 20% → budget is limiting wins

  // ── Quality Score ─────────────────────────────────────────────────────────
  lowQualityScore:        4,    // QS below this → structural issue, costs are inflated
};
