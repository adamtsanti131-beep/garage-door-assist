/**
 * decisionEngine.js
 * Converts findings into an ordered decision-support plan for non-expert users.
 */

const REPORT_ROLE_MAP = {
  campaign: {
    key: 'campaigns',
    label: 'Campaign',
    usedFor: 'Account totals, winners/losers, impression-share constraints',
    importance: 'high',
  },
  adGroup: {
    key: 'adGroups',
    label: 'Ad Group',
    usedFor: 'Group-level waste and structure control',
    importance: 'high',
  },
  searchTerm: {
    key: 'searchTerms',
    label: 'Search Terms',
    usedFor: 'Negative keyword opportunities and intent quality checks',
    importance: 'high',
  },
  keyword: {
    key: 'keywords',
    label: 'Keywords',
    usedFor: 'Match-type control, quality, CPC/CPA efficiency',
    importance: 'high',
  },
  ad: {
    key: 'ads',
    label: 'Ads',
    usedFor: 'Ad relevance and copy quality indicators',
    importance: 'medium',
  },
  device: {
    key: 'devices',
    label: 'Devices',
    usedFor: 'Device-specific waste/winner patterns',
    importance: 'medium',
  },
  location: {
    key: 'locations',
    label: 'Location',
    usedFor: 'Geo-specific waste/winner patterns',
    importance: 'medium',
  },
};

const DECISION_STEPS = [
  'Step 1: Verify tracking and measurement trust',
  'Step 2: Stop waste now',
  'Step 3: Tighten control and account structure',
  'Step 4: Improve ads, relevance, and quality',
  'Step 5: Scale proven winners carefully',
];

export function buildDecisionLayer(findings, data, summary, businessContext) {
  const reportCoverage = buildReportCoverage(data);
  const reportCoverageByKey = Object.fromEntries(reportCoverage.map(r => [r.reportKey, r]));
  const missingReports = reportCoverage.filter(r => !r.present).map(r => r.label);
  const missingBusinessContext = findMissingBusinessContext(businessContext);

  const measurementTrust = evaluateMeasurementTrust(findings, businessContext);
  const decisions = findings.map(f =>
    findingToDecision(
      f,
      measurementTrust,
      missingBusinessContext,
      businessContext,
      reportCoverageByKey
    )
  );

  // Add direct dataset-based guidance so all 7 report types influence outcomes.
  decisions.push(...buildDatasetDrivenDecisions(
    data,
    measurementTrust,
    businessContext,
    reportCoverageByKey,
  ));
  decisions.push(...buildContextDrivenDecisions(
    data,
    measurementTrust,
    businessContext,
    reportCoverageByKey,
  ));
  decisions.push(...buildGuardrailDecisions(
    measurementTrust,
    missingReports,
    missingBusinessContext,
    businessContext,
    reportCoverageByKey,
  ));

  const sorted = decisions.sort((a, b) => {
    if (a.execution_step !== b.execution_step) return a.execution_step - b.execution_step;
    if (a.action_priority !== b.action_priority) return a.action_priority - b.action_priority;
    return confidenceRank(a.confidence) - confidenceRank(b.confidence);
  });

  const buckets = bucketDecisions(sorted);

  return {
    accountStatus: buildAccountStatus(measurementTrust, sorted, missingReports, missingBusinessContext),
    decisionOrder: DECISION_STEPS,
    decisions: sorted,
    decisionBuckets: buckets,
    missingReports,
    missingBusinessContext,
    reportCoverage,
    knowledgeBoundaries: buildKnowledgeBoundaries(measurementTrust, businessContext, reportCoverage),
    summaryGuidance: {
      canActImmediately: measurementTrust !== 'untrusted' && buckets.immediateActions.length > 0,
      blockedUntilTrackingTrusted: measurementTrust === 'untrusted',
      note: buildSummaryNote(measurementTrust, buckets),
      totalSpend: summary?.totalSpend ?? null,
      avgCpa: summary?.avgCpa ?? null,
    },
  };
}

function buildReportCoverage(data) {
  return Object.values(REPORT_ROLE_MAP).map(info => {
    const rows = data[info.key] ?? [];
    return {
      reportKey: info.key,
      label: info.label,
      present: rows.length > 0,
      rowCount: rows.length,
      usedFor: info.usedFor,
      importance: info.importance,
      impactIfMissing: rows.length > 0
        ? null
        : info.importance === 'high'
          ? 'Confidence drops for high-impact decisions.'
          : 'Decision detail is reduced, but core guidance can still run.',
    };
  });
}

function findMissingBusinessContext(context) {
  const missing = [];
  if (context.targetCpl == null) missing.push('targetCpl');
  if (!context.serviceArea) missing.push('serviceArea');
  if (context.trackingTrusted == null) missing.push('trackingTrusted');
  if (context.offlineConversionsImported == null) missing.push('offlineConversionsImported');
  return missing;
}

function evaluateMeasurementTrust(findings, context) {
  const measurement = findings.filter(f => f.category === 'measurementRisk');
  const highCount = measurement.filter(f => f.severity === 'high').length;

  if (context.trackingTrusted === false) return 'untrusted';
  if (highCount >= 1) return 'untrusted';
  if (measurement.length > 0 || context.trackingTrusted == null) return 'caution';
  return 'trusted';
}

