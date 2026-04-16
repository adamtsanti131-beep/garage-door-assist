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
  const actionableFindings = findings.filter(isActionableFinding);
  const summary = buildSummary(actionableFindings, data);
  const decisionLayer = buildDecisionLayer(actionableFindings, data, summary, businessContext, reportStatuses);
  const measurementRisks = deriveMeasurementSection(actionableFindings, decisionLayer);

  return {
    timestamp:        new Date().toISOString(),
    summary,
    waste:            actionableFindings.filter(f => f.category === 'waste'),
    opportunities:    actionableFindings.filter(f => f.category === 'opportunity'),
    controlRisks:     actionableFindings.filter(f => f.category === 'controlRisk'),
    measurementRisks,
    decisions:        decisionLayer.decisions,
    decisionFlow:     decisionLayer,
    topActions:       deriveTopActions(decisionLayer),
    businessContextUsed: {
      targetCpl: businessContext.targetCpl ?? null,
      serviceArea: businessContext.serviceArea ?? null,
      trackingTrusted: businessContext.trackingTrusted ?? null,
      offlineConversionsImported: businessContext.offlineConversionsImported ?? null,
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
  const reasons = decisionLayer?.measurementState?.reasons ?? [];

  if (trust === 'trusted') return [];

  return [{
    category: 'measurementRisk',
    severity: trust === 'untrusted' ? 'high' : 'medium',
    what: trust === 'untrusted'
      ? 'אמון המדידה במצב לא אמין, ולכן פעולות משמעותיות נחסמות עד לתיקון.'
      : 'אמון המדידה במצב זהירות, ולכן ההמלצות שמרניות יותר ודורשות בדיקה.',
    why: reasons.length > 0
      ? reasons.join(' | ')
      : 'רמת האמון במדידה אינה במצב trusted ולכן נדרש ניהול שמרני יותר.',
    action: trust === 'untrusted'
      ? 'לתקן תחילה את הגדרות ההמרה והמעקב לפני כל סקייל או שינוי משמעותי.'
      : 'לבצע שינויים מדורגים בלבד ולאמת יציבות המרות לפני סקייל אגרסיבי.',
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
