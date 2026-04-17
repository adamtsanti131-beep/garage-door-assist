/**
 * reportBuilder.js
 * Assembles the final report from rules engine findings.
 * Adds a summary section with account-level metrics.
 */

import {
  pickAccountTotalsSource,
  pickBestPerformerSource,
  sumMetric,
} from './dataSources.js';
import { buildDecisionLayer }       from './decisionEngine.js';
import { buildBusinessInterpretation } from './businessInterpreter.js';

/**
 * @param {Finding[]} findings  — from rulesEngine.runRules()
 * @param {DataSets}  data      — normalized data sets
 * @param {Object}    businessContext
 * @returns {Report}
 */
export function buildReport(findings, data, businessContext = {}, reportStatuses = {}) {
  const actionableFindings = findings.filter(isActionableFinding);
  const summary = buildSummary(actionableFindings, data);
  const decisionLayer = buildDecisionLayer(actionableFindings, data, summary, businessContext, reportStatuses);
  const measurementRisks = deriveMeasurementSection(actionableFindings, decisionLayer);

  // Cross-category dedup: when a measurement risk already explains why an entity
  // has zero leads (likely tracking broken), suppress the waste finding for that
  // same entity. Showing both contradicts the user: one card says "wasted spend",
  // another says "tracking may be broken — we can't trust that zero". Keep the
  // upstream root-cause (measurement) and drop the downstream symptom (waste).
  const waste = suppressWasteCoveredByMeasurement(
    actionableFindings.filter(f => f.category === 'waste'),
    measurementRisks,
  );

  const businessInterpretation = buildBusinessInterpretation(
    businessContext.mondayContext ?? null,
    summary,
    businessContext,
  );

  return {
    timestamp:        new Date().toISOString(),
    summary,
    waste,
    opportunities:    actionableFindings.filter(f => f.category === 'opportunity'),
    controlRisks:     actionableFindings.filter(f => f.category === 'controlRisk'),
    measurementRisks,
    decisions:        decisionLayer.decisions,
    decisionFlow:     decisionLayer,
    topActions:       deriveTopActions(decisionLayer),
    businessInterpretation,
    businessContextUsed: {
      targetCpl: businessContext.targetCpl ?? null,
      serviceArea: businessContext.serviceArea ?? null,
      trackingTrusted: businessContext.trackingTrusted ?? null,
      offlineConversionsImported: businessContext.offlineConversionsImported ?? null,
      mondayContext: businessContext.mondayContext ?? null,
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isActionableFinding(f) {
  return f && (f.severity === 'high' || f.severity === 'medium');
}

// ── Summary ───────────────────────────────────────────────────────────────────

function buildSummary(findings, data) {
  // Use one canonical level only. Never mix overlapping report levels.
  const totalsSource = pickAccountTotalsSource(data);
  const bestSource = pickBestPerformerSource(data);

  const totalSpend       = sumMetric(totalsSource.rows, 'cost');
  const totalConversions = sumMetric(totalsSource.rows, 'conversions');
  const avgCpl           = totalConversions > 0 ? totalSpend / totalConversions : null;
  const totalsSourceConfidence = confidenceForTotalsSource(totalsSource.key);

  const highCount = findings.filter(f => f.severity === 'high').length;
  const bestPerformer = findBestPerformer(bestSource.rows, bestSource.key);

  return {
    totalSpend:       totalSpend   > 0   ? totalSpend       : null,
    totalConversions: totalConversions > 0 ? totalConversions : null,
    avgCpl,
    highSeverityCount: highCount,
    bestPerformer,
    totalsSource: totalsSource.key,
    totalsSourceConfidence,
    totalsSourceNote: totalsSourceGuidance(totalsSource.key),
    bestPerformerSource: bestSource.key,
  };
}

/**
 * Find the single best-performing row (lowest CPL with at least 2 conversions).
 */
function findBestPerformer(rows, sourceKey) {
  const candidates = rows.filter(r =>
    hasValue(r.conversions) && r.conversions >= 2 &&
    hasValue(r.cost) && r.cost > 0
  );
  if (!candidates.length) return null;

  candidates.sort((a, b) => (a.cost / a.conversions) - (b.cost / b.conversions));
  const best = candidates[0];
  const label = best.searchTerm ?? best.keyword ?? best.campaign ?? best.adGroup ?? 'לא ידוע';
  return {
    label,
    cpl:         best.cost / best.conversions,
    conversions: best.conversions,
    cost:        best.cost,
    source:      sourceKey,
  };
}

// ── Top Actions ───────────────────────────────────────────────────────────────

/**
 * Pick the 3 most important actions from decision buckets.
 * This keeps Top Actions aligned with bucket logic and safety classifications.
 */
function deriveTopActions(decisionLayer) {
  const buckets = decisionLayer?.decisionBuckets ?? {};

  const ranked = [
    ...(buckets.immediateActions ?? []),
    ...(buckets.reviewBeforeAction ?? []),
    ...(buckets.secondaryActions ?? []),
    ...(buckets.scaleLater ?? []),
    ...(buckets.doNotTouchYet ?? []),
  ];

  if (ranked.length > 0) {
    return ranked.slice(0, 3).map((d, i) => ({
      priority: i + 1,
      action: d.user_instruction,
      reason: d.reason,
      severity: d.confidence,
      sourceBucket: decideBucketForAction(d),
    }));
  }

  const insufficientCoverage = (decisionLayer?.coverageSummary?.usedHighImpactCount ?? 0) < 2;
  if (insufficientCoverage) {
    return [{
      priority: 1,
      action: 'הנחיית גיבוי: להשלים קודם דוחות חסרים/חסומים בעלי השפעה גבוהה לפני פעולות אופטימיזציה אגרסיביות.',
      reason: 'המלצות חזקות הוחלשו כי כיסוי הדוחות אינו מספיק כדי לתמוך בהחלטות בטוחות.',
      severity: 'low',
      source: 'fallback_insufficient_coverage',
    }];
  }

  return [];
}

// ── Cross-category deduplication ─────────────────────────────────────────────

/**
 * Suppress waste findings when a measurement risk already explains why the same
 * entity has zero leads.
 *
 * Scenario: entity "garage door opener repair" has 60 clicks, 0 leads.
 *   → measurementRisk fires (many-clicks-no-leads, signal: tracking likely broken)
 *   → waste fires (zero-leads-term, signal: zero leads = wasted spend)
 *   These contradict each other. The measurement finding is the root cause.
 *   Suppress the waste finding so the user sees one clear message: fix tracking.
 *
 * Only signals that are specific to the entity-level zero-leads overlap are
 * suppressed. Account-level and ad-group-level waste findings are preserved.
 */
function suppressWasteCoveredByMeasurement(wasteFindings, measurementRisks) {
  // Collect entity names that measurement has already flagged as "tracking broken"
  const measurementEntities = new Set(
    measurementRisks
      .filter(f => f.signal === 'many-clicks-no-leads')
      .map(f => extractEntityName(f.data))
      .filter(Boolean)
  );

  if (!measurementEntities.size) return wasteFindings;

  // Entity-level waste signals that overlap with many-clicks-no-leads
  const SUPPRESSIBLE_WASTE_SIGNALS = new Set([
    'zero-leads-term',       // search term or keyword level
    'non-converting-keyword', // keyword level
  ]);

  return wasteFindings.filter(f => {
    if (!SUPPRESSIBLE_WASTE_SIGNALS.has(f.signal)) return true;
    const entity = extractEntityName(f.data);
    return !entity || !measurementEntities.has(entity);
  });
}

function extractEntityName(data) {
  if (!data) return null;
  const val = data.searchTerm ?? data.keyword ?? data.adGroup ?? data.campaign ?? null;
  return val ? String(val).trim().toLowerCase() : null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasValue(v)    { return v !== null && v !== undefined; }

function confidenceForTotalsSource(sourceKey) {
  if (!sourceKey) return 'low';
  if (sourceKey === 'campaigns' || sourceKey === 'adGroups') return 'high';
  if (sourceKey === 'keywords' || sourceKey === 'searchTerms') return 'medium';
  return 'low';
}

function totalsSourceGuidance(sourceKey) {
  if (!sourceKey) return 'לא נמצא מקור נתונים תקין לסיכומי חשבון.';
  if (sourceKey === 'campaigns' || sourceKey === 'adGroups') {
    return 'סיכומי החשבון מבוססים על מקור בעל אמינות גבוהה.';
  }
  if (sourceKey === 'keywords' || sourceKey === 'searchTerms') {
    return 'סיכומי החשבון מבוססים על מקור חלופי בינוני; מומלץ להעלות גם דוח קמפיינים.';
  }
  return 'סיכומי החשבון מבוססים על מקור חלופי נמוך-אמינות (כמו מכשירים/מיקומים/מודעות). יש לפרש בזהירות.';
}

function deriveMeasurementSection(findings, decisionLayer) {
  const direct = findings.filter(f => f.category === 'measurementRisk');
  if (direct.length > 0) return direct;

  const trust = decisionLayer?.measurementState?.trust ?? 'caution';

  if (trust === 'trusted') return [];

  // No rules fired — this is a guardrail notice, not a data-driven finding.
  // Assign severity 'low' so it is filtered from finding cards by isActionableFinding.
  // The renderer's showIfEmpty + measurementEmptyMessage() handles communicating the trust
  // state to the user without fabricating a fake evidence-backed finding.
  return [{
    category: 'measurementRisk',
    severity: 'low',
    signal: 'measurement-trust-guardrail',
    data: {},
  }];
}

function decideBucketForAction(decision) {
  const safety = decision?.safety_classification;
  if (safety === 'blocked_until_tracking_trusted'
    || safety === 'blocked_until_business_context_provided'
    || safety === 'not_safe_from_csv_alone') {
    return 'hold';
  }
  if (safety === 'review_before_acting') return 'review';
  if (decision?.execution_step === 5) return 'scale';
  if ((decision?.action_priority ?? 9) <= 2 && (decision?.execution_step ?? 9) <= 2) return 'immediate';
  return 'secondary';
}