function findingToDecision(
  finding,
  measurementTrust,
  missingBusinessContext,
  context,
  reportCoverageByKey,
) {
  const step = mapStep(finding);
  const actionType = mapActionType(finding);
  const entity = resolveEntity(finding.data);
  const confidence = estimateConfidence(
    finding,
    actionType,
    measurementTrust,
    context,
    reportCoverageByKey,
  );
  const blockedByTracking = measurementTrust === 'untrusted' && step > 1;
  const requiresBusinessContext = requiresContext(actionType, finding, missingBusinessContext);
  const safetyClassification = deriveSafetyClassification({
    finding,
    confidence,
    blockedByTracking,
    requiresBusinessContext,
    measurementTrust,
    reportCoverageByKey,
  });
  const reviewRequired = safetyClassification === 'review_before_acting';
  const evidenceState = resolveEvidenceState(confidence, requiresBusinessContext, blockedByTracking);
  const operatorSteps = buildOperatorSteps(finding, entity, context);

  return {
    action_type: actionType,
    action_priority: mapPriority(finding, step),
    execution_step: step,
    confidence,
    category: finding.category,
    entity_level: entity.level,
    entity_name: entity.name,
    reason: finding.why,
    evidence: buildEvidence(finding),
    evidence_state: evidenceState,
    prerequisite: blockedByTracking
      ? 'Resolve measurement trust issues before acting on this item.'
      : requiresBusinessContext
        ? 'Provide missing business context before final action.'
        : 'No blocking prerequisite.',
    user_instruction: finding.action,
    expected_outcome: expectedOutcomeFor(finding.category),
    risk_if_ignored: riskIfIgnoredFor(finding.category),
    do_not_do_yet: safetyClassification === 'not_safe_from_csv_alone'
      || safetyClassification === 'blocked_until_tracking_trusted'
      || safetyClassification === 'blocked_until_business_context_provided',
    requires_business_context: requiresBusinessContext,
    blocked_by_tracking: blockedByTracking,
    review_required_before_action: reviewRequired,
    safety_classification: safetyClassification,
    operator_steps: operatorSteps,
    monitor_after_change: buildMonitorGuidance(finding),
    reassess_timing: 'Re-upload refreshed reports in 3-7 days after changes, or sooner if spend is high.',
  };
}

function mapStep(finding) {
  if (finding.category === 'measurementRisk') return 1;
  if (finding.category === 'waste') return 2;
  if (finding.category === 'controlRisk') {
    if (finding.signal === 'low-quality-score' || finding.signal === 'low-impression-share') return 4;
    return 3;
  }
  return 5;
}

function mapActionType(finding) {
  const bySignal = {
    'account-zero-conversions': 'tracking_fix',
    'conversions-exceed-clicks': 'tracking_fix',
    'missing-campaign-conversions': 'tracking_fix',
    'wasted-spend-share': 'stop_waste',
    'non-converting-keyword': 'keyword_control',
    'non-converting-adgroup': 'adgroup_control',
    'broad-match-risk': 'match_type_control',
    'low-quality-score': 'ad_relevance_improvement',
    'outperforming-campaign': 'scale_winner',
    'budget-limited-winner': 'scale_winner',
    'high-intent-device': 'device_bid_optimization',
    'high-intent-location': 'location_bid_optimization',
  };

  return bySignal[finding.signal] ?? categoryFallbackAction(finding.category);
}

function categoryFallbackAction(category) {
  if (category === 'measurementRisk') return 'tracking_fix';
  if (category === 'waste') return 'stop_waste';
  if (category === 'controlRisk') return 'control_improvement';
  return 'scale_opportunity';
}

function mapPriority(finding, step) {
  if (step === 1) return 1;
  if (step === 2 && finding.severity === 'high') return 1;
  if (step === 2) return 2;
  if (step === 3) return 2;
  if (step === 4) return 3;
  return finding.severity === 'high' ? 3 : 4;
}

function estimateConfidence(finding, actionType, measurementTrust, context, reportCoverageByKey) {
  let score = 0.45;

  if (finding.severity === 'high') score += 0.25;
  if (finding.severity === 'medium') score += 0.15;

  const row = finding.data ?? {};
  const clicks = num(row.clicks);
  const impressions = num(row.impressions);
  const conversions = num(row.conversions);
  const cost = num(row.cost);

  if (clicks >= 25 || impressions >= 500 || conversions >= 3 || cost >= 100) score += 0.2;
  else if (clicks >= 10 || impressions >= 100 || conversions >= 1 || cost >= 30) score += 0.1;

  if (measurementTrust === 'untrusted' && finding.category !== 'measurementRisk') score -= 0.25;
  if (measurementTrust === 'caution' && finding.category !== 'measurementRisk') score -= 0.1;
  if (context.trackingTrusted == null) score -= 0.05;
  if (!finding.data || Object.keys(finding.data).length === 0) score -= 0.1;

  const hasSearchTerms = reportCoverageByKey.searchTerms?.present === true;
  const hasLocations = reportCoverageByKey.locations?.present === true;

  if (finding.signal === 'zero-leads-term') {
    if (finding.data?.searchTerm && hasSearchTerms) score += 0.12;
    if (!finding.data?.searchTerm) score -= 0.08;
  }

  if (finding.signal === 'broad-match-risk' && !hasSearchTerms) {
    score -= 0.15;
  }

  if ((actionType === 'location_bid_control' || finding.signal === 'high-intent-location') && !context.serviceArea) {
    score -= 0.15;
  }

  if (finding.category === 'opportunity') {
    if (context.targetCpl == null) score -= 0.1;
    if (context.offlineConversionsImported !== true) score -= 0.1;
  }

  if (!hasLocations && (actionType === 'location_bid_control' || finding.signal === 'high-intent-location')) {
    score -= 0.1;
  }

  if (score >= 0.75) return 'High confidence';
  if (score >= 0.55) return 'Medium confidence';
  return 'Low confidence';
}

function deriveSafetyClassification({
  finding,
  confidence,
  blockedByTracking,
  requiresBusinessContext,
  measurementTrust,
  reportCoverageByKey,
}) {
  if (blockedByTracking) return 'blocked_until_tracking_trusted';
  if (requiresBusinessContext) return 'blocked_until_business_context_provided';

  if (finding.signal === 'broad-match-risk' && reportCoverageByKey.searchTerms?.present !== true) {
    return 'review_before_acting';
  }

  if (finding.category === 'opportunity' && (measurementTrust === 'caution' || confidence === 'Low confidence')) {
    return 'review_before_acting';
  }

  if (confidence === 'Low confidence') return 'not_safe_from_csv_alone';
  if (confidence === 'Medium confidence') return 'review_before_acting';
  return 'safe_to_do_now';
}

