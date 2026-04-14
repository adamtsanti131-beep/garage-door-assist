/**
 * decisionEngine.js
 * Converts findings into an ordered decision-support plan for non-expert users.
 */

const REPORT_ROLE_MAP = {
  campaign: {
    key: 'campaigns',
    label: 'קמפיין',
    usedFor: 'סכומי חשבון, מנצחים/מפסידים, ומגבלות נתח חשיפות',
    importance: 'high',
  },
  adGroup: {
    key: 'adGroups',
    label: 'קבוצת מודעות',
    usedFor: 'בזבוז ברמת קבוצה ובקרת מבנה',
    importance: 'high',
  },
  searchTerm: {
    key: 'searchTerms',
    label: 'מונחי חיפוש',
    usedFor: 'הזדמנויות למילות מפתח שליליות ובדיקות איכות כוונה',
    importance: 'high',
  },
  keyword: {
    key: 'keywords',
    label: 'מילות מפתח',
    usedFor: 'בקרת סוג התאמה, איכות, ויעילות CPC/CPA',
    importance: 'high',
  },
  ad: {
    key: 'ads',
    label: 'מודעות',
    usedFor: 'מדדי רלוונטיות מודעה ואיכות נוסח',
    importance: 'medium',
  },
  device: {
    key: 'devices',
    label: 'מכשירים',
    usedFor: 'דפוסי בזבוז/מנצחים לפי מכשיר',
    importance: 'medium',
  },
  location: {
    key: 'locations',
    label: 'מיקום',
    usedFor: 'דפוסי בזבוז/מנצחים לפי גאוגרפיה',
    importance: 'medium',
  },
};

const DECISION_STEPS = [
  'שלב 1: אימות מעקב ואמון במדידה',
  'שלב 2: עצירת בזבוז מיידית',
  'שלב 3: חיזוק שליטה ומבנה חשבון',
  'שלב 4: שיפור מודעות, רלוונטיות ואיכות',
  'שלב 5: הגדלה זהירה של מנצחים מוכחים',
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
          ? 'רמת הביטחון יורדת בהחלטות בעלות השפעה גבוהה.'
          : 'רמת הפירוט בהחלטות יורדת, אך ההנחיה המרכזית עדיין זמינה.',
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
      ? 'יש לפתור בעיות אמון במדידה לפני פעולה על פריט זה.'
      : requiresBusinessContext
        ? 'יש למלא הקשר עסקי חסר לפני פעולה סופית.'
        : 'אין תנאי סף חוסמים.',
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
    reassess_timing: 'יש להעלות דוחות מעודכנים מחדש תוך 3-7 ימים לאחר השינויים, או מוקדם יותר אם ההוצאה גבוהה.',
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

  if (score >= 0.75) return 'ביטחון גבוה';
  if (score >= 0.55) return 'ביטחון בינוני';
  return 'ביטחון נמוך';
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

  if (finding.category === 'opportunity' && (measurementTrust === 'caution' || confidence === 'ביטחון נמוך')) {
    return 'review_before_acting';
  }

  if (confidence === 'ביטחון נמוך') return 'not_safe_from_csv_alone';
  if (confidence === 'ביטחון בינוני') return 'review_before_acting';
  return 'safe_to_do_now';
}

function resolveEvidenceState(confidence, requiresBusinessContext, blockedByTracking) {
  if (blockedByTracking) return 'unknown';
  if (requiresBusinessContext) return 'likely';
  if (confidence === 'ביטחון גבוה') return 'confirmed';
  if (confidence === 'ביטחון בינוני') return 'likely';
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
  return { level: 'account', name: 'ברמת החשבון' };
}

function expectedOutcomeFor(category) {
  if (category === 'measurementRisk') return 'הנתונים הופכים בטוחים יותר לשימוש בהחלטות אופטימיזציה.';
  if (category === 'waste') return 'זליגת התקציב מצטמצמת והבזבוז יורד.';
  if (category === 'controlRisk') return 'שליטת החשבון משתפרת והביצועים הופכים יציבים יותר.';
  return 'ניתן להגדיל נפח רווחי בסיכון נמוך יותר להגדלת יתר.';
}

