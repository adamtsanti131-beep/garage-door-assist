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
  const opportunities = buildOpportunitiesSection(findings, decisionLayer, businessContext, measurementRisks);
  const measurementTrust = decisionLayer?.measurementState?.trust ?? 'caution';

  // Cross-category dedup: when a measurement risk already explains why an entity
  // has zero leads (likely tracking broken), suppress the waste finding for that
  // same entity. Showing both contradicts the user: one card says "wasted spend",
  // another says "tracking may be broken — we can't trust that zero". Keep the
  // upstream root-cause (measurement) and drop the downstream symptom (waste).
  const waste = normalizeWasteSection(
    suppressWasteCoveredByMeasurement(
      actionableFindings.filter(f => f.category === 'waste'),
      measurementRisks,
    ),
    measurementTrust,
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
    opportunities,
    controlRisks:     normalizeControlSection(
      actionableFindings.filter(f => f.category === 'controlRisk'),
      measurementTrust,
    ),
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

function buildOpportunitiesSection(findings, decisionLayer, businessContext, measurementRisks) {
  const measurementTrust = decisionLayer?.measurementState?.trust ?? 'caution';
  const hasExplicitTrackingIssue = (measurementRisks ?? []).some(r =>
    r?.severity === 'high'
    || r?.signal === 'many-clicks-no-leads'
    || r?.signal === 'conversions-exceed-clicks'
    || r?.signal === 'account-zero-conversions'
    || r?.signal === 'missing-campaign-conversions'
  );

  const source = (findings ?? [])
    .filter(f => f?.category === 'opportunity')
    .filter(f => hasPositiveCost(f?.data?.cost));

  const deduped = dedupeOpportunities(source);
  const sorted = deduped.sort((a, b) => scoreOpportunityFinding(b) - scoreOpportunityFinding(a));

  const actionableNow = [];
  const reviewBeforeActing = [];
  const blockedByMissingBusinessContext = [];
  const weakInsufficientSample = [];

  for (const item of sorted) {
    const normalized = normalizeOpportunityFinding(item, measurementTrust, hasExplicitTrackingIssue);

    if (isWeakOpportunity(normalized)) {
      if (weakInsufficientSample.length < 3) weakInsufficientSample.push(normalized);
      continue;
    }

    if (isBlockedByMissingContext(normalized, businessContext)) {
      if (blockedByMissingBusinessContext.length < 3) {
        blockedByMissingBusinessContext.push(toBlockedContextOpportunity(normalized, businessContext));
      }
      continue;
    }

    if (measurementTrust === 'caution' || isReviewOnlyOpportunity(normalized)) {
      if (reviewBeforeActing.length < 4) reviewBeforeActing.push(toReviewOnlyOpportunity(normalized));
      continue;
    }

    if (actionableNow.length < 4) actionableNow.push(normalized);
  }

  return {
    actionableNow,
    reviewBeforeActing,
    blockedByMissingBusinessContext,
    weakInsufficientSample,
  };
}

function normalizeOpportunityFinding(item, measurementTrust, hasExplicitTrackingIssue) {
  if (measurementTrust !== 'caution') return item;

  const row = item?.data ?? {};
  const entityLabel = row.searchTerm ?? row.keyword ?? row.campaign ?? row.device ?? row.location ?? 'הישות הרלוונטית';

  const conservativeAction = hasExplicitTrackingIssue
    ? 'blocked_until_tracking_trusted: אמון המדידה חלקי ויש לפתור תחילה את מהימנות המעקב לפני כל סקייל.'
    : item.signal === 'high-intent-device'
      ? `review_before_acting: לבצע בדיקה קטנה ומדורגת בלבד בהתאמות מכשיר עבור "${entityLabel}", ואז לוודא יציבות המרות לפני הרחבה.`
      : item.signal === 'high-intent-location'
        ? `review_before_acting: לבצע בדיקה קטנה ומדורגת בלבד באזור גאוגרפי עבור "${entityLabel}", תוך ניטור איכות לידים לפני הרחבה.`
        : item.signal === 'budget-limited-winner'
          ? `review_before_acting: לבצע הגדלה קטנה בלבד של תקציב בקמפיין "${entityLabel}", ולבדוק שהעלות לליד נשארת יציבה.`
          : item.signal === 'outperforming-campaign' || item.signal === 'strong-leader'
            ? `review_before_acting: לבצע בדיקה מדורגת עבור "${entityLabel}" באמצעות התאמת הצעת מחיר קטנה, ורק לאחר מכן לשקול הרחבה.`
            : item.signal === 'scale-candidate'
              ? `review_before_acting: לבצע בדיקת סקייל קטנה בלבד עבור "${entityLabel}" לאחר אימות יציבות המדידה.`
            : item.severity === 'high'
              ? 'review_before_acting: לא זוהתה שגיאת מעקב חד-משמעית, אך אמון המדידה חלקי ולכן יש לפעול בזהירות.'
              : 'small_test_only: לא זוהתה שגיאת מעקב חד-משמעית, אך אמון המדידה חלקי ולכן מותרת בדיקה קטנה בלבד.';

  const conservativeWhy = hasExplicitTrackingIssue
    ? 'אות חיובי שראוי לבדיקה זהירה בלבד עד להשלמת תיקוף מדידה.'
    : item.severity === 'high'
      ? 'אות חיובי שראוי לבדיקה זהירה. מועמד לבדיקה מדורגת ולא לסקייל מיידי.'
      : 'מועמד לבדיקה מדורגת. אפשר לשקול בדיקה קטנה לאחר אימות יציבות המדידה.';

  return {
    ...item,
    action: conservativeAction,
    why: conservativeWhy,
  };
}

function isBlockedByMissingContext(item, businessContext) {
  if (businessContext?.targetCpl == null) return true;
  if (item?.signal === 'high-intent-location' && !businessContext?.serviceArea) return true;
  return false;
}

function toBlockedContextOpportunity(item, businessContext) {
  const blockedBy = businessContext?.targetCpl == null
    ? 'targetCpl'
    : (!businessContext?.serviceArea && item?.signal === 'high-intent-location')
      ? 'serviceArea'
      : 'businessContext';

  const action = blockedBy === 'targetCpl'
    ? 'blocked_until_business_context_provided: חסר יעד עלות לליד ולכן ההמלצה אינה ניתנת לביצוע כרגע.'
    : blockedBy === 'serviceArea'
      ? 'blocked_until_business_context_provided: חסר אזור שירות ולכן הרחבה גאוגרפית אינה ניתנת לביצוע כרגע.'
      : 'blocked_until_business_context_provided: חסר הקשר עסקי חיוני ולכן אין לפעול כעת.';

  return {
    ...item,
    action,
  };
}

function toReviewOnlyOpportunity(item) {
  const action = startsWithActionPrefix(item?.action, 'small_test_only')
    || startsWithActionPrefix(item?.action, 'review_before_acting')
    ? item.action
    : 'review_before_acting: לבצע בדיקה קטנה ומדורגת בלבד לאחר אימות יציבות המדידה, בלי סקייל רחב.';

  return {
    ...item,
    action,
  };
}

function isWeakOpportunity(item) {
  return item?.severity === 'low' || item?.signal === 'insufficient-sample';
}

function hasPositiveCost(cost) {
  return typeof cost === 'number' && cost > 0;
}

function scoreOpportunityFinding(item) {
  const row = item?.data ?? {};
  const severity = item?.severity === 'high' ? 3 : item?.severity === 'medium' ? 2 : 1;
  const conv = Math.min(3, Math.floor((row.conversions ?? 0) / 2));
  const spend = row.cost >= 120 ? 2 : row.cost >= 60 ? 1 : 0;
  const clicks = row.clicks >= 25 ? 2 : row.clicks >= 15 ? 1 : 0;
  return severity + conv + spend + clicks;
}

function dedupeOpportunities(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const row = item?.data ?? {};
    const key = [
      item?.signal ?? 'unknown',
      normalizeText(row.searchTerm ?? row.keyword ?? row.campaign ?? row.device ?? row.location ?? 'unknown'),
    ].join('::');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function isReviewOnlyOpportunity(item) {
  return startsWithActionPrefix(item?.action, 'review_before_acting')
    || startsWithActionPrefix(item?.action, 'small_test_only');
}

function startsWithActionPrefix(action, prefix) {
  return String(action ?? '').trim().toLowerCase().startsWith(`${prefix}:`);
}

function normalizeWasteSection(wasteFindings, measurementTrust) {
  if (measurementTrust !== 'caution') return wasteFindings;

  return wasteFindings.map(item => {
    if (item.signal === 'wasted-spend-share') {
      const source = item?.data?.source;
      return {
        ...item,
        action: source === 'searchTerms'
          ? 'לבצע ניקוי מונחי חיפוש באופן מדורג: לזהות שאילתות לא רלוונטיות, להוסיף שלילות ממוקדות, ולהפחית חשיפה רק לקבוצות שממשיכות ללא לידים.'
          : 'לבצע בדיקה שמרנית של ישויות עם 0 לידים: לאמת מעקב המרות, לבדוק כוונת חיפוש ודף נחיתה, ולהפחית חשיפה בהדרגה לפני עצירה.',
      };
    }

    return item;
  });
}

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeControlSection(controlFindings, measurementTrust) {
  if (measurementTrust !== 'caution') return controlFindings;

  return controlFindings.map(item => {
    if (item.signal === 'non-converting-campaign') {
      return {
        ...item,
        action: 'לבצע בדיקה שמרנית של הקמפיין: לאמת מעקב המרות, לבדוק כוונת חיפוש ודף נחיתה, ולהפחית חשיפה בהדרגה לפני עצירה.',
      };
    }

    if (item.signal === 'low-quality-score') {
      return {
        ...item,
        action: 'לבדוק רלוונטיות בין מונח החיפוש, נוסח המודעה ודף הנחיתה, לשפר התאמות מסר, ולעדכן מודעות באופן מדורג לפני שינוי רחב.',
      };
    }

    return item;
  });
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