function resolveEvidenceState(confidence, requiresBusinessContext, blockedByTracking) {
  if (blockedByTracking) return 'unknown';
  if (requiresBusinessContext) return 'likely';
  if (confidence === 'High confidence') return 'confirmed';
  if (confidence === 'Medium confidence') return 'likely';
  return 'unknown';
}

function requiresContext(actionType, finding, missingBusinessContext) {
  if (finding.category === 'opportunity') {
    return missingBusinessContext.includes('targetCpl');
  }

  if (actionType === 'location_bid_control' || finding.signal === 'high-intent-location') {
    return missingBusinessContext.includes('serviceArea');
  }

  return false;
}

function buildEvidence(finding) {
  const evidence = [finding.what];
  const row = finding.data ?? {};

  if (row.clicks != null) evidence.push(`Clicks: ${row.clicks}`);
  if (row.impressions != null) evidence.push(`Impressions: ${row.impressions}`);
  if (row.cost != null) evidence.push(`Spend: CA$${Number(row.cost).toFixed(2)}`);
  if (row.conversions != null) evidence.push(`Conversions: ${row.conversions}`);

  return evidence;
}

function resolveEntity(row = {}) {
  if (row.searchTerm) return { level: 'searchTerm', name: row.searchTerm };
  if (row.keyword) return { level: 'keyword', name: row.keyword };
  if (row.adGroup) return { level: 'adGroup', name: row.adGroup };
  if (row.campaign) return { level: 'campaign', name: row.campaign };
  if (row.device) return { level: 'device', name: row.device };
  if (row.location) return { level: 'location', name: row.location };
  return { level: 'account', name: 'Account-wide' };
}

function expectedOutcomeFor(category) {
  if (category === 'measurementRisk') return 'Data becomes safer to use for optimization decisions.';
  if (category === 'waste') return 'Budget leakage is reduced and wasted spend declines.';
  if (category === 'controlRisk') return 'Account control improves and performance becomes more stable.';
  return 'Profitable volume can grow with lower risk of over-scaling.';
}

function riskIfIgnoredFor(category) {
  if (category === 'measurementRisk') return 'You may optimize against unreliable data and make harmful changes.';
  if (category === 'waste') return 'Spend continues going to low-intent traffic with little return.';
  if (category === 'controlRisk') return 'Structural inefficiencies will keep pushing CPA higher.';
  return 'Scaling may stall or increase CPA if done too early.';
}

function buildDatasetDrivenDecisions(data, measurementTrust, context) {
  const decisions = [];

  decisions.push(...buildAdDecisions(data.ads ?? [], measurementTrust));
  decisions.push(...buildDeviceDecisions(data.devices ?? [], measurementTrust, context));
  decisions.push(...buildLocationDecisions(data.locations ?? [], measurementTrust, context));

  // Business target context can moderate scaling confidence.
  if (context.targetCpl != null && data.campaigns?.length) {
    const overTarget = data.campaigns.filter(c => num(c.conversions) > 0 && (num(c.cost) / num(c.conversions)) > context.targetCpl);
    if (overTarget.length > 0) {
      decisions.push({
        action_type: 'target_cpl_alignment',
        action_priority: 2,
        execution_step: 3,
        confidence: 'Medium confidence',
        category: 'controlRisk',
        entity_level: 'account',
        entity_name: 'Account-wide',
        reason: `Some campaigns are above your target CPL (CA$${context.targetCpl}).`,
        evidence: [`${overTarget.length} campaign(s) currently above target CPL.`],
        evidence_state: measurementTrust === 'untrusted' ? 'unknown' : 'likely',
        prerequisite: measurementTrust === 'untrusted' ? 'Resolve measurement trust first.' : 'No blocking prerequisite.',
        user_instruction: 'Reduce bid pressure in above-target campaigns and prioritize efficient segments first.',
        operator_steps: [
          'Google Ads > Campaigns > sort by Cost/conv.',
          'Open campaigns above target CPL and reduce bids or tighten match types.',
          'Check search terms and remove irrelevant intent before saving.',
          'Monitor CPL trend daily for 3-5 days.',
        ],
        monitor_after_change: 'Watch campaign CPL and conversion volume after each adjustment.',
        reassess_timing: 'Re-upload updated reports after 3-7 days.',
        expected_outcome: 'Account trend moves closer to target CPL.',
        risk_if_ignored: 'Budget can continue shifting into expensive lead acquisition.',
        do_not_do_yet: measurementTrust === 'untrusted',
        requires_business_context: false,
        blocked_by_tracking: measurementTrust === 'untrusted',
        review_required_before_action: true,
        safety_classification: measurementTrust === 'untrusted'
          ? 'blocked_until_tracking_trusted'
          : 'review_before_acting',
      });
    }
  }

  return decisions;
}

function buildAdDecisions(ads, measurementTrust) {
  const weakAds = ads.filter(a => num(a.impressions) >= 100 && num(a.ctr) > 0 && num(a.ctr) < 1.0 && num(a.conversions) === 0 && num(a.cost) >= 30);
  if (weakAds.length === 0) return [];

  return [{
    action_type: 'ad_copy_review',
    action_priority: 3,
    execution_step: 4,
    confidence: measurementTrust === 'untrusted' ? 'Low confidence' : 'Medium confidence',
    category: 'controlRisk',
    entity_level: 'adGroup',
    entity_name: weakAds[0].adGroup ?? 'Multiple ad groups',
    reason: 'Ads data shows weak CTR with non-converting spend.',
    evidence: [`${weakAds.length} ad row(s) meet low-CTR and zero-conversion criteria.`],
    evidence_state: measurementTrust === 'untrusted' ? 'unknown' : 'likely',
    prerequisite: measurementTrust === 'untrusted' ? 'Validate conversion tracking first.' : 'No blocking prerequisite.',
    user_instruction: 'Review ad copy relevance in affected groups and test clearer service-intent messaging.',
    operator_steps: [
      'Google Ads > Ads > filter to impacted ad groups.',
      'Open ads with low CTR and zero conversions.',
      'Create 1-2 variants with clearer service intent and local qualifiers.',
      'Keep one control ad active for comparison.',
      'Review CTR and conversion rate after 5-7 days.',
    ],
    monitor_after_change: 'Track CTR, conversion rate, and cost/conv. for the revised ad group.',
    reassess_timing: 'Re-upload Ads and Ad Group reports after 7 days.',
    expected_outcome: 'Better CTR and more qualified click mix.',
    risk_if_ignored: 'Low-relevance ads can keep wasting spend and limit quality score improvement.',
    do_not_do_yet: false,
    requires_business_context: false,
    blocked_by_tracking: measurementTrust === 'untrusted',
    review_required_before_action: true,
    safety_classification: measurementTrust === 'untrusted'
      ? 'blocked_until_tracking_trusted'
      : 'review_before_acting',
  }];
}

