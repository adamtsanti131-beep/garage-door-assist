/**
 * opportunities.js
 * Rules that identify strong performers and scaling opportunities.
 * Focus: lead generation efficiency, growth potential.
 */

import { THRESHOLDS as T } from '../thresholds.js';

const OPPORTUNITY_SAMPLE = {
  minCost: 60,
  minClicks: 15,
  minConversions: 3,
  minCampaignCost: 120,
  minCampaignClicks: 20,
  minDeviceCost: 80,
  minLocationCost: 80,
};

export function opportunityRules(data) {
  const findings = [];
  const {
    searchTerms = [],
    keywords = [],
    campaigns = [],
    devices = [],
    locations = [],
  } = data;

  findings.push(...strongLeaders([...searchTerms, ...keywords]));
  findings.push(...scalingCandidates([...searchTerms, ...keywords]));
  findings.push(...outperformingCampaigns(campaigns));
  findings.push(...budgetLimitedWinners(campaigns));
  findings.push(...highIntentDevices(devices));
  findings.push(...highIntentLocations(locations));

  return compressOpportunities(findings);
}

// ── Rules ─────────────────────────────────────────────────────────────────────

/**
 * Search terms/keywords with strong lead generation and good CPL.
 * ONLY flag actionable opportunities: excellent CPL OR good CPL with real volume.
 * Suppress low-volume findings (no decision clarity without more data).
 */
function strongLeaders(rows) {
  const findings = [];
  for (const r of rows) {
    if (!hasValue(r.cost) || r.cost <= 0) continue;

    const label = r.searchTerm ?? r.keyword ?? 'מונח לא ידוע';
    if (!hasHardOpportunitySample(r, {
      minCost: OPPORTUNITY_SAMPLE.minCost,
      minClicks: OPPORTUNITY_SAMPLE.minClicks,
      minConversions: Math.max(T.minLeadsForWinner, OPPORTUNITY_SAMPLE.minConversions),
    })) {
      maybeAddWeakSample(findings, r, label, 'אין עדיין נפח מספיק של עלות/קליקים/המרות כדי להכריז על מנצח לסקייל.');
      continue;
    }

    const cpl = r.cost / r.conversions;
    if (cpl > T.cplGood) continue; // only <= 75 CAD

    const isExcellent = cpl <= T.cplExcellent;

    // Excellent CPL with hard sample threshold: safe scaling candidate
    if (isExcellent) {
      findings.push({
        category: 'opportunity',
        severity: 'high',
        what: `"${label}" יצר ${r.conversions} לידים ב-CA$${fmt(cpl)} CPL — ביצוע עליון.`,
        why: 'זה הביצוע הטוב ביותר בנתונים שלך. עליך להגן על התקציב וללחוץ להגדלת נפח בפידליטי זו.',
        action: r.searchTerm
          ? 'small_test_only: לא להוריד הצעת מחיר, לבצע בדיקת סקייל קטנה ומדורגת בלבד (עד 10%) עם ניטור CPL צמוד.'
          : 'small_test_only: לבחון הגדלה הדרגתית קטנה בלבד בקמפיין זה ולנטר CPL לפני כל שלב נוסף.',
        data: r,
        signal: 'strong-leader',
      });
    }
    // Good CPL with hard sample threshold: actionable but controlled
    else {
      findings.push({
        category: 'opportunity',
        severity: 'medium',
        what: `"${label}" יצר ${r.conversions} לידים ב-CA$${fmt(cpl)} CPL — יעיל ובנפח משמעותי.`,
        why: 'הביצועים חזקים ויש מספיק נתונים. זו מועמדת ישירה להגדלה מהירה.',
        action: r.searchTerm
          ? 'review_before_acting: לבצע קודם בדיקה ידנית קצרה, ואז להפעיל בדיקת סקייל קטנה בלבד.'
          : 'review_before_acting: לאשר קודם יציבות CPL ואז לבצע הגדלה קטנה ומדורגת בלבד.',
        data: r,
        signal: 'strong-leader',
      });
    }
  }
  return findings;
}

