/**
 * businessInterpreter.js
 * Reads Monday CRM context + Google Ads summary and produces:
 *  - funnelSignals  : structured pattern flags used by decisionEngine
 *  - narrative      : Hebrew plain-language bullets explaining business outcomes
 *
 * Pure functions only — no DOM, no side effects.
 */

// ── Thresholds ────────────────────────────────────────────────────────────────

const MIN_LEADS_FOR_ANALYSIS  = 10;   // below this: data too thin for rate signals
const HIGH_CANCELLATION_RATE  = 0.30; // lost / paidLeadCount
const WEAK_BOOKING_RATE       = 0.25; // bookRate below this
const STRONG_BOOKING_RATE     = 0.40; // bookRate above this
const WEAK_CLOSE_RATE         = 0.20; // closeRate below this (need bookedCount ≥ 5)
const HEALTHY_CLOSE_RATE      = 0.25; // closeRate above this
const HIGH_AVG_NET            = 600;  // avgNetRevenue above this (CAD)
const SCALE_CANDIDATE_MAX_LEADS = 30; // healthy close + low volume → scale candidate

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * @param {Object|null} mondayContext  — from reportBuilder.businessContextUsed.mondayContext
 * @param {Object}      summary        — from reportBuilder summary section
 * @param {Object}      businessContext
 * @returns {Object}
 */
export function buildBusinessInterpretation(mondayContext, summary, businessContext) {
  if (!mondayContext || mondayContext.paidLeadCount == null) {
    return {
      hasMondayData: false,
      funnelSignals: [],
      narrative: [],
      contextNote: 'הניתוח מבוסס על נתוני Google Ads בלבד — לא חוברו נתוני CRM לניתוח זה.',
    };
  }

  const funnelSignals = detectFunnelSignals(mondayContext);
  const narrative     = buildNarrative(mondayContext, funnelSignals, summary, businessContext);

  return {
    hasMondayData:   true,
    funnelSignals,
    narrative,
    paidLeadCount:   mondayContext.paidLeadCount,
    bookedCount:     mondayContext.bookedCount,
    closedCount:     mondayContext.closedCount,
    lostCount:       mondayContext.lostCount,
    bookRate:        mondayContext.bookRate,
    closeRate:       mondayContext.closeRate,
    avgNetRevenue:   mondayContext.avgNetRevenue,
    avgNetLessParts: mondayContext.avgNetLessParts,
    dataWarnings:    mondayContext.warnings ?? [],
    contextNote:     'ניתוח זה כולל נתוני תוצאות עסקיות ממנגנון CRM (Monday.com).',
  };
}

// ── Signal detection ──────────────────────────────────────────────────────────