function buildDeviceDecisions(devices, measurementTrust, context) {
  const decisions = [];
  const weak = devices.filter(d => num(d.cost) >= 50 && num(d.conversions) === 0);

  const converting = devices.filter(d => num(d.conversions) > 0 && num(d.cost) > 0);
  const avgCpl = converting.length
    ? converting.reduce((a, d) => a + (num(d.cost) / num(d.conversions)), 0) / converting.length
    : null;
  const winners = converting.filter(d => {
    const cpl = num(d.cost) / num(d.conversions);
    if (context.targetCpl != null) return cpl <= context.targetCpl;
    return avgCpl != null ? cpl <= avgCpl * 0.85 : false;
  });

  if (weak.length) {
    decisions.push({
    action_type: 'device_bid_control',
    action_priority: 2,
    execution_step: 2,
    confidence: measurementTrust === 'untrusted' ? 'Low confidence' : 'Medium confidence',
    category: 'waste',
    entity_level: 'device',
    entity_name: weak[0].device ?? 'Device segment',
    reason: 'One or more device segments show material spend with zero conversions.',
    evidence: weak.slice(0, 3).map(d => `${d.device ?? 'Unknown'}: CA$${num(d.cost).toFixed(2)} spend, ${num(d.conversions)} conversions`),
    evidence_state: measurementTrust === 'untrusted' ? 'unknown' : 'confirmed',
    prerequisite: measurementTrust === 'untrusted' ? 'Resolve tracking trust first.' : 'No blocking prerequisite.',
    user_instruction: 'Apply negative bid adjustments to weak device segments and recheck search terms before broader cuts.',
    operator_steps: [
      'Google Ads > Devices tab in relevant campaign(s).',
      'Apply a moderate negative bid adjustment (for example -10% to -20%) first, not full exclusion.',
      'Check search terms and conversion trend before deeper cuts.',
      'Keep changes small and monitor 3-5 days.',
    ],
    monitor_after_change: 'Track device-level CPA and conversion volume after bid adjustment.',
    reassess_timing: 'Re-upload Devices and Campaign reports after 3-7 days.',
    expected_outcome: 'Reduced device-level waste.',
    risk_if_ignored: 'Budget leakage can continue in underperforming device segments.',
    do_not_do_yet: measurementTrust === 'untrusted',
    requires_business_context: false,
    blocked_by_tracking: measurementTrust === 'untrusted',
    review_required_before_action: true,
    safety_classification: measurementTrust === 'untrusted'
      ? 'blocked_until_tracking_trusted'
      : 'review_before_acting',
    });
  }

  if (winners.length) {
    const top = winners[0];
    const topCpl = num(top.cost) / Math.max(num(top.conversions), 1);
    decisions.push({
      action_type: 'device_scale_support',
      action_priority: 4,
      execution_step: 5,
      confidence: measurementTrust === 'trusted' ? 'Medium confidence' : 'Low confidence',
      category: 'opportunity',
      entity_level: 'device',
      entity_name: top.device ?? 'Device segment',
      reason: 'At least one device segment is materially more efficient than peers.',
      evidence: [`${top.device ?? 'Unknown'}: CA$${topCpl.toFixed(2)} CPA with ${num(top.conversions)} conversions`],
      evidence_state: measurementTrust === 'trusted' ? 'likely' : 'unknown',
      prerequisite: measurementTrust === 'trusted'
        ? 'Waste and tracking issues should already be under control.'
        : 'Resolve measurement trust first.',
      user_instruction: `After core fixes, test a small positive bid adjustment on ${top.device ?? 'the winning device segment'}.`,
      operator_steps: [
        'Google Ads > Devices tab.',
        'Increase bid slightly on the best device segment (+5% to +10%).',
        'Confirm CPA remains within target after 3-5 days.',
      ],
      monitor_after_change: 'Monitor device CPA and absolute conversion volume.',
      reassess_timing: 'Re-upload Devices report after 5-7 days.',
      expected_outcome: 'Incremental growth from the strongest device segment.',
      risk_if_ignored: 'You may underinvest in a proven efficient segment.',
      do_not_do_yet: measurementTrust !== 'trusted',
      requires_business_context: context.targetCpl == null,
      blocked_by_tracking: measurementTrust !== 'trusted',
      review_required_before_action: true,
      safety_classification: measurementTrust === 'trusted' && context.targetCpl != null
        ? 'review_before_acting'
        : measurementTrust === 'trusted'
          ? 'blocked_until_business_context_provided'
          : 'blocked_until_tracking_trusted',
    });
  }

  return decisions;
}

