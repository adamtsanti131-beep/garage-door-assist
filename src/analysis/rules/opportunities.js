/**
 * opportunities.js
 * Rules that identify strong performers and scaling opportunities.
 * Focus: lead generation efficiency, growth potential.
 */

import { THRESHOLDS as T } from '../thresholds.js';

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
    if (!hasValue(r.conversions) || r.conversions < Math.max(T.minLeadsForWinner, 3)) continue;
    if (!hasValue(r.cost) || r.cost <= 0) continue;
    if (!hasValue(r.clicks) || r.clicks < 10) continue; // stricter
    if (r.cost < 30) continue; // stricter spend

    const cpl = r.cost / r.conversions;
    if (cpl > T.cplGood) continue; // only <= 75 CAD

    const label = r.searchTerm ?? r.keyword ?? 'מונח לא ידוע';
    const isExcellent = cpl <= T.cplExcellent;
    const clicks = r.clicks ?? 0;

    // Excellent CPL: High priority to protect and scale
    if (isExcellent) {
      findings.push({
        category: 'opportunity',
        severity: 'high',
        what: `"${label}" יצר ${r.conversions} לידים ב-CA$${fmt(cpl)} CPL — ביצוע עליון.`,
        why: 'זה הביצוע הטוב ביותר בנתונים שלך. עליך להגן על התקציב וללחוץ להגדלת נפח בפידליטי זו.',
        action: r.searchTerm
          ? `לא להוריד הצעת מחיר. בעד להעלות ב-15%-20% וניטור יעילות. אם CPL נשמר בTa$${T.cplExcellent}, להגדיל עוד.`
          : `להתמקד בקמפיין זה. להגדיל תקציב יומי בהדרגה ובמקביל להוריד הצעות במקומות חלשים יותר.`,
        data: r,
        signal: 'strong-leader',
      });
    }
    // Good CPL with solid volume: Actionable scaling opportunity
    else if (clicks >= 10) {
      findings.push({
        category: 'opportunity',
        severity: 'medium',
        what: `"${label}" יצר ${r.conversions} לידים ב-CA$${fmt(cpl)} CPL — יעיל ובנפח משמעותי.`,
        why: 'הביצועים חזקים ויש מספיק נתונים. זו מועמדת ישירה להגדלה מהירה.',
        action: r.searchTerm
          ? `להעלות הצעת מחיר ב-20%. אם CPL נשמר ≤ CA$${T.cplBorderline}, להגדיל עוד 20% בשבוע הבא.`
          : `להגדיל תקציב קמפיין זה בנדלן של 20-25%. ניטור CPL בכל 3-4 ימים.`,
        data: r,
        signal: 'strong-leader',
      });
    }
    // SUPPRESSED: Low-volume findings have no clear action (wait for more data)
    // Don't generate LOW severity — insufficient data = insufficient action clarity
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
    if (!hasValue(r.conversions) || r.conversions < 2) continue;
    if (!hasValue(r.cost) || r.cost <= 0 || r.cost > 120) continue;
    if (r.cost < 20) continue;
    if (!hasValue(r.clicks) || r.clicks < T.minClicksForConfidentJudgment) continue;
    if (!hasValue(r.conversionRate) || r.conversionRate < T.strongConvRatePct) continue;

    const label = r.searchTerm ?? r.keyword ?? 'מונח לא ידוע';
    findings.push({
      category: 'opportunity',
      severity: 'medium',
      what: `"${label}" הממיר ב-${fmt(r.conversionRate)}% בהוצאה נמוכה של CA$${fmt(r.cost)} בלבד.`,
      why: 'שיעור המרה גבוה עם הוצאה נמוכה פירושו שיש בך יד נוקטת פקודות ונפח שיכול להתרחב מיד.',
      action: 'להעלות הצעת מחיר ב-20%-25% מידית. ניטור CPL לפני שתגדיל עוד. זו לא השערה — זו מפעל היעילות שלך.',
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
    if (!hasValue(camp.conversions) || camp.conversions < T.minLeadsForWinner) continue;
    if (!hasValue(camp.cost) || camp.cost <= 0) continue;
    if (camp.cost < 100) continue;

    const cpl = camp.cost / camp.conversions;
    if (cpl > avgCpl * 0.75) continue; // needs to be meaningfully better (25%+)

    findings.push({
      category: 'opportunity',
      severity: 'high',
      what: `קמפיין "${camp.campaign ?? 'קמפיין לא ידוע'}" עומד על CA$${fmt(cpl)} CPL — 25%+ טוב מממוצע החשבון (CA$${fmt(avgCpl)}).`,
      why: 'זוהי קמפיין מבטחת — כל שקל שהוצא כאן יעיל יותר מהרוב. זה הזמן להעביר תקציב למכאן.',
      action: 'להשקיע תקציב נוסף ישירות בקמפיין זה. העבר מינימום 15%-20% מתקציבים תת-ביצועים לכאן וראה גדילה מיידית.',
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
    if (!hasValue(camp.conversions) || camp.conversions < 1) continue;
    if (!hasValue(camp.cost) || camp.cost <= 0 || camp.cost < 100) continue;

    const cpl = hasValue(camp.cost) && camp.conversions > 0
      ? camp.cost / camp.conversions
      : null;

    if (cpl && cpl > T.cplPoor) continue; // don't recommend scaling a poor performer

    findings.push({
      category: 'opportunity',
      severity: 'medium',
      what: `קמפיין "${camp.campaign ?? 'קמפיין לא ידוע'}" מאבד ${fmt(camp.searchLostIsBudget)}% מחשיפות בחיפוש בגלל תקציב מוגבל.`,
      why: 'הקמפיין ממיר ביעילות אך תקציב יומי נמוך חוסם את הלידים. זה כסף שנשאר על השולחן.',
      action: 'הגדל תקציב יומי ב-25%-50%. ניטור ה-CPL לאחר 3-4 ימים. אם הוא נשמר בטווח, להגדיל עוד.',
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
    if (row.cost <= 0) continue;
    if (row.conversions < Math.max(T.minLeadsForScaling, 2)) continue;
    if (!hasValue(row.clicks) || row.clicks < 15) continue;
    if (row.cost < 60) continue;

    const cpl = row.cost / row.conversions;
    if (cpl > T.cplGood) continue;

    // ONLY HIGH or MEDIUM - no low severity device findings
    findings.push({
      category: 'opportunity',
      severity: cpl <= T.cplExcellent ? 'high' : 'medium',
      what: `${row.device} יצר ${row.conversions} לידים ב-CA$${fmt(cpl)} CPL.`,
      why: `${row.device} משמא כהפלח היעיל שלך בדמוגרפיית מכשירים. זה חוק יעילות שצריך לנצל מיד.`,
      action: `הפעל +${cpl <= T.cplExcellent ? '25%' : '15%'} התאמת הצעות ל-${row.device}. ניטור יומי לפחות 3 ימים.`,
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
    if (row.cost <= 0) continue;
    if (row.conversions < Math.max(T.minLeadsForScaling, 2)) continue;
    if (!hasValue(row.clicks) || row.clicks < 10) continue;
    if (row.cost < 50) continue;

    const cpl = row.cost / row.conversions;
    if (cpl > T.cplGood) continue;

    // ONLY HIGH or MEDIUM - no low severity location findings
    findings.push({
      category: 'opportunity',
      severity: cpl <= T.cplExcellent ? 'high' : 'medium',
      what: `${row.location} יצר ${row.conversions} לידים ב-CA$${fmt(cpl)} CPL.`,
      why: `זה האזור היעיל ביותר שלך גיאוגרפית. כל דולר שהוצא כאן מממיר ביעילות.`,
      action: `הפעל +${cpl <= T.cplExcellent ? '30%' : '20%'} התאמות הצעות ל-${row.location}. בנוסף, בחן הגדלת תקציב אזורי עבור ${row.location}.`,
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
    if (kept.length >= 8) break;

    const dedupeKey = dedupeOpportunityKey(item);
    if (seen.has(dedupeKey)) continue;

    const cls = opportunityClass(item);
    const classLimit = cls === 'termOrKeyword' ? 3 : 2;
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