/**
 * Search terms/keywords with good lead rate but low spend — scalable.
 * 2+ leads, 20-120 CAD spend, conversion rate > 5%.
 * ONLY medium+ severity (actionable findings only).
 */
function scalingCandidates(rows) {
  const findings = [];
  for (const r of rows) {
    if (!hasValue(r.cost) || r.cost <= 0 || r.cost > 160) continue;
    if (!hasValue(r.conversionRate) || r.conversionRate < T.strongConvRatePct) continue;

    const label = r.searchTerm ?? r.keyword ?? 'מונח לא ידוע';
    if (!hasHardOpportunitySample(r, {
      minCost: OPPORTUNITY_SAMPLE.minCost,
      minClicks: OPPORTUNITY_SAMPLE.minClicks,
      minConversions: OPPORTUNITY_SAMPLE.minConversions,
    })) {
      maybeAddWeakSample(findings, r, label, 'יחס ההמרה חיובי, אך המדגם קטן מדי ולכן אין עדיין המלצת סקייל אמינה.');
      continue;
    }

    findings.push({
      category: 'opportunity',
      severity: 'medium',
      what: `"${label}" הממיר ב-${fmt(r.conversionRate)}% בהוצאה נמוכה של CA$${fmt(r.cost)} בלבד.`,
      why: 'שיעור המרה גבוה עם הוצאה נמוכה פירושו שיש בך יד נוקטת פקודות ונפח שיכול להתרחב מיד.',
      action: 'review_before_acting: לבצע בדיקת סקייל קטנה בלבד לאחר אימות יציבות במדגם הנוכחי.',
      data: r,
      signal: 'scale-candidate',
    });
  }
  return findings;
}

/**
 * Campaigns performing better than the account average CPL.
 * Only flag campaigns that are meaningfully better (25%+).
 */
function outperformingCampaigns(campaigns) {
  if (campaigns.length < 2) return [];

  const avgCpl = computeAvgCpl(campaigns);
  if (!avgCpl) return [];

  const findings = [];
  for (const camp of campaigns) {
    if (!hasHardOpportunitySample(camp, {
      minCost: OPPORTUNITY_SAMPLE.minCampaignCost,
      minClicks: OPPORTUNITY_SAMPLE.minCampaignClicks,
      minConversions: Math.max(T.minLeadsForWinner, OPPORTUNITY_SAMPLE.minConversions),
    })) continue;

    const cpl = camp.cost / camp.conversions;
    if (cpl > avgCpl * 0.75) continue; // needs to be meaningfully better (25%+)

    findings.push({
      category: 'opportunity',
      severity: 'high',
      what: `קמפיין "${camp.campaign ?? 'קמפיין לא ידוע'}" עומד על CA$${fmt(cpl)} CPL — 25%+ טוב מממוצע החשבון (CA$${fmt(avgCpl)}).`,
      why: 'זוהי קמפיין מבטחת — כל שקל שהוצא כאן יעיל יותר מהרוב. זה הזמן להעביר תקציב למכאן.',
      action: 'review_before_acting: לבצע קודם בדיקת יציבות קצרה, ואז להעביר תקציב בהדרגה ובצעדים קטנים בלבד.',
      data: camp,
      signal: 'outperforming-campaign',
    });
  }
  return findings;
}

/**
 * Campaigns limited by budget based on lost impression share data.
 * Only flag if losing > 30% impressions due to budget AND campaign is actually converting.
 */