function buildLocationDecisions(locations, measurementTrust, context) {
  const decisions = [];
  const weak = locations.filter(l => num(l.cost) >= 50 && num(l.conversions) === 0);
  const serviceAreaTokens = tokenize(context.serviceArea);

  if (weak.length) {
    const topWeak = weak[0];
    const locationLabel = topWeak.location ?? 'Location segment';
    const appearsInServiceArea = serviceAreaTokens.length
      ? serviceAreaTokens.some(t => locationLabel.toLowerCase().includes(t))
      : null;

    const classification = measurementTrust === 'untrusted'
      ? 'blocked_until_tracking_trusted'
      : !context.serviceArea
        ? 'blocked_until_business_context_provided'
        : 'review_before_acting';

    decisions.push({
    action_type: 'location_bid_control',
    action_priority: 2,
    execution_step: 2,
    confidence: measurementTrust === 'untrusted' || !context.serviceArea
      ? 'Low confidence'
      : 'Medium confidence',
    category: 'waste',
    entity_level: 'location',
    entity_name: locationLabel,
    reason: 'One or more location segments show spend with no recorded conversions.',
    evidence: weak.slice(0, 3).map(l => `${l.location ?? 'Unknown'}: CA$${num(l.cost).toFixed(2)} spend, ${num(l.conversions)} conversions`),
    evidence_state: measurementTrust === 'untrusted' ? 'unknown' : 'confirmed',
    prerequisite: measurementTrust === 'untrusted'
      ? 'Resolve tracking trust first.'
      : !context.serviceArea
        ? 'Add service area context before deciding on geo reductions.'
        : 'No blocking prerequisite.',
    user_instruction: appearsInServiceArea === true
      ? 'Reduce bids first for this location segment; do not exclude immediately.'
      : 'Review location fit against service area, then reduce bids before considering exclusion.',
    operator_steps: [
      'Google Ads > Locations report in impacted campaign(s).',
      'Compare spend and conversions for weak geos.',
      'Apply a modest bid reduction first (for example -10% to -20%).',
      'Do not exclude until at least one follow-up report confirms the pattern.',
    ],
    monitor_after_change: 'Track location-level CPA and conversion trend after the bid reduction.',
    reassess_timing: 'Re-upload Location report after 5-7 days.',
    expected_outcome: 'Cleaner spend allocation across geographies.',
    risk_if_ignored: 'Spend can remain concentrated in low-performing geographies.',
    do_not_do_yet: classification !== 'review_before_acting',
    requires_business_context: !context.serviceArea,
    blocked_by_tracking: measurementTrust === 'untrusted',
    review_required_before_action: true,
    safety_classification: classification,
    });
  }

  const converting = locations.filter(l => num(l.conversions) > 0 && num(l.cost) > 0);
  const winners = converting.filter(l => {
    const cpl = num(l.cost) / num(l.conversions);
    if (context.targetCpl != null) return cpl <= context.targetCpl;
    return false;
  });

  if (winners.length) {
    const top = winners[0];
    decisions.push({
      action_type: 'location_scale_support',
      action_priority: 4,
      execution_step: 5,
      confidence: context.serviceArea && measurementTrust === 'trusted' ? 'Medium confidence' : 'Low confidence',
      category: 'opportunity',
      entity_level: 'location',
      entity_name: top.location ?? 'Location segment',
      reason: 'A location segment appears efficient against your target CPL.',
      evidence: [`${top.location ?? 'Unknown'}: ${num(top.conversions)} conversions on CA$${num(top.cost).toFixed(2)} spend`],
      evidence_state: measurementTrust === 'trusted' ? 'likely' : 'unknown',
      prerequisite: measurementTrust === 'trusted'
        ? 'Core waste and tracking blockers should be resolved first.'
        : 'Resolve tracking trust before scaling.',
      user_instruction: 'After cleanup phases, test a small positive bid adjustment for strong geos still within service area.',
      operator_steps: [
        'Google Ads > Locations tab.',
        'Confirm strong geo is within your service area and lead intent is acceptable.',
        'Apply a small positive bid adjustment (+5% to +10%).',
        'Monitor CPA and lead quality notes before scaling further.',
      ],
      monitor_after_change: 'Track geo CPA and lead quality trend after adjustment.',
      reassess_timing: 'Re-upload Location and Campaign reports after 5-7 days.',
      expected_outcome: 'Careful growth from geos already showing efficient conversion behavior.',
      risk_if_ignored: 'You may underfund high-performing geos.',
      do_not_do_yet: measurementTrust !== 'trusted' || !context.serviceArea,
      requires_business_context: !context.serviceArea || context.targetCpl == null,
      blocked_by_tracking: measurementTrust !== 'trusted',
      review_required_before_action: true,
      safety_classification: measurementTrust !== 'trusted'
        ? 'blocked_until_tracking_trusted'
        : !context.serviceArea || context.targetCpl == null
          ? 'blocked_until_business_context_provided'
          : 'review_before_acting',
    });
  }

  return decisions;
}