export function detectFunnelSignals(ctx) {
  const { paidLeadCount, bookedCount, closedCount, lostCount,
          bookRate, closeRate, avgNetRevenue } = ctx;

  const signals = [];

  if (paidLeadCount < MIN_LEADS_FOR_ANALYSIS) {
    signals.push({ key: 'low_volume', severity: 'note' });
    // With very few leads, rates are unreliable — stop here
    return signals;
  }

  // Historical-mode detection: board tracks current status only.
  // If bookedCount=0 but closedCount>0, all leads resolved past the booked stage —
  // bookRate=0 is a data artifact, not a real conversion problem.
  const isHistoricalMode = bookedCount === 0 && closedCount > 0;
  if (isHistoricalMode) {
    signals.push({ key: 'historical_mode', severity: 'note' });
  }

  // Cancellation
  const cancellationRate = paidLeadCount > 0 ? lostCount / paidLeadCount : 0;
  if (cancellationRate > HIGH_CANCELLATION_RATE) {
    signals.push({ key: 'high_cancellation', severity: 'warning', rate: cancellationRate });
  }

  // Booking rate — skip in historical mode (bookRate=0 is an artifact, not poor conversion)
  if (!isHistoricalMode && bookRate != null) {
    if (bookRate < WEAK_BOOKING_RATE) {
      signals.push({ key: 'weak_booking', severity: 'warning', rate: bookRate });
    } else if (bookRate >= STRONG_BOOKING_RATE) {
      signals.push({ key: 'strong_booking', severity: 'positive', rate: bookRate });
    }
  }

  // Close rate — use closedCount guard in historical mode (bookedCount stays 0)
  const closeRateGuard = isHistoricalMode ? closedCount >= 5 : bookedCount >= 5;
  if (closeRate != null && closeRateGuard) {
    if (closeRate < WEAK_CLOSE_RATE) {
      signals.push({ key: 'weak_close', severity: 'warning', rate: closeRate });
    } else if (closeRate >= HEALTHY_CLOSE_RATE) {
      signals.push({ key: 'healthy_close', severity: 'positive', rate: closeRate });
    }
  }

  // High average job value
  if (avgNetRevenue != null && avgNetRevenue > HIGH_AVG_NET) {
    signals.push({ key: 'high_value_jobs', severity: 'positive', value: avgNetRevenue });
  }

  // Scale candidate: healthy close rate but low-ish volume
  const hasHealthyClose = signals.some(s => s.key === 'healthy_close');
  if (hasHealthyClose && paidLeadCount < SCALE_CANDIDATE_MAX_LEADS) {
    signals.push({ key: 'scale_candidate', severity: 'positive' });
  }

  // Good booking + weak close = operational signal (not an Ads problem)
  const hasStrongBooking   = signals.some(s => s.key === 'strong_booking');
  const hasWeakClose       = signals.some(s => s.key === 'weak_close');
  if (hasStrongBooking && hasWeakClose) {
    signals.push({ key: 'operational_gap', severity: 'note' });
  }

  return signals;
}

// ── Narrative builder ─────────────────────────────────────────────────────────