function riskIfIgnoredFor(category) {
  if (category === 'measurementRisk') return 'עלולה להתבצע אופטימיזציה על נתונים לא אמינים ולהוביל לשינויים מזיקים.';
  if (category === 'waste') return 'התקציב ימשיך לזרום לתנועה עם כוונה נמוכה ותשואה נמוכה.';
  if (category === 'controlRisk') return 'חוסר יעילות מבני ימשיך להעלות את ה-CPA.';
  return 'הגדלה עלולה להיעצר או להעלות CPA אם מבוצעת מוקדם מדי.';
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
        confidence: 'ביטחון בינוני',
        category: 'controlRisk',
        entity_level: 'account',
        entity_name: 'Account-wide',
        reason: `חלק מהקמפיינים מעל יעד ה-CPL שלך (CA$${context.targetCpl}).`,
        evidence: [`${overTarget.length} קמפיינים נמצאים כרגע מעל יעד ה-CPL.`],
        evidence_state: measurementTrust === 'untrusted' ? 'unknown' : 'likely',
        prerequisite: measurementTrust === 'untrusted' ? 'יש לחזק קודם את אמון המדידה.' : 'אין תנאי סף חוסמים.',
        user_instruction: 'להפחית לחץ הצעות מחיר בקמפיינים שמעל היעד ולתעדף קודם פלחים יעילים.',
        operator_steps: [
          'Google Ads > Campaigns > מיון לפי Cost/conv.',
          'לפתוח קמפיינים שמעל יעד CPL ולהפחית הצעות מחיר או להדק סוגי התאמה.',
          'לבדוק מונחי חיפוש ולהסיר כוונה לא רלוונטית לפני שמירה.',
          'לנטר מגמת CPL מדי יום למשך 3-5 ימים.',
        ],
        monitor_after_change: 'לנטר CPL ונפח המרות בקמפיין אחרי כל התאמה.',
        reassess_timing: 'להעלות מחדש דוחות מעודכנים לאחר 3-7 ימים.',
        expected_outcome: 'מגמת החשבון מתקרבת ליעד ה-CPL.',
        risk_if_ignored: 'התקציב עלול להמשיך לזרום לרכישת לידים יקרה.',
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
    confidence: measurementTrust === 'untrusted' ? 'ביטחון נמוך' : 'ביטחון בינוני',
    category: 'controlRisk',
    entity_level: 'adGroup',
    entity_name: weakAds[0].adGroup ?? 'מספר קבוצות מודעות',
    reason: 'נתוני המודעות מצביעים על CTR חלש עם הוצאה שלא ממירה.',
    evidence: [`${weakAds.length} שורות מודעות עומדות בתנאי CTR נמוך ואפס המרות.`],
    evidence_state: measurementTrust === 'untrusted' ? 'unknown' : 'likely',
    prerequisite: measurementTrust === 'untrusted' ? 'יש לאמת קודם מעקב המרות.' : 'אין תנאי סף חוסמים.',
    user_instruction: 'לבדוק רלוונטיות נוסחי מודעה בקבוצות שנפגעו ולבדוק מסרים ברורים יותר לכוונת שירות.',
    operator_steps: [
      'Google Ads > Ads > לסנן לקבוצות מודעות שנפגעו.',
      'לפתוח מודעות עם CTR נמוך ואפס המרות.',
      'ליצור 1-2 וריאציות עם כוונת שירות ברורה יותר וסייגים מקומיים.',
      'להשאיר מודעת ביקורת אחת פעילה להשוואה.',
      'לבדוק CTR ושיעור המרה לאחר 5-7 ימים.',
    ],
    monitor_after_change: 'לנטר CTR, שיעור המרה ועלות להמרה עבור קבוצת המודעות שעודכנה.',
    reassess_timing: 'להעלות מחדש דוחות מודעות וקבוצות מודעות לאחר 7 ימים.',
    expected_outcome: 'CTR טוב יותר ותמהיל קליקים איכותי יותר.',
    risk_if_ignored: 'מודעות עם רלוונטיות נמוכה ימשיכו לבזבז תקציב ולהגביל שיפור בציון איכות.',
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
    entity_name: weak[0].device ?? 'פלח מכשיר',
    reason: 'פלח מכשיר אחד או יותר מציג הוצאה משמעותית ללא המרות.',
    evidence: weak.slice(0, 3).map(d => `${d.device ?? 'לא ידוע'}: הוצאה CA$${num(d.cost).toFixed(2)}, ${num(d.conversions)} המרות`),
    evidence_state: measurementTrust === 'untrusted' ? 'unknown' : 'confirmed',
    prerequisite: measurementTrust === 'untrusted' ? 'יש לפתור קודם את אמון המעקב.' : 'אין תנאי סף חוסמים.',
    user_instruction: 'להחיל התאמות הצעת מחיר שליליות על פלחי מכשיר חלשים ולבדוק שוב מונחי חיפוש לפני קיצוץ רחב.',
    operator_steps: [
      'Google Ads > לשונית Devices בקמפיינים הרלוונטיים.',
      'להחיל קודם התאמת הצעת מחיר שלילית מתונה (למשל ‎-10% עד ‎-20%), לא החרגה מלאה.',
      'לבדוק מונחי חיפוש ומגמת המרות לפני קיצוץ עמוק יותר.',
      'לשמור על שינויים קטנים ולנטר 3-5 ימים.',
    ],
    monitor_after_change: 'לנטר CPA ונפח המרות ברמת מכשיר לאחר התאמת ההצעה.',
    reassess_timing: 'להעלות מחדש דוחות מכשירים וקמפיינים לאחר 3-7 ימים.',
    expected_outcome: 'צמצום בזבוז ברמת מכשיר.',
    risk_if_ignored: 'זליגת התקציב עלולה להמשיך בפלחי מכשיר חלשים.',
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
      confidence: measurementTrust === 'trusted' ? 'ביטחון בינוני' : 'ביטחון נמוך',
      category: 'opportunity',
      entity_level: 'device',
      entity_name: top.device ?? 'פלח מכשיר',
      reason: 'לפחות פלח מכשיר אחד יעיל משמעותית ביחס לאחרים.',
      evidence: [`${top.device ?? 'לא ידוע'}: CPA של CA$${topCpl.toFixed(2)} עם ${num(top.conversions)} המרות`],
      evidence_state: measurementTrust === 'trusted' ? 'likely' : 'unknown',
      prerequisite: measurementTrust === 'trusted'
        ? 'בעיות בזבוז ומעקב אמורות להיות כבר בשליטה.'
        : 'יש לפתור קודם את אמון המדידה.',
      user_instruction: `אחרי תיקוני בסיס, לבדוק התאמת הצעת מחיר חיובית קטנה ב-${top.device ?? 'פלח המכשיר המנצח'}.`,
      operator_steps: [
        'Google Ads > לשונית Devices.',
        'להעלות מעט את ההצעה בפלח המכשיר הטוב ביותר (+5% עד +10%).',
        'לוודא שה-CPA נשאר בטווח היעד לאחר 3-5 ימים.',
      ],
      monitor_after_change: 'לנטר CPA במכשיר ונפח המרות מוחלט.',
      reassess_timing: 'להעלות מחדש דוח מכשירים לאחר 5-7 ימים.',
      expected_outcome: 'צמיחה הדרגתית מהפלח היעיל ביותר במכשירים.',
      risk_if_ignored: 'ייתכן תת-השקעה בפלח שכבר הוכיח יעילות.',
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
    const locationLabel = topWeak.location ?? 'פלח מיקום';
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
      ? 'ביטחון נמוך'
      : 'ביטחון בינוני',
    category: 'waste',
    entity_level: 'location',
    entity_name: locationLabel,
    reason: 'פלח מיקום אחד או יותר מציג הוצאה ללא המרות מתועדות.',
    evidence: weak.slice(0, 3).map(l => `${l.location ?? 'לא ידוע'}: הוצאה CA$${num(l.cost).toFixed(2)}, ${num(l.conversions)} המרות`),
    evidence_state: measurementTrust === 'untrusted' ? 'unknown' : 'confirmed',
    prerequisite: measurementTrust === 'untrusted'
      ? 'יש לפתור קודם את אמון המעקב.'
      : !context.serviceArea
        ? 'יש להוסיף אזור שירות לפני החלטות על הפחתות גאוגרפיות.'
        : 'אין תנאי סף חוסמים.',
    user_instruction: appearsInServiceArea === true
      ? 'להפחית קודם הצעות מחיר בפלח מיקום זה; לא לבצע החרגה מיידית.'
      : 'לבדוק התאמת המיקום לאזור השירות, ואז להפחית הצעות מחיר לפני ששוקלים החרגה.',
    operator_steps: [
      'Google Ads > דוח Locations בקמפיינים שנפגעו.',
      'להשוות הוצאה והמרות עבור אזורים חלשים.',
      'להחיל קודם הפחתת הצעת מחיר מתונה (למשל ‎-10% עד ‎-20%).',
      'לא להחריג עד שלפחות דוח מעקב אחד מאשר את הדפוס.',
    ],
    monitor_after_change: 'לנטר CPA ומגמת המרות ברמת מיקום לאחר הפחתת ההצעה.',
    reassess_timing: 'להעלות מחדש דוח מיקומים לאחר 5-7 ימים.',
    expected_outcome: 'חלוקת תקציב נקייה יותר בין אזורים גאוגרפיים.',
    risk_if_ignored: 'ההוצאה עלולה להישאר מרוכזת באזורים חלשים.',
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
      confidence: context.serviceArea && measurementTrust === 'trusted' ? 'ביטחון בינוני' : 'ביטחון נמוך',
      category: 'opportunity',
      entity_level: 'location',
      entity_name: top.location ?? 'פלח מיקום',
      reason: 'פלח מיקום נראה יעיל ביחס ליעד ה-CPL שלך.',
      evidence: [`${top.location ?? 'לא ידוע'}: ${num(top.conversions)} המרות על הוצאה של CA$${num(top.cost).toFixed(2)}`],
      evidence_state: measurementTrust === 'trusted' ? 'likely' : 'unknown',
      prerequisite: measurementTrust === 'trusted'
        ? 'יש לפתור קודם חסמים מרכזיים של בזבוז ומעקב.'
        : 'יש לפתור אמון מעקב לפני סקייל.',
      user_instruction: 'לאחר שלבי הניקוי, לבדוק התאמת הצעת מחיר חיובית קטנה לאזורים חזקים שנמצאים עדיין באזור השירות.',
      operator_steps: [
        'Google Ads > לשונית Locations.',
        'לוודא שהאזור החזק נמצא באזור השירות שלך ושכוונת הליד מתאימה.',
        'להחיל התאמת הצעת מחיר חיובית קטנה (+5% עד +10%).',
        'לנטר CPA והערות איכות ליד לפני הגדלה נוספת.',
      ],
      monitor_after_change: 'לנטר CPA גאוגרפי ומגמת איכות לידים לאחר ההתאמה.',
      reassess_timing: 'להעלות מחדש דוחות מיקום וקמפיין לאחר 5-7 ימים.',
      expected_outcome: 'צמיחה זהירה מאזורים שכבר מציגים התנהגות המרה יעילה.',
      risk_if_ignored: 'ייתכן מימון חסר של אזורים עם ביצועים גבוהים.',
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
        confidence: highConfidence ? 'ביטחון גבוה' : 'ביטחון בינוני',
        category: 'waste',
        entity_level: 'account',
        entity_name: 'מונחי שירות מוחרגים',
        reason: 'מונחים/מילות מפתח שהועלו כוללים שירותים שסומנו כמוחרגים בהגדרות העסק שלך.',
        evidence: excludedMatches.slice(0, 5).map(m => `${m.level}: ${m.label ?? 'לא ידוע'}`),
        evidence_state: highConfidence ? 'confirmed' : 'likely',
        prerequisite: hasSearchTerms ? 'אין תנאי סף חוסמים.' : 'יש להעלות דוח מונחי חיפוש לצורך החרגות בטוחות יותר.',
        user_instruction: highConfidence
          ? 'להוסיף עכשיו שאילתות תואמות לשירותים מוחרגים כמילות מפתח שליליות.'
          : 'לבדוק קודם את המונחים התואמים, ואז להוסיף שלילות רק לשירותים שמוחרגים בבירור.',
        operator_steps: [
          'Google Ads > דוח Search terms.',
          'לסנן לפי ניסוח השירותים המוחרגים מתוך ההגדרות שלך.',
          'להוסיף שלילות בהתאמה מדויקת או ביטויית למונחים לא רצויים באופן ברור.',
          'לבדוק השפעה על נפח לידים לאחר 3-5 ימים.',
        ],
        monitor_after_change: 'לנטר הוצאה מבוזבזת ונפח המרות לאחר הוספת שלילות.',
        reassess_timing: 'להעלות מחדש דוחות מונחי חיפוש וקמפיינים תוך 3-7 ימים.',
        expected_outcome: 'התקציב יוסט משירותים שאינך רוצה למכור.',
        risk_if_ignored: 'התקציב עלול להמשיך לזרום לביקוש שאינך מעוניין בו.',
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
      confidence: 'ביטחון גבוה',
      category: 'measurementRisk',
      entity_level: 'account',
      entity_name: 'מגן בטיחות לערך',
      reason: 'ערך עסקה ממוצע הוגדר, אך ייבוא המרות אופליין חסר או לא ידוע.',
      evidence: ['רמת הביטחון באופטימיזציה מבוססת ערך מוגבלת ללא שלמות נתוני המרות אופליין.'],
      evidence_state: 'confirmed',
      prerequisite: 'יש להפעיל ולאמת ייבוא המרות אופליין אם אפשר.',
      user_instruction: 'להשתמש בהנחיות CPA בזהירות ולהימנע מהנחות ערך/LTV חזקות עד שנתוני האופליין אמינים.',
      operator_steps: [
        'Google Ads > Tools > Conversions.',
        'לבדוק אם פעולות המרה אופליין/CRM מיובאות ומוגדרות כראשיות בהתאם לצורך.',
        'לאשר תדירות העלאה והגדרות מניעת כפילויות.',
      ],
      monitor_after_change: 'לנטר עקביות בערכי ההמרה לאחר הפעלת הייבוא.',
      reassess_timing: 'להעלות מחדש דוחות לאחר מחזור דיווח מלא אחד.',
      expected_outcome: 'החלטות אופטימיזציה מבוססות ערך יהיו אמינות יותר.',
      risk_if_ignored: 'עלולה להתבצע הגדלה או הקטנה על בסיס אותות ערך חלקיים.',
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
      confidence: 'ביטחון גבוה',
      category: 'measurementRisk',
      entity_level: 'account',
      entity_name: 'מגן איכות לידים',
      reason: 'העדפות איכות עסקיות הוגדרו, אך ספירת המרות ב-CSV לבדה לא מאמתת איכות ליד.',
      evidence: [
        context.preferredLeadType ? `סוג ליד מועדף: ${context.preferredLeadType}` : 'סוג ליד מועדף לא הוגדר',
        context.goodLeadNote ? `הערת ליד איכותי: ${context.goodLeadNote}` : 'הערת ליד איכותי לא הוגדרה',
      ],
      evidence_state: 'confirmed',
      prerequisite: 'יש להשתמש ב-CRM או בדיקות איכות שיחות כדי לאשר איכות.',
      user_instruction: 'להתייחס לספירת המרות ככמות בלבד; לאמת איכות ליד ידנית לפני הגדלה אגרסיבית.',
      operator_steps: [
        'לבדוק תוצאות CRM או הערות שיחה עבור הישויות הממירות ביותר.',
        'לוודא שהלידים שהומרו תואמים לפרופיל הליד המועדף.',
      ],
      monitor_after_change: 'לנטר שיעור סגירה או יחס לידים איכותיים לצד נפח המרות.',
      reassess_timing: 'לבחון מחדש אחת לשבוע עם דוחות עדכניים ומשוב איכות.',
      expected_outcome: 'החלטות סקייל בטוחות יותר שמותאמות לאיכות ליד אמיתית.',
      risk_if_ignored: 'עלולה להתבצע הגדלה ללידים באיכות נמוכה שנראים טוב רק בספירת המרות גולמית.',
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
      confidence: 'ביטחון גבוה',
      category: 'measurementRisk',
      entity_level: 'account',
      entity_name: 'ברמת החשבון',
      reason: 'אמון המעקב נמוך ולכן החלטות סקייל מבוססות יעילות אינן בטוחות.',
      evidence: ['זוהו בעיות מדידה בנתונים שהועלו או שאמון המעקב מוגדר כלא אמין.'],
      evidence_state: 'confirmed',
      prerequisite: 'לתקן מעקב ולאשר תקינות המרות.',
      user_instruction: 'לא להעלות תקציבים או הצעות מחיר לסקייל בשלב זה.',
      operator_steps: [
        'לעצור כל העלאת תקציב מתוכננת.',
        'לפתור קודם בעיות מעקב בהגדרות המרות ובתגיות של Google Ads.',
      ],
      monitor_after_change: 'לוודא שספירות ההמרה הופכות סבירות לפני חזרה לסקייל.',
      reassess_timing: 'להעלות מחדש דוחות מיד אחרי התחלת תיקוני המעקב ושוב לאחר 3-7 ימים.',
      expected_outcome: 'מונע סקייל על בסיס אותות לא אמינים.',
      risk_if_ignored: 'ייתכן סקייל על חיוביים שגויים והעלאת CPA מהירה.',
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
      confidence: 'ביטחון בינוני',
      category: 'measurementRisk',
      entity_level: 'account',
      entity_name: 'ברמת החשבון',
      reason: 'חלק משדות העלאת הדוחות חסרים ולכן רמת הביטחון בהחלטות יורדת.',
      evidence: [`דוחות חסרים: ${missingReports.join(', ')}`],
      evidence_state: 'confirmed',
      prerequisite: 'ללא',
      user_instruction: 'יש להעלות את הדוחות החסרים כדי לשפר את רמת הביטחון לפני שינויים משמעותיים בחשבון.',
      operator_steps: [
        'לייצא את סוגי הדוחות החסרים מ-Google Ads עבור אותו טווח תאריכים.',
        'להעלות כל קובץ לשדה ההעלאה הקבוע והמתאים בממשק.',
      ],
      monitor_after_change: 'לבדוק שהאזהרות על דוחות חסרים מצטמצמות בהרצה הבאה.',
      reassess_timing: 'להריץ ניתוח מחדש מיד לאחר העלאת הדוחות החסרים.',
      expected_outcome: 'רמת ביטחון גבוהה יותר ודיוק החלטות טוב יותר.',
      risk_if_ignored: 'החלטות חשובות עשויות להישאר במצב בדיקה במקום להיות מוכנות לפעולה.',
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
      confidence: 'ביטחון גבוה',
      category: 'measurementRisk',
      entity_level: 'account',
      entity_name: 'הגדרות עסקיות',
      reason: 'חלק מההמלצות דורשות הקשר עסקי כדי להיות בטוחות וספציפיות.',
      evidence: [`הגדרות חסרות: ${missingBusinessContext.join(', ')}`],
      evidence_state: 'confirmed',
      prerequisite: 'ללא',
      user_instruction: 'יש להשלים את ההגדרות העסקיות החסרות בטופס שמעל אזור ההעלאות.',
      operator_steps: [
        'לפתוח את טופס ההקשר העסקי.',
        'למלא שדות חסרים ולשמור.',
        'להריץ ניתוח מחדש כדי שההחלטות ישתמשו בהקשר שלך.',
      ],
      monitor_after_change: 'לוודא שבהרצה הבאה יש פחות החלטות שחסומות בגלל הקשר חסר.',
      reassess_timing: 'להריץ מחדש מיד לאחר שמירת ההגדרות.',
      expected_outcome: 'ההמלצות יהיו מותאמות יותר לכלכלת העסק ולהיקף השירות שלך.',
      risk_if_ignored: 'פעולות עשויות להישאר כלליות ולדרוש בדיקה ידנית לפני ביצוע.',
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
      confidence: 'ביטחון גבוה',
      category: 'controlRisk',
      entity_level: 'account',
      entity_name: 'מגן בטיחות להתאמה רחבה',
      reason: 'דוח מונחי חיפוש חסר, ולכן עצירת מילות מפתח בהתאמה רחבה מסוכנת יותר.',
      evidence: ['שינויים בהתאמה רחבה בלי ראיות ממונחי חיפוש עלולים לחסום שאילתות רווחיות.'],
      evidence_state: 'confirmed',
      prerequisite: 'יש להעלות דוח מונחי חיפוש לפני קיצוצים אגרסיביים במילים רחבות.',
      user_instruction: 'לא לעצור עדיין מילות מפתח רחבות. קודם לבדוק מונחי חיפוש בפועל.',
      operator_steps: [
        'לייצא ולהעלות דוח מונחי חיפוש.',
        'לבדוק שאילתות לא רלוונטיות ולהוסיף קודם שלילות.',
        'רק לאחר מכן לבחון עצירה של מילות מפתח רחבות.',
      ],
      monitor_after_change: 'לנטר נפח חשיפות והמרות אחרי כל התאמה בהתאמה רחבה.',
      reassess_timing: 'להריץ מחדש לאחר העלאת דוח מונחי חיפוש וביצוע השינויים.',
      expected_outcome: 'שליטה בטוחה יותר בהתאמה רחבה עם סיכון נמוך יותר לפגיעה בביקוש איכותי.',
      risk_if_ignored: 'שאילתות טובות עלולות להיחתך בטעות ולצמצם זרימת לידים.',
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
      confidence: 'ביטחון גבוה',
      category: 'controlRisk',
      entity_level: 'account',
      entity_name: 'מגן בטיחות גאוגרפי',
      reason: 'אזור שירות לא הוגדר, ולכן החרגות גאוגרפיות עדיין אינן בטוחות.',
      evidence: ['ביצועי מיקום לבדם לא יכולים לאשר כיסוי שירות עסקי.'],
      evidence_state: 'confirmed',
      prerequisite: 'יש להגדיר קודם אזור שירות בהקשר העסקי.',
      user_instruction: 'לא להחריג עדיין מיקומים. להשתמש רק בהפחתות הצעת מחיר עד שאזור השירות מוגדר.',
      operator_steps: [
        'להגדיר אזור שירות בטופס ההקשר העסקי.',
        'להשתמש זמנית בהפחתות הצעת מחיר למיקומים במקום החרגות.',
      ],
      monitor_after_change: 'לנטר האם אזורים חלשים נשארים חלשים גם אחרי הפחתות מתונות.',
      reassess_timing: 'להריץ מחדש לאחר שמירת אזור השירות ולאחר 3-7 ימי נתונים חדשים.',
      expected_outcome: 'מונע החרגה בטעות של אזורי שירות תקפים.',
      risk_if_ignored: 'ייתכן שתוחרג בטעות תנועה איכותית מאזורים שבהם אתה כן נותן שירות.',
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
      confidence: 'ביטחון גבוה',
      category: 'measurementRisk',
      entity_level: 'account',
      entity_name: 'מגן בטיחות CPA',
      reason: 'המעקב אינו אמין לחלוטין ולכן מסקנות CPA צריכות להיחשב ככיוון בלבד.',
      evidence: ['רמת האמון במדידה היא מצב זהירות.'],
      evidence_state: 'confirmed',
      prerequisite: 'יש לחזק אמון בהמרות לפני הקצאות מחדש גדולות המבוססות על CPA.',
      user_instruction: 'לבצע רק שינויים קטנים; להימנע מהסטות תקציב גדולות המבוססות רק על CPA.',
      operator_steps: [
        'לאמת הגדרת פעולות המרה ושיטת ספירה.',
        'לבצע רק צעדים הדרגתיים בהצעות מחיר/תקציב עד לשיפור רמת האמון.',
      ],
      monitor_after_change: 'לוודא שספירת ההמרות יציבה לפני צעדים גדולים יותר.',
      reassess_timing: 'להריץ מחדש אחרי בדיקות מעקב ולאחר מחזור הדיווח הבא.',
      expected_outcome: 'מפחית את הסיכון לתגובת יתר על נתוני ביצועים באמון חלקי.',
      risk_if_ignored: 'שינויים גדולים בחשבון עלולים להתבסס על אותות CPA לא יציבים.',
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
  if (measurementTrust === 'untrusted') return 'לא לבצע סקייל עדיין. יש לתקן קודם את אמון המדידה.';
  if (highPriority > 0) return 'יש לפעול עכשיו על פריטי בזבוז ושליטה בעדיפות גבוהה.';
  return 'החשבון יציב מספיק לאופטימיזציה הדרגתית.';
}