function buildContextDrivenDecisions(data, measurementTrust, context, reportCoverageByKey) {
  const decisions = [];

  const excludedTokens = tokenize(context.excludedServices);
  if (excludedTokens.length > 0) {
    const termRows = data.searchTerms ?? [];
    const keywordRows = data.keywords ?? [];

    const excludedMatches = [];
    for (const row of termRows) {
      const label = String(row.searchTerm ?? '').toLowerCase();
      if (excludedTokens.some(t => label.includes(t))) excludedMatches.push({ level: 'searchTerm', label: row.searchTerm });
    }
    for (const row of keywordRows) {
      const label = String(row.keyword ?? '').toLowerCase();
      if (excludedTokens.some(t => label.includes(t))) excludedMatches.push({ level: 'keyword', label: row.keyword });
    }

    if (excludedMatches.length > 0) {
      const hasSearchTerms = reportCoverageByKey.searchTerms?.present === true;
      const highConfidence = hasSearchTerms && excludedMatches.some(m => m.level === 'searchTerm');

      decisions.push({
        action_type: 'excluded_service_alignment',
        action_priority: 2,
        execution_step: 2,
        confidence: highConfidence ? 'High confidence' : 'Medium confidence',
        category: 'waste',
        entity_level: 'account',
        entity_name: 'Excluded service terms',
        reason: 'Uploaded terms/keywords contain services marked as excluded in your business settings.',
        evidence: excludedMatches.slice(0, 5).map(m => `${m.level}: ${m.label ?? 'Unknown'}`),
        evidence_state: highConfidence ? 'confirmed' : 'likely',
        prerequisite: hasSearchTerms ? 'No blocking prerequisite.' : 'Upload Search Terms report for safer exclusions.',
        user_instruction: highConfidence
          ? 'Add matched excluded-service queries as negative keywords now.'
          : 'Review matched terms first, then add negatives only for clearly excluded services.',
        operator_steps: [
          'Google Ads > Search terms report.',
          'Filter by excluded service wording from your settings.',
          'Add exact or phrase negatives for terms that are clearly unwanted.',
          'Check impact on lead volume after 3-5 days.',
        ],
        monitor_after_change: 'Watch wasted spend and conversion volume after adding negatives.',
        reassess_timing: 'Re-upload Search Terms and Campaign reports in 3-7 days.',
        expected_outcome: 'Spend shifts away from services you do not want to sell.',
        risk_if_ignored: 'Budget may continue going to intentionally unwanted demand.',
        do_not_do_yet: false,
        requires_business_context: false,
        blocked_by_tracking: false,
        review_required_before_action: !highConfidence,
        safety_classification: highConfidence ? 'safe_to_do_now' : 'review_before_acting',
      });
    }
  }

  if (context.averageDealValue != null && context.offlineConversionsImported !== true) {
    decisions.push({
      action_type: 'value_signal_guardrail',
      action_priority: 3,
      execution_step: 1,
      confidence: 'High confidence',
      category: 'measurementRisk',
      entity_level: 'account',
      entity_name: 'Value tracking guardrail',
      reason: 'Average deal value is set, but offline conversion imports are missing or unknown.',
      evidence: ['Value-based optimization confidence is limited without offline conversion completeness.'],
      evidence_state: 'confirmed',
      prerequisite: 'Enable and validate offline conversion imports if possible.',
      user_instruction: 'Use CPA guidance cautiously and avoid strong value/LTV assumptions until offline conversion data is reliable.',
      operator_steps: [
        'Google Ads > Tools > Conversions.',
        'Check whether offline/CRM conversion actions are imported and primary where intended.',
        'Confirm upload cadence and dedup settings.',
      ],
      monitor_after_change: 'Monitor conversion value consistency after imports are enabled.',
      reassess_timing: 'Re-upload reports after one full reporting cycle.',
      expected_outcome: 'More reliable value-aware optimization decisions.',
      risk_if_ignored: 'You may over- or under-scale based on incomplete value signals.',
      do_not_do_yet: false,
      requires_business_context: false,
      blocked_by_tracking: false,
      review_required_before_action: true,
      safety_classification: 'review_before_acting',
    });
  }

  if (context.preferredLeadType || context.goodLeadNote) {
    decisions.push({
      action_type: 'lead_quality_guardrail',
      action_priority: 3,
      execution_step: 1,
      confidence: 'High confidence',
      category: 'measurementRisk',
      entity_level: 'account',
      entity_name: 'Lead quality guardrail',
      reason: 'Business quality preferences are defined, but CSV conversion counts alone cannot validate lead quality.',
      evidence: [
        context.preferredLeadType ? `Preferred lead type: ${context.preferredLeadType}` : 'Preferred lead type not set',
        context.goodLeadNote ? `Good lead note: ${context.goodLeadNote}` : 'Good lead note not set',
      ],
      evidence_state: 'confirmed',
      prerequisite: 'Use CRM or call quality checks for quality confirmation.',
      user_instruction: 'Treat conversion count as quantity only; validate lead quality manually before scaling hard.',
      operator_steps: [
        'Review CRM outcomes or call notes for top converting entities.',
        'Confirm that converted leads match your preferred lead profile.',
      ],
      monitor_after_change: 'Track close rate or qualified-lead ratio alongside conversion volume.',
      reassess_timing: 'Reassess weekly with fresh reports and quality feedback.',
      expected_outcome: 'Safer scaling decisions aligned with true lead quality.',
      risk_if_ignored: 'You may scale low-quality leads that look good in raw conversion counts.',
      do_not_do_yet: false,
      requires_business_context: false,
      blocked_by_tracking: false,
      review_required_before_action: true,
      safety_classification: 'review_before_acting',
    });
  }

  return decisions;
}