function buildNarrative(ctx, signals, summary, businessContext) {
  const { paidLeadCount, bookedCount, closedCount, lostCount,
          bookRate, closeRate, avgNetRevenue } = ctx;
  const bullets = [];

  const pct   = v => v != null ? `${(v * 100).toFixed(0)}%` : '—';
  const money = v => v != null ? `CA$${Math.round(v).toLocaleString('en-CA')}` : '—';
  const hasSignal = key => signals.some(s => s.key === key);

  // ── Volume opener ─────────────────────────────────────────────────────────

  if (hasSignal('low_volume')) {
    bullets.push(`בתקופה הנבחרת הגיעו ${paidLeadCount} לידים ממקורות Google Ads בלבד — נפח נמוך מדי להסקת מסקנות סטטיסטיות אמינות על שיעורי הזמנה וסגירה.`);
    return bullets;
  }

  if (hasSignal('historical_mode')) {
    bullets.push(`הערה: הלוח שומר סטטוס נוכחי בלבד — לידים שהגיעו להזמנה ונסגרו מופיעים כ"סגורים", לא כ"הוזמנו". שיעור ההזמנה (0%) הוא ארטיפקט טכני, לא מדד אמיתי. ניתוח שיעור הסגירה (${pct(closeRate)}) תקף.`);
  }

  if (hasSignal('historical_mode')) {
    bullets.push(
      `${paidLeadCount} לידים ממומנים הגיעו מ-Google Ads בתקופה הנבחרת: ${closedCount} נסגרו (${pct(closeRate)}), ${lostCount} בוטלו.`
    );
  } else {
    bullets.push(
      `${paidLeadCount} לידים ממומנים הגיעו מ-Google Ads בתקופה הנבחרת: ${bookedCount} הוזמנו (${pct(bookRate)}), ${closedCount} נסגרו (${pct(closeRate)}), ${lostCount} בוטלו.`
    );
  }

  // ── Booking rate ──────────────────────────────────────────────────────────

  if (hasSignal('weak_booking')) {
    bullets.push(
      `שיעור ההזמנה (${pct(bookRate)}) נמוך — רק אחד מכל ארבעה לידים מגיע לתיאום. זה מצביע על בעיית כוונת חיפוש או חוסר התאמה בין המודעה לציפיית הלקוח.`
    );
  } else if (hasSignal('strong_booking')) {
    bullets.push(
      `שיעור הזמנה חזק (${pct(bookRate)}) — Google Ads מביא לידים שאכן פותחים הליך הזמנה, זה אות שהכוונה מתאימה לשירות.`
    );
  }

  // ── Close rate + Cancellation (synthesized when both present) ─────────────

  if (hasSignal('high_cancellation') && hasSignal('healthy_close')) {
    // Both signals together: good sales process but bad intent matching — explain the interaction
    const cancelPct = paidLeadCount > 0 ? pct(lostCount / paidLeadCount) : '—';
    bullets.push(
      `שיעור ביטול גבוה (${cancelPct}) אך שיעור סגירה תקין (${pct(closeRate)}) — תהליך המכירה עובד טוב, אבל חלק מהלידים מגיעים עם כוונה לא מספיק רלוונטית. פעולה נכונה: לצמצם ביטולים על ידי הידוק מונחי חיפוש לפני הגדלת נפח.`
    );
  } else {
    // Handle close rate independently
    if (hasSignal('operational_gap')) {
      bullets.push(
        `שיעור סגירה נמוך (${pct(closeRate)}) למרות הזמנות טובות — הבעיה כנראה תפעולית (מחיר, מהירות מענה, מעקב), לא ב-Google Ads עצמו.`
      );
    } else if (hasSignal('weak_close')) {
      bullets.push(
        `שיעור סגירה של ${pct(closeRate)} נמוך — כדאי לבחון כמה הצעות נשלחו ולא נסגרו ולמה.`
      );
    } else if (hasSignal('healthy_close')) {
      bullets.push(
        `שיעור סגירה של ${pct(closeRate)} תקין — מה-Ads שמגיע, חלק נכבד הופך לעסקה.`
      );
    }

    // Handle cancellation independently only when not combined above
    if (hasSignal('high_cancellation')) {
      const cancelPct = paidLeadCount > 0 ? pct(lostCount / paidLeadCount) : '—';
      bullets.push(
        `שיעור ביטול גבוה (${cancelPct} מהלידים בוטלו) — סימן שחלק מהתנועה אינה רלוונטית. כדאי לבחון מונחי חיפוש ונוסח מודעות.`
      );
    }
  }

  // ── Job value ─────────────────────────────────────────────────────────────

  if (hasSignal('high_value_jobs') && avgNetRevenue != null) {
    const maxCpl = businessContext?.targetCpl ?? Math.round(avgNetRevenue * 0.25);
    bullets.push(
      `ממוצע הכנסה (Net) לעסקה סגורה עומד על ${money(avgNetRevenue)} — עסקה ממוצעת מצדיקה CPL גבוה מהנראה. אין צורך לאופטימיזציה אגרסיבית להורדת מחיר הליד אם העסקאות איכותיות.`
    );
  }

  // ── Scale candidate ───────────────────────────────────────────────────────

  if (hasSignal('scale_candidate') && !hasSignal('weak_booking') && !hasSignal('high_cancellation')) {
    bullets.push(
      `שיעור הסגירה בריא ונפח הלידים עדיין נמוך — יש מקום להגדלה זהירה מהאזורים החזקים אחרי תיקוני בסיס.`
    );
  }

  // ── Google Ads CPL vs close rate sanity check ─────────────────────────────

  if (summary?.avgCpl != null && closeRate != null && closeRate > 0) {
    const effectiveCpa = summary.avgCpl / closeRate;
    if (effectiveCpa > 300) {
      bullets.push(
        `עלות אמיתית לעסקה סגורה (CPL ÷ שיעור סגירה) מוערכת בכ-${money(effectiveCpa)} — שווה לבחון האם הלידים מביאים תשואה מול ה-Net הממוצע.`
      );
    }
  }

  return bullets;
}
