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
 * Excellent (≤55): Always flag as opportunity to protect and scale.
 * Good (56–75): Only flag if there's real volume to justify scaling.
 */
function strongLeaders(rows) {
  const findings = [];
  for (const r of rows) {
    if (!hasValue(r.conversions) || r.conversions < Math.max(T.minLeadsForWinner, 2)) continue;
    if (!hasValue(r.cost) || r.cost <= 0) continue;
    if (!hasValue(r.clicks) || r.clicks < 8) continue;
    if (r.cost < 25) continue;

    const cpl = r.cost / r.conversions;
    if (cpl > T.cplGood) continue; // only <= 75 CAD

    const label = r.searchTerm ?? r.keyword ?? 'מונח לא ידוע';
    const isExcellent = cpl <= T.cplExcellent;
    const clicks = r.clicks ?? 0;

    // Excellent CPL: Always opportunity
    if (isExcellent) {
      findings.push({
        category: 'opportunity',
        severity: 'high',
        what: `"${label}" יצר ${r.conversions} המרות ב-CA$${fmt(cpl)} ל-CPA (הוצאה CA$${fmt(r.cost)}).`,
        why: 'זהו מנצח יעיל עם מספיק נתונים כדי להגן עליו ולהגדיל אותו.',
        action: r.searchTerm
          ? `לקדם את השאילתה הזו למילת מפתח בהתאמה מדויקת ולהעלות הצעת מחיר בזהירות תוך ניטור CPA.`
          : 'להגן על נתח התקציב ולבדוק העלאות הצעת מחיר מדודות לצורך הגדלת נפח.',
        data: r,
        signal: 'strong-leader',
      });
    }
    // Good CPL with meaningful volume: Opportunity to scale
    else if (clicks >= 10) {
      findings.push({
        category: 'opportunity',
        severity: 'medium',
        what: `"${label}" יצר ${r.conversions} המרות ב-CA$${fmt(cpl)} ל-CPA (הוצאה CA$${fmt(r.cost)}).`,
        why: 'הביצועים יעילים עם נפח שימושי, ולכן זו מועמדת מעשית להגדלה.',
        action: r.searchTerm
          ? 'להעלות הצעת מחיר ב-15%-25% בשלבים מבוקרים ולעקוב אחרי יציבות ה-CPA.'
          : 'להגדיל הצעות מחיר בהדרגה ולנטר יעילות המרות בכל מחזור.',
        data: r,
        signal: 'strong-leader',
      });
    }
    // Good CPL but low volume: Just good performer, don't push scaling
    else {
      findings.push({
        category: 'opportunity',
        severity: 'low',
        what: `"${label}" יצר ${r.conversions} המרות ב-CA$${fmt(cpl)} ל-CPA.`,
        why: 'היעילות טובה אך גודל המדגם עדיין מוגבל.',
        action: r.searchTerm
          ? 'להמשיך להגן על המונח ולהמיר אותו להתאמה מדויקת אם עדיין לא בודד.'
          : 'לשמור על התמיכה הנוכחית ולשקול הגדלה מחדש כשנפח הנתונים יגדל.',
        data: r,
        signal: 'strong-leader',
      });
    }
  }
  return findings;
}

/**
 * Search terms/keywords with good lead rate but low spend — scalable.
 * 2+ leads, < 50 CAD spend, conversion rate > 5%.
 */
function scalingCandidates(rows) {
  const findings = [];
  for (const r of rows) {
    if (!hasValue(r.conversions) || r.conversions < 2) continue;
    if (!hasValue(r.cost) || r.cost <= 0 || r.cost > 120) continue;
    if (r.cost < 20) continue;
    if (!hasValue(r.clicks) || r.clicks < 10) continue;
    if (!hasValue(r.conversionRate) || r.conversionRate < Math.max(T.strongConvRatePct, 8)) continue;

    const label = r.searchTerm ?? r.keyword ?? 'מונח לא ידוע';
    findings.push({
      category: 'opportunity',
      severity: 'medium',
      what: `"${label}" עם שיעור המרה של ${fmt(r.conversionRate)}% בהוצאה של CA$${fmt(r.cost)} בלבד.`,
      why: 'שיעור המרה גבוה בהוצאה נמוכה מרמז על פוטנציאל נפח לא ממומש.',
      action: 'להעלות הצעות מחיר ב-15%-20% ולנטר CPA תוך כדי הגדלת נפח.',
      data: r,
      signal: 'scale-candidate',
    });
  }
  return findings;
}

/**
 * Campaigns performing better than the account average CPL.
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
      what: `הקמפיין "${camp.campaign ?? 'קמפיין לא ידוע'}" עומד על CA$${fmt(cpl)} CPA, לפחות 25% טוב מהממוצע בחשבון CA$${fmt(avgCpl)}.`,
      why: 'הסטת תקציב לכאן צפויה להגדיל המרות ביעילות גבוהה יותר מהממוצע.',
      action: 'להגן קודם על תקציב הקמפיין הזה ולהעביר תקציב מקמפיינים חלשים לפי הצורך.',
      data: camp,
      signal: 'outperforming-campaign',
    });
  }
  return findings;
}

/**
 * Campaigns limited by budget based on lost impression share data.
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
      what: `הקמפיין "${camp.campaign ?? 'קמפיין לא ידוע'}" מאבד ${fmt(camp.searchLostIsBudget)}% מנתח החשיפות בחיפוש בגלל תקציב.`,
      why: 'הקמפיין ממיר אך מוגבל תקציבית, ולכן נפח הלידים כנראה חסום.',
      action: 'להגדיל תקציב יומי בהדרגה ובשליטה, ולוודא שה-CPA נשאר בטווח תקין.',
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

    findings.push({
      category: 'opportunity',
      severity: cpl <= T.cplExcellent ? 'high' : 'medium',
      what: `פלח המכשיר "${row.device}" ייצר ${row.conversions} המרות ב-CA$${fmt(cpl)} CPA.`,
      why: 'יעילות ברמת מכשיר מצביעה היכן תוספת הצעת מחיר יכולה לייצר לידים נוספים.',
      action: `להחיל התאמות הצעת מחיר חיוביות עבור ${row.device} תוך ניטור איכות ההמרות.`,
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

    findings.push({
      category: 'opportunity',
      severity: cpl <= T.cplExcellent ? 'high' : 'medium',
      what: `פלח המיקום "${row.location}" ייצר ${row.conversions} המרות ב-CA$${fmt(cpl)} CPA.`,
      why: 'הביצועים ברמת מיקום תומכים בהגדלת הצעת מחיר או תקציב גאוגרפית וממוקדת.',
      action: `לתעדף את המיקום היעיל "${row.location}" עם העלאות מבוקרות של הצעת מחיר או תקציב.`,
      data: row,
      signal: 'high-intent-location',
    });
  }
  return findings;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasValue(v) { return v !== null && v !== undefined; }
function fmt(n) { return n != null ? n.toFixed(2) : '—'; }

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
  const subject = normalizeSubject(
    row.searchTerm ?? row.keyword ?? row.campaign ?? row.device ?? row.location ?? item.signal ?? 'unknown'
  );
  return `${item.signal ?? 'generic'}::${subject}`;
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