function buildGuardrailDecisions(
  measurementTrust,
  missingReports,
  missingBusinessContext,
  businessContext,
  reportCoverageByKey,
) {
  const decisions = [];

  if (measurementTrust === 'untrusted') {
    decisions.push({
      action_type: 'freeze_scaling',
      action_priority: 1,
      execution_step: 1,
      confidence: 'High confidence',
      category: 'measurementRisk',
      entity_level: 'account',
      entity_name: 'Account-wide',
      reason: 'Tracking trust is low, so efficiency-driven scaling decisions are unsafe.',
      evidence: ['Measurement issues were detected in uploaded data or tracking trust is set to not trusted.'],
      evidence_state: 'confirmed',
      prerequisite: 'Fix tracking and confirm conversion integrity.',
      user_instruction: 'Do not increase budgets or bids for scale yet.',
      operator_steps: [
        'Pause any planned budget increases.',
        'Resolve tracking issues first in Google Ads conversion settings and tags.',
      ],
      monitor_after_change: 'Confirm conversion counts become plausible before resuming scale.',
      reassess_timing: 'Re-upload reports immediately after tracking fixes begin and again after 3-7 days.',
      expected_outcome: 'Prevents scaling into unreliable signals.',
      risk_if_ignored: 'You may scale spend on false positives and increase CPA quickly.',
      do_not_do_yet: true,
      requires_business_context: false,
      blocked_by_tracking: false,
      review_required_before_action: false,
      safety_classification: 'blocked_until_tracking_trusted',
    });
  }

  if (missingReports.length > 0) {
    decisions.push({
      action_type: 'upload_coverage_improvement',
      action_priority: 3,
      execution_step: 1,
      confidence: 'Medium confidence',
      category: 'measurementRisk',
      entity_level: 'account',
      entity_name: 'Account-wide',
      reason: 'Some report slots are missing and reduce decision confidence.',
      evidence: [`Missing reports: ${missingReports.join(', ')}`],
      evidence_state: 'confirmed',
      prerequisite: 'None',
      user_instruction: 'Upload missing report slots to improve decision confidence before major account changes.',
      operator_steps: [
        'Export missing report types from Google Ads for the same date range.',
        'Upload each file to the matching fixed slot in the UI.',
      ],
      monitor_after_change: 'Check that missing-report warnings are reduced in the next run.',
      reassess_timing: 'Re-run analysis immediately after uploading missing reports.',
      expected_outcome: 'Higher confidence and better decision precision.',
      risk_if_ignored: 'Important decisions may remain review-first instead of action-ready.',
      do_not_do_yet: false,
      requires_business_context: false,
      blocked_by_tracking: false,
      review_required_before_action: true,
      safety_classification: 'review_before_acting',
    });
  }

  if (missingBusinessContext.length > 0) {
    decisions.push({
      action_type: 'business_context_completion',
      action_priority: 3,
      execution_step: 1,
      confidence: 'High confidence',
      category: 'measurementRisk',
      entity_level: 'account',
      entity_name: 'Business settings',
      reason: 'Some recommendations require business context to be safe and specific.',
      evidence: [`Missing settings: ${missingBusinessContext.join(', ')}`],
      evidence_state: 'confirmed',
      prerequisite: 'None',
      user_instruction: 'Complete missing business settings in the form above uploads.',
      operator_steps: [
        'Open Business Context form.',
        'Fill missing fields and save.',
        'Run analysis again so decisions can use your context.',
      ],
      monitor_after_change: 'Verify fewer context-blocked decisions in next run.',
      reassess_timing: 'Re-run immediately after saving settings.',
      expected_outcome: 'Recommendations become more aligned with your business economics and service scope.',
      risk_if_ignored: 'Actions may be generic and require manual review before execution.',
      do_not_do_yet: false,
      requires_business_context: false,
      blocked_by_tracking: false,
      review_required_before_action: true,
      safety_classification: 'review_before_acting',
    });
  }

  if (reportCoverageByKey.searchTerms?.present !== true) {
    decisions.push({
      action_type: 'broad_keyword_guardrail',
      action_priority: 2,
      execution_step: 2,
      confidence: 'High confidence',
      category: 'controlRisk',
      entity_level: 'account',
      entity_name: 'Broad-match guardrail',
      reason: 'Search Terms report is missing, so broad keyword pauses are riskier.',
      evidence: ['Broad-match changes without search-term evidence can block profitable queries.'],
      evidence_state: 'confirmed',
      prerequisite: 'Upload Search Terms report before aggressive broad-keyword cuts.',
      user_instruction: 'Do not pause broad keywords yet. First review actual search terms.',
      operator_steps: [
        'Export and upload Search Terms report.',
        'Audit irrelevant queries and add negatives first.',
        'Only then evaluate broad keyword pauses.',
      ],
      monitor_after_change: 'Track impression and conversion volume after any broad-match adjustment.',
      reassess_timing: 'Re-run after Search Terms upload and changes.',
      expected_outcome: 'Safer broad-match control with lower risk of killing good demand.',
      risk_if_ignored: 'Good queries can be cut accidentally, reducing lead flow.',
      do_not_do_yet: true,
      requires_business_context: false,
      blocked_by_tracking: false,
      review_required_before_action: false,
      safety_classification: 'not_safe_from_csv_alone',
    });
  }

  if (!businessContext.serviceArea) {
    decisions.push({
      action_type: 'location_exclusion_guardrail',
      action_priority: 2,
      execution_step: 2,
      confidence: 'High confidence',
      category: 'controlRisk',
      entity_level: 'account',
      entity_name: 'Geo guardrail',
      reason: 'Service area is not set, so geo exclusions are not safe yet.',
      evidence: ['Location performance alone cannot confirm business service coverage.'],
      evidence_state: 'confirmed',
      prerequisite: 'Set service area in business context first.',
      user_instruction: 'Do not exclude locations yet. Use bid reductions only until service area is defined.',
      operator_steps: [
        'Set service area in Business Context form.',
        'Use temporary location bid reductions instead of exclusions.',
      ],
      monitor_after_change: 'Track whether weak geos remain weak after moderate bid reductions.',
      reassess_timing: 'Re-run after service area is saved and 3-7 days of data accrue.',
      expected_outcome: 'Prevents accidental exclusion of valid service geographies.',
      risk_if_ignored: 'You may exclude viable demand in areas you actually serve.',
      do_not_do_yet: true,
      requires_business_context: true,
      blocked_by_tracking: false,
      review_required_before_action: false,
      safety_classification: 'blocked_until_business_context_provided',
    });
  }

  if (measurementTrust === 'caution') {
    decisions.push({
      action_type: 'cpa_caution_guardrail',
      action_priority: 2,
      execution_step: 1,
      confidence: 'High confidence',
      category: 'measurementRisk',
      entity_level: 'account',
      entity_name: 'CPA guardrail',
      reason: 'Tracking is not fully trusted, so CPA conclusions should be treated as directional only.',
      evidence: ['Measurement trust is caution level.'],
      evidence_state: 'confirmed',
      prerequisite: 'Strengthen conversion trust before major CPA-driven reallocations.',
      user_instruction: 'Use small changes only; avoid large reallocations based solely on CPA.',
      operator_steps: [
        'Validate conversion action setup and counting method.',
        'Make only incremental bid/budget moves until trust improves.',
      ],
      monitor_after_change: 'Watch for stable conversion counts before taking larger actions.',
      reassess_timing: 'Re-run after tracking checks and next reporting cycle.',
      expected_outcome: 'Reduces risk of overreacting to partially trusted performance data.',
      risk_if_ignored: 'Large account moves may be made on unstable CPA signals.',
      do_not_do_yet: false,
      requires_business_context: false,
      blocked_by_tracking: false,
      review_required_before_action: true,
      safety_classification: 'review_before_acting',
    });
  }

  return decisions;
}