function budgetLimitedWinners(campaigns) {
  const findings = [];
  for (const camp of campaigns) {
    if (!hasValue(camp.searchLostIsBudget)) continue;
    if (camp.searchLostIsBudget < T.highLostIsBudgetWarn * 100) continue;
    if (!hasHardOpportunitySample(camp, {
      minCost: OPPORTUNITY_SAMPLE.minCampaignCost,
      minClicks: OPPORTUNITY_SAMPLE.minCampaignClicks,
      minConversions: OPPORTUNITY_SAMPLE.minConversions,
    })) continue;

    const cpl = hasValue(camp.cost) && camp.conversions > 0
      ? camp.cost / camp.conversions
      : null;

    if (cpl && cpl > T.cplPoor) continue; // don't recommend scaling a poor performer

    findings.push({
      category: 'opportunity',
      severity: 'medium',
      what: `קמפיין "${camp.campaign ?? 'קמפיין לא ידוע'}" מאבד ${fmt(camp.searchLostIsBudget)}% מחשיפות בחיפוש בגלל תקציב מוגבל.`,
      why: 'הקמפיין ממיר ביעילות אך תקציב יומי נמוך חוסם את הלידים. זה כסף שנשאר על השולחן.',
      action: 'review_before_acting: לבצע בדיקה הדרגתית קטנה בתקציב ולנטר CPL לפני כל הרחבה נוספת.',
      data: camp,
      signal: 'budget-limited-winner',
    });
  }
  return findings;
}

function highIntentDevices(devices) {
  const findings = [];
  for (const row of devices) {
    if (!hasValue(row.device) || !hasValue(row.conversions) || !hasValue(row.cost)) continue;
    if (!hasHardOpportunitySample(row, {
      minCost: OPPORTUNITY_SAMPLE.minDeviceCost,
      minClicks: OPPORTUNITY_SAMPLE.minClicks,
      minConversions: Math.max(T.minLeadsForScaling, OPPORTUNITY_SAMPLE.minConversions),
    })) continue;

    const cpl = row.cost / row.conversions;
    if (cpl > T.cplGood) continue;

    // ONLY HIGH or MEDIUM - no low severity device findings
    findings.push({
      category: 'opportunity',
      severity: cpl <= T.cplExcellent ? 'high' : 'medium',
      what: `במכשיר "${row.device}" נוצרו ${row.conversions} לידים בעלות CA$${fmt(cpl)} לליד.`,
      why: `המכשיר "${row.device}" מסתמן כפלח היעיל ביותר שלך בדמוגרפיית מכשירים. זהו אות יעילות שכדאי למנף בהדרגה.`,
      action: `small_test_only: להפעיל התאמת הצעות קטנה בלבד ל-${row.device} (עד 10%) ולנטר לפני הרחבה.`,
      data: row,
      signal: 'high-intent-device',
    });
  }
  return findings;
}

