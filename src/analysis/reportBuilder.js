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
import { buildDecisionLayer } from './decisionEngine.js';

/**
 * @param {Finding[]} findings  — from rulesEngine.runRules()
 * @param {DataSets}  data      — normalized data sets
 * @param {Object}    businessContext
 * @returns {Report}
 */
export function buildReport(findings, data, businessContext = {}, reportStatuses = {}) {
  const summary = buildSummary(findings, data);
  const decisionLayer = buildDecisionLayer(findings, data, summary, businessContext, reportStatuses);

  return {
    timestamp:        new Date().toISOString(),
    summary,
    waste:            findings.filter(f => f.category === 'waste'),
    opportunities:    findings.filter(f => f.category === 'opportunity'),
    controlRisks:     findings.filter(f => f.category === 'controlRisk'),
    measurementRisks: findings.filter(f => f.category === 'measurementRisk'),
    decisions:        decisionLayer.decisions,
    decisionFlow:     decisionLayer,
    topActions:       deriveTopActions(findings, decisionLayer),
    businessContextUsed: {
      targetCpl: businessContext.targetCpl ?? null,
      serviceArea: businessContext.serviceArea ?? null,
      trackingTrusted: businessContext.trackingTrusted ?? null,
      offlineConversionsImported: businessContext.offlineConversionsImported ?? null,
    },
  };
}

// ── Summary ───────────────────────────────────────────────────────────────────

function buildSummary(findings, data) {
  // Use one canonical level only. Never mix overlapping report levels.
  const totalsSource = pickAccountTotalsSource(data);
  const bestSource = pickBestPerformerSource(data);

  const totalSpend       = sumMetric(totalsSource.rows, 'cost');
  const totalConversions = sumMetric(totalsSource.rows, 'conversions');
  const avgCpa           = totalConversions > 0 ? totalSpend / totalConversions : null;
  const totalsSourceConfidence = confidenceForTotalsSource(totalsSource.key);

  const highCount = findings.filter(f => f.severity === 'high').length;
  const bestPerformer = findBestPerformer(bestSource.rows, bestSource.key);

  return {
    totalSpend:       totalSpend   > 0   ? totalSpend       : null,
    totalConversions: totalConversions > 0 ? totalConversions : null,
    avgCpa,
    highSeverityCount: highCount,
    bestPerformer,
    totalsSource: totalsSource.key,
    totalsSourceConfidence,
    totalsSourceNote: totalsSourceGuidance(totalsSource.key),
    bestPerformerSource: bestSource.key,
  };
}

/**
 * Find the single best-performing row (lowest CPA with at least 2 conversions).
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
    cpa:         best.cost / best.conversions,
    conversions: best.conversions,
    cost:        best.cost,
    source:      sourceKey,
  };
}

// ── Top Actions ───────────────────────────────────────────────────────────────

/**
 * Pick the 3 most important actions from findings.
 * Priority: high severity first, then by category order.
 */
function deriveTopActions(findings, decisionLayer) {
  const immediate = decisionLayer?.decisionBuckets?.immediateActions ?? [];
  if (immediate.length > 0) {
    return immediate.slice(0, 3).map((d, i) => ({
      priority: i + 1,
      action: d.user_instruction,
      reason: d.reason,
      severity: d.confidence,
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

  const catPriority = { measurementRisk: 0, waste: 1, controlRisk: 2, opportunity: 3 };
  const sevPriority = { high: 0, medium: 1, low: 2 };

  const sorted = [...findings].sort((a, b) => {
    const s = sevPriority[a.severity] - sevPriority[b.severity];
    if (s !== 0) return s;
    return (catPriority[a.category] ?? 9) - (catPriority[b.category] ?? 9);
  });

  const top = sorted.slice(0, 3);

  const actions = top.map((f, i) => ({
    priority: i + 1,
    action:   f.action,
    reason:   f.what,
    severity: f.severity,
  }));

  return actions;
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