function bucketDecisions(decisions) {
  const immediateActions = [];
  const secondaryActions = [];
  const reviewBeforeAction = [];
  const doNotTouchYet = [];
  const scaleLater = [];

  for (const d of decisions) {
    // Each decision gets exactly one primary bucket.
    if (d.safety_classification === 'blocked_until_tracking_trusted'
      || d.safety_classification === 'blocked_until_business_context_provided'
      || d.safety_classification === 'not_safe_from_csv_alone') {
      doNotTouchYet.push(d);
      continue;
    }

    if (d.execution_step === 5) {
      scaleLater.push(d);
      continue;
    }

    if (d.safety_classification === 'review_before_acting') {
      reviewBeforeAction.push(d);
      continue;
    }

    if (d.action_priority <= 2 && d.execution_step <= 2) {
      immediateActions.push(d);
    } else {
      secondaryActions.push(d);
    }
  }

  return {
    immediateActions,
    secondaryActions,
    reviewBeforeAction,
    doNotTouchYet,
    scaleLater,
  };
}

function buildAccountStatus(measurementTrust, decisions, missingReports, missingBusinessContext) {
  const highPriority = decisions.filter(d => d.action_priority === 1).length;
  const blocked = decisions.filter(d => d.blocked_by_tracking).length;

  return {
    measurementTrust,
    readiness: measurementTrust === 'untrusted' ? 'blocked' : measurementTrust === 'caution' ? 'limited' : 'ready',
    headline: statusHeadline(measurementTrust, highPriority),
    highPriorityActions: highPriority,
    blockedActions: blocked,
    missingReportsCount: missingReports.length,
    missingBusinessContextCount: missingBusinessContext.length,
  };
}

function statusHeadline(measurementTrust, highPriority) {
  if (measurementTrust === 'untrusted') return 'Do not scale yet. Fix measurement trust first.';
  if (highPriority > 0) return 'Act now on high-priority waste and control items.';
  return 'Account is stable enough for gradual optimization.';
}

function buildKnowledgeBoundaries(measurementTrust, businessContext, reportCoverage) {
  const missingHighReports = reportCoverage.filter(r => !r.present && r.importance === 'high').map(r => r.label);

  return {
    confirmed: [
      'Spend, clicks, impressions, and recorded conversions from uploaded CSV data.',
      'Waste and risk patterns at available entity levels.',
    ],
    likely: [
      'Intent mismatch and relevance issues inferred from performance patterns.',
      'Scaling potential of currently efficient entities.',
      ...(missingHighReports.length ? [`Confidence reduced due to missing high-impact reports: ${missingHighReports.join(', ')}`] : []),
    ],
    unknown: [
      'Lead quality and close rate quality (requires CRM/sales feedback).',
      'Call quality or form quality beyond conversion count.',
      'Full landing-page quality context outside CSV metrics.',
      'Offline conversion completeness unless explicitly confirmed in settings.',
      ...(businessContext.offlineConversionsImported === false
        ? ['Offline conversions are marked as not imported, so value-based conclusions are incomplete.']
        : []),
      ...(measurementTrust === 'untrusted'
        ? ['Optimization impact cannot be trusted until tracking integrity is resolved.']
        : []),
    ],
  };
}

function buildSummaryNote(measurementTrust, buckets) {
  if (measurementTrust === 'untrusted') {
    return 'Tracking trust is low. Resolve measurement issues before major optimization changes.';
  }

  if (buckets.immediateActions.length > 0) {
    return 'Start with immediate actions, then move to review and scale phases in order.';
  }

  return 'No urgent blockers found. Continue with cautious optimization and monitoring.';
}

function buildOperatorSteps(finding, entity, context) {
  const subject = entity.name || 'this entity';

  if (finding.category === 'measurementRisk') {
    return [
      'Google Ads > Tools > Conversions.',
      'Verify primary conversion actions and counting setup.',
      'Check tag firing and deduplication before further optimizations.',
      'Re-run analysis after measurement fixes.',
    ];
  }

  if (finding.category === 'waste') {
    return [
      'Google Ads > Search terms or Keywords report.',
      `Open ${subject} and review recent spend vs conversions.`,
      'Apply a controlled change (negative keyword or bid reduction).',
      'Check impact before making additional cuts.',
    ];
  }

  if (finding.category === 'controlRisk') {
    return [
      'Open the relevant campaign/ad group in Google Ads.',
      'Review match type, ad relevance, and structural settings.',
      'Apply one controlled fix at a time.',
      'Monitor quality and CPA trend after the update.',
    ];
  }

  return [
    'Confirm measurement trust and waste clean-up are complete.',
    'Open the relevant entity and apply a small scale test (+5% to +10%).',
    context.targetCpl != null
      ? `Check that CPA remains within target CPL (CA$${context.targetCpl}).`
      : 'Monitor CPA closely during the test period.',
    'Reassess before adding more budget or bid increases.',
  ];
}

function buildMonitorGuidance(finding) {
  if (finding.category === 'measurementRisk') {
    return 'Monitor conversion count consistency and conversion-to-click plausibility.';
  }
  if (finding.category === 'waste') {
    return 'Monitor spend reduction and conversion retention after the change.';
  }
  if (finding.category === 'controlRisk') {
    return 'Monitor CTR, quality indicators, and CPA stability.';
  }
  return 'Monitor CPA and conversion volume before expanding changes.';
}

function confidenceRank(confidence) {
  if (confidence === 'High confidence') return 0;
  if (confidence === 'Medium confidence') return 1;
  return 2;
}

function num(v) {
  return typeof v === 'number' && !Number.isNaN(v) ? v : 0;
}

function tokenize(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .split(/[;,\n|]/)
    .map(s => s.trim())
    .filter(s => s.length >= 3);
}