function buildKnowledgeBoundaries(measurementTrust, businessContext, reportCoverage) {
  const missingHighReports = reportCoverage.filter(r => !r.present && r.importance === 'high').map(r => r.label);

  return {
    confirmed: [
      'הוצאה, קליקים, חשיפות והמרות מתועדות מתוך קובצי CSV שהועלו.',
      'דפוסי בזבוז וסיכון ברמות הישויות הזמינות.',
    ],
    likely: [
      'חוסר התאמה בכוונת חיפוש ובעיות רלוונטיות שמוסקות מדפוסי ביצועים.',
      'פוטנציאל סקייל של ישויות יעילות כרגע.',
      ...(missingHighReports.length ? [`רמת הביטחון ירדה בגלל דוחות חסרים בעלי השפעה גבוהה: ${missingHighReports.join(', ')}`] : []),
    ],
    unknown: [
      'איכות ליד ושיעור סגירה אמיתי (דורש משוב CRM/מכירות).',
      'איכות שיחות או איכות טפסים מעבר לספירת המרות.',
      'תמונת איכות מלאה של דף הנחיתה מחוץ למדדי CSV.',
      'שלמות המרות אופליין, אלא אם אושרה במפורש בהגדרות.',
      ...(businessContext.offlineConversionsImported === false
        ? ['המרות אופליין מסומנות כלא מיובאות, ולכן מסקנות מבוססות ערך אינן שלמות.']
        : []),
      ...(measurementTrust === 'untrusted'
        ? ['אי אפשר לסמוך על השפעת האופטימיזציה עד לפתרון תקינות המעקב.']
        : []),
    ],
  };
}