function highIntentLocations(locations) {
  const findings = [];
  for (const row of locations) {
    if (!hasValue(row.location) || !hasValue(row.conversions) || !hasValue(row.cost)) continue;
    if (!hasHardOpportunitySample(row, {
      minCost: OPPORTUNITY_SAMPLE.minLocationCost,
      minClicks: OPPORTUNITY_SAMPLE.minClicks,
      minConversions: Math.max(T.minLeadsForScaling, OPPORTUNITY_SAMPLE.minConversions),
    })) continue;

    const cpl = row.cost / row.conversions;
    if (cpl > T.cplGood) continue;

    // ONLY HIGH or MEDIUM - no low severity location findings
    findings.push({
      category: 'opportunity',
      severity: cpl <= T.cplExcellent ? 'high' : 'medium',
      what: `באזור "${row.location}" נוצרו ${row.conversions} לידים בעלות CA$${fmt(cpl)} לליד.`,
      why: `זה האזור היעיל ביותר שלך גיאוגרפית. כל דולר שהוצא כאן מממיר ביעילות.`,
      action: `small_test_only: לבצע בדיקת מיקום קטנה בלבד עבור ${row.location} אחרי בדיקת התאמה לאזור השירות.`,
      data: row,
      signal: 'high-intent-location',
    });
  }
  return findings;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasValue(v) { return v !== null && v !== undefined; }
function fmt(n) { return typeof n === 'number' ? n.toFixed(2) : '—'; }

function computeAvgCpl(campaigns) {
  const valid = campaigns.filter(c => hasValue(c.conversions) && c.conversions > 0 && hasValue(c.cost));
  if (!valid.length) return null;
  const totalCost = valid.reduce((a, c) => a + c.cost, 0);
  const totalConvs = valid.reduce((a, c) => a + c.conversions, 0);
  return totalConvs > 0 ? totalCost / totalConvs : null;
}

function compressOpportunities(findings) {
  const ranked = findings
    .filter(hasValidEconomicSignal)
    .sort((a, b) => scoreOpportunity(b) - scoreOpportunity(a));

  const kept = [];
  const seen = new Set();
  const perClassCount = {
    termOrKeyword: 0,
    campaign: 0,
    device: 0,
    location: 0,
    other: 0,
  };

  for (const item of ranked) {
    if (kept.length >= 6) break;

    const dedupeKey = dedupeOpportunityKey(item);
    if (seen.has(dedupeKey)) continue;

    const cls = opportunityClass(item);
    const classLimit = cls === 'termOrKeyword' ? 2 : 1;
    if ((perClassCount[cls] ?? 0) >= classLimit) continue;

    seen.add(dedupeKey);
    perClassCount[cls] = (perClassCount[cls] ?? 0) + 1;
    kept.push(item);
  }

  return kept;
}

function hasValidEconomicSignal(item) {
  const row = item?.data ?? {};
  if (!hasValue(row.cost) || row.cost <= 0) return false;
  if (!hasValue(row.conversions) || row.conversions <= 0) return false;
  return true;
}

function scoreOpportunity(item) {
  const row = item?.data ?? {};
  const severityScore = item.severity === 'high' ? 3 : item.severity === 'medium' ? 2 : 1;
  const convScore = Math.min(4, Math.floor((row.conversions ?? 0) / 2));
  const spendScore = row.cost >= 120 ? 3 : row.cost >= 60 ? 2 : 1;
  const clickScore = row.clicks >= 25 ? 2 : row.clicks >= 10 ? 1 : 0;
  return severityScore + convScore + spendScore + clickScore;
}

function dedupeOpportunityKey(item) {
  const row = item?.data ?? {};
  // Deduplicate by entity identity (type + value), not by signal.
  // Prevents the same search term or keyword appearing under both
  // strong-leader and scale-candidate signals simultaneously.
  const entityType = row.searchTerm ? 'term'
    : row.keyword  ? 'kw'
    : row.campaign ? 'camp'
    : row.device   ? 'dev'
    : row.location ? 'loc'
    : 'other';
  const subject = normalizeSubject(
    row.searchTerm ?? row.keyword ?? row.campaign ?? row.device ?? row.location ?? 'unknown'
  );
  return `${entityType}::${subject}`;
}

function opportunityClass(item) {
  const row = item?.data ?? {};
  if (row.searchTerm || row.keyword) return 'termOrKeyword';
  if (row.campaign) return 'campaign';
  if (row.device) return 'device';
  if (row.location) return 'location';
  return 'other';
}

function normalizeSubject(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasHardOpportunitySample(row, { minCost, minClicks, minConversions }) {
  if (!hasValue(row?.cost) || row.cost <= 0 || row.cost < minCost) return false;
  if (!hasValue(row?.clicks) || row.clicks < minClicks) return false;
  if (!hasValue(row?.conversions) || row.conversions < minConversions) return false;
  return true;
}

function maybeAddWeakSample(findings, row, label, why) {
  if (!hasValue(row?.cost) || row.cost <= 0) return;
  if (!hasValue(row?.clicks) || row.clicks < 5) return;
  if (!hasValue(row?.conversions) || row.conversions <= 0) return;

  findings.push({
    category: 'opportunity',
    severity: 'low',
    what: `"${label}" מציג אות חיובי, אך המדגם עדיין חלש להחלטת סקייל בטוחה.`,
    why,
    action: 'small_test_only: להימנע מסקייל אגרסיבי. לכל היותר בדיקה קטנה ומדודה עד להצטברות נתונים נוספים.',
    data: row,
    signal: 'insufficient-sample',
  });
}
