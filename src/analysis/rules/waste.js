/**
 * waste.js
 * Rules that detect budget being spent with no meaningful return (zero leads).
 * Focus: lead generation efficiency, not profitability.
 * Language: Hebrew (user-facing), practical and direct.
 */

import { THRESHOLDS as T } from '../thresholds.js';

export function wasteRules(data) {
  const findings = [];
  const { searchTerms = [], keywords = [], campaigns = [], adGroups = [] } = data;

  findings.push(...zeroLeadsHighSpend([...searchTerms, ...keywords]));
  findings.push(...overallWastedSpendPct([...campaigns, ...adGroups, ...searchTerms, ...keywords]));
  findings.push(...expensiveKeywordsNoLeads(keywords));
  findings.push(...nonConvertingAdGroups(adGroups));

  return findings;
}

// ── Individual rules ──────────────────────────────────────────────────────────

/**
 * Search terms or keywords with meaningful spend or clicks but zero leads.
 * Waste flagging logic:
 * - cost >= 75 CAD, OR
 * - clicks >= 15, OR
 * - (cost >= 50 AND clicks >= 15)
 */
function zeroLeadsHighSpend(rows) {
  const findings = [];
  for (const r of rows) {
    if (!hasValue(r.cost) || !hasValue(r.clicks)) continue;
    if (r.conversions !== 0 && r.conversions !== null) continue; // only zero leads

    // Check waste threshold
    const meetsWasteThreshold =
      r.cost >= T.minSpendForWaste ||
      r.clicks >= T.minClicksForWaste ||
      (r.cost >= T.minSpendWithClicksGate && r.clicks >= T.minClicksForWaste);

    if (!meetsWasteThreshold) continue;

    const label = r.searchTerm ?? r.keyword ?? 'לא ידוע';
    const severity = r.cost >= T.minSpendForWaste ? 'high' : 'medium';

    findings.push({
      category: 'waste',
      severity,
      what: `"${label}" — הוצאה CA$${fmt(r.cost)} ללא לידים (${r.clicks} קליקים).`,
      why: `הוצאה וקליקים מספיקים כדי לדעת שזה בזבוז. שאילתה זו לא מביאה לנו לידים שיכולים להפוך ללקוחות.`,
      action: r.searchTerm
        ? `הוסף את "${label}" כמילה שלילית. אם חלק מהביטוי רלוונטי — הוסף רק את החלק הזה כמילה מדוקדקת.`
        : `בדוק את דוח מילות החיפוש כדי לראות אם היו שאילתות רלוונטיות. הוסף שאילתות שלא רלוונטיות כמילים שליליות.`,
      data: r,
    });
  }
  return findings;
}

/**
 * What percentage of total spend has zero leads?
 */
function overallWastedSpendPct(rows) {
  const totalSpend = sumNN(rows, 'cost');
  if (!totalSpend || totalSpend === 0) return [];

  const wastedSpend = rows
    .filter(r => r.conversions === 0 && hasValue(r.cost) && r.cost > 5)
    .reduce((a, r) => a + r.cost, 0);

  const pct = wastedSpend / totalSpend;

  if (pct >= T.wastedSpendCritPct) {
    return [{
      category: 'waste',
      severity: 'high',
      what: `${pct100(pct)}% מהתקציב (CA$${fmt(wastedSpend)}) לא הביא לידים.`,
      why: `זה חלק משמעותי מהתקציב שלך בלי תוצאה. חלק גדול מזה צריך מתקן כן.`,
      action: `בדוק את דוח מילות החיפוש. הוסף כל שאילתה לא רלוונטית כמילה שלילית. בדוק מילות broad match.`,
      data: { wastedSpend, totalSpend },
    }];
  }

  if (pct >= T.wastedSpendWarnPct) {
    return [{
      category: 'waste',
      severity: 'medium',
      what: `${pct100(pct)}% מהתקציב (CA$${fmt(wastedSpend)}) לא הביא לידים.`,
      why: `חלק משמעותי מהתקציב הולך לשאילתות שלא מתורגמות ללידים. זה כדאי לתקן כדי להשפר.`,
      action: `בדוק את דוח מילות החיפוש. הוסף שאילתות שלא רלוונטיות כמילים שליליות. בחן אפשרויות כיוונון ל-broad match.`,
      data: { wastedSpend, totalSpend },
    }];
  }

  return [];
}

/**
 * Keywords with significant clicks and spend but zero leads.
 */
function expensiveKeywordsNoLeads(keywords) {
  const findings = [];
  for (const kw of keywords) {
    if (!hasValue(kw.cost) || !hasValue(kw.clicks)) continue;
    if (kw.conversions !== 0 && kw.conversions !== null) continue;
    if (kw.clicks < T.minClicksForConfidentJudgment) continue; // need 15+ clicks for strong judgment

    findings.push({
      category: 'waste',
      severity: 'medium',
      what: `"${kw.keyword ?? 'לא ידוע'}" [${kw.matchType ?? '?'}] — ${kw.clicks} קליקים, CA$${fmt(kw.cost)}, ללא לידים.`,
      why: `אחרי ${kw.clicks} קליקים, הנתונים ברורים — המילה הזו לא מביאה לידים. בעיה עשויה להיות בתנועה, בתוכן המודעה או בעמוד הנחיתה.`,
      action: `הפחת את ההצעה ב-20%. בדוק אם הניסוח של המודעה ודף הנחיתה מתאימים למילה. אם לא השתפר אחרי שבוע — הסר את המילה.`,
      data: kw,
    });
  }
  return findings;
}

/**
 * Ad groups spending significantly with zero leads.
 */
function nonConvertingAdGroups(adGroups) {
  const findings = [];
  for (const ag of adGroups) {
    if (!hasValue(ag.cost)) continue;
    if (ag.cost < T.minSpendForWaste * 2) continue; // need meaningful spend (2x threshold)
    if (ag.conversions !== 0 && ag.conversions !== null) continue;

    findings.push({
      category: 'waste',
      severity: 'medium',
      what: `קבוצת מודעות "${ag.adGroup ?? 'לא ידוע'}" (קמפיין: ${ag.campaign ?? '?'}) — CA$${fmt(ag.cost)} ללא לידים.`,
      why: `כל הקבוצה הזו לא מביאה לידים. הבעיה עשויה להיות במילות המפתח, בתוכן המודעה או בעמוד הנחיתה.`,
      action: `בדוק את המילות המפתח בקבוצה. בדוק את הניסוח והעמוד. אם זה לא משתפר בתוך שבועיים — שקול לעצור את הקבוצה.`,
      data: ag,
    });
  }
  return findings;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasValue(v) { return v !== null && v !== undefined; }
function fmt(n) { return n != null ? n.toFixed(2) : '—'; }
function pct100(n) { return (n * 100).toFixed(0); }
function sumNN(rows, k) { return rows.reduce((a, r) => a + (r[k] ?? 0), 0); }