function buildSummaryNote(measurementTrust, buckets) {
  if (measurementTrust === 'untrusted') {
    return 'אמון המדידה נמוך. יש לפתור בעיות מדידה לפני שינויי אופטימיזציה משמעותיים.';
  }

  if (buckets.immediateActions.length > 0) {
    return 'יש להתחיל בפעולות המיידיות, ואז לעבור לפי הסדר לשלבי בדיקה וסקייל.';
  }

  return 'לא נמצאו חסמים דחופים. אפשר להמשיך באופטימיזציה זהירה ובניטור.';
}

function buildOperatorSteps(finding, entity, context) {
  const subject = entity.name || 'ישות זו';

  if (finding.category === 'measurementRisk') {
    return [
      'Google Ads > Tools > Conversions.',
      'לאמת פעולות המרה ראשיות והגדרות ספירה.',
      'לבדוק הפעלת תגיות ומניעת כפילויות לפני אופטימיזציות נוספות.',
      'להריץ ניתוח מחדש לאחר תיקוני מדידה.',
    ];
  }

  if (finding.category === 'waste') {
    return [
      'Google Ads > דוח Search terms או Keywords.',
      `לפתוח את ${subject} ולבדוק הוצאה עדכנית מול המרות.`,
      'להחיל שינוי מבוקר (מילת מפתח שלילית או הפחתת הצעת מחיר).',
      'לבדוק השפעה לפני קיצוצים נוספים.',
    ];
  }

  if (finding.category === 'controlRisk') {
    return [
      'לפתוח ב-Google Ads את הקמפיין/קבוצת המודעות הרלוונטיים.',
      'לבדוק סוג התאמה, רלוונטיות מודעה והגדרות מבנה.',
      'להחיל תיקון מבוקר אחד בכל פעם.',
      'לנטר איכות ומגמת CPA אחרי העדכון.',
    ];
  }

  return [
    'לוודא שאמון המדידה וניקוי הבזבוז הושלמו.',
    'לפתוח את הישות הרלוונטית ולהחיל בדיקת סקייל קטנה (+5% עד +10%).',
    context.targetCpl != null
      ? `לוודא שה-CPA נשאר בתוך יעד ה-CPL (CA$${context.targetCpl}).`
      : 'לנטר CPA מקרוב בתקופת הבדיקה.',
    'לבחון מחדש לפני הוספת תקציב או העלאות הצעת מחיר נוספות.',
  ];
}

function buildMonitorGuidance(finding) {
  if (finding.category === 'measurementRisk') {
    return 'לנטר עקביות בספירת המרות והיגיון ביחס המרות-לקליקים.';
  }
  if (finding.category === 'waste') {
    return 'לנטר ירידת הוצאה ושימור המרות אחרי השינוי.';
  }
  if (finding.category === 'controlRisk') {
    return 'לנטר CTR, מדדי איכות ויציבות CPA.';
  }
  return 'לנטר CPA ונפח המרות לפני הרחבת השינויים.';
}

function confidenceRank(confidence) {
  if (confidence === 'ביטחון גבוה') return 0;
  if (confidence === 'ביטחון בינוני') return 1;
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
