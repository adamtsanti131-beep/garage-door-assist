/**
 * validator.js
 * Validates a set of normalized rows against a report schema.
 *
 * Returns a ValidationResult:
 * {
 *   ok:              boolean   — false if required columns are missing (blocks analysis)
 *   errors:          string[]  — fatal issues (required columns missing)
 *   warnings:        string[]  — non-fatal issues (preferred columns missing, suspicious values)
 *   missingRequired: string[]  — internal field names that were required but absent
 *   missingPreferred:string[]  — internal field names that were preferred but absent
 *   rowCount:        number
 * }
 */

import { SCHEMAS } from './schemas.js';

/**
 * Validate normalized rows for a given report type.
 * @param {Object[]} rows        — already-normalized rows from the parser
 * @param {string}   reportType  — one of REPORT_TYPES values
 * @param {string[]} foundFields — list of internal field keys actually found in the file
 * @returns {ValidationResult}
 */
export function validate(rows, reportType, foundFields, options = {}) {
  const {
    rawDataRowCount = null,
    droppedAggregateRows = 0,
    droppedAggregateRowsInNormalizer = 0,
  } = options;

  const schema = SCHEMAS[reportType];
  if (!schema) {
    return fatal(`סוג דוח לא מוכר: "${reportType}"`);
  }

  const errors   = [];
  const warnings = [];

  // ── Required column check ─────────────────────────────────────────────────
  const missingRequired = schema.required.filter(f => !foundFields.includes(f));
  if (missingRequired.length > 0) {
    const labels = missingRequired.map(toLabel).join(', ');
    errors.push(`חסרות עמודות חובה: ${labels}. לא ניתן לנתח את הדוח הזה.`);
  }

  // ── Preferred column check ────────────────────────────────────────────────
  const missingPreferred = schema.preferred.filter(f => !foundFields.includes(f));
  if (missingPreferred.length > 0) {
    const labels = missingPreferred.map(toLabel).join(', ');
    warnings.push(`חסרות עמודות מומלצות: ${labels}. חלק מהתובנות עשויות להיות מוגבלות.`);
  }

  // ── Empty file check ──────────────────────────────────────────────────────
  if (rows.length === 0) {
    const totalDropped = droppedAggregateRows + droppedAggregateRowsInNormalizer;
    if ((rawDataRowCount ?? 0) > 0 && totalDropped > 0) {
      errors.push('הקובץ הועלה, אך כל השורות סווגו כשורות סיכום/Total ולכן לא נשארו שורות נתונים לניתוח.');
    } else {
      errors.push('הקובץ הועלה, אך לא נמצאו שורות נתונים תקינות אחרי שורת הכותרת.');
    }
  }

  if (droppedAggregateRows > 0 || droppedAggregateRowsInNormalizer > 0) {
    const totalDropped = droppedAggregateRows + droppedAggregateRowsInNormalizer;
    warnings.push(`הוסרו ${totalDropped} שורות Total/Subtotal באופן אוטומטי לפני הניתוח.`);
  }

  // ── Suspicious data checks (only if file is otherwise valid) ─────────────
  if (errors.length === 0 && rows.length > 0) {
    checkForSuspiciousData(rows, warnings);
  }

  return {
    ok:               errors.length === 0,
    errors,
    warnings,
    missingRequired,
    missingPreferred,
    rowCount:         rows.length,
    droppedAggregateRows: droppedAggregateRows + droppedAggregateRowsInNormalizer,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fatal(message) {
  return { ok: false, errors: [message], warnings: [], missingRequired: [], missingPreferred: [], rowCount: 0 };
}

/**
 * Lightweight sanity checks that add warnings but never block analysis.
 */
function checkForSuspiciousData(rows, warnings) {
  const totalCost = sumNullable(rows, 'cost');
  const totalConv = sumNullable(rows, 'conversions');
  const totalClicks = sumNullable(rows, 'clicks');

  // All rows have 0 conversions recorded — could be tracking issue
  if (totalConv === 0 && totalCost !== null && totalCost > 0) {
    warnings.push('אפס המרות בכל השורות. יש לוודא שמעקב ההמרות מוגדר נכון.');
  }

  // More conversions than clicks is almost always a tracking problem
  if (totalConv !== null && totalClicks !== null && totalConv > totalClicks && totalClicks > 0) {
    warnings.push(`ההמרות (${totalConv}) גבוהות מהקליקים (${totalClicks}). בדרך כלל זו בעיית הגדרת מעקב המרות.`);
  }

  // Very high CTR on any row (>50% is almost always a data error or brand keyword issue)
  const highCtrRow = rows.find(r => r.ctr !== null && r.ctr > 50);
  if (highCtrRow) {
    warnings.push(`זוהה CTR חריג (${highCtrRow.ctr?.toFixed(1)}%). יש לבדוק שגיאות נתונים או מילות מותג צרות מאוד.`);
  }
}

/** Convert an internal field name back to a readable label. */
function toLabel(field) {
  const labels = {
    campaign:            'קמפיין',
    adGroup:             'קבוצת מודעות',
    searchTerm:          'מונח חיפוש',
    keyword:             'מילת מפתח',
    matchType:           'סוג התאמה',
    device:              'מכשיר',
    location:            'מיקום משתמש',
    clicks:              'קליקים',
    impressions:         'חשיפות',
    cost:                'עלות',
    conversions:         'המרות',
    ctr:                 'CTR',
    avgCpc:              'CPC ממוצע',
    conversionRate:      'שיעור המרה',
    costPerConversion:   'עלות להמרה',
    searchImprShare:     'נתח חשיפות חיפוש',
    searchLostIsRank:    'איבוד נתח חשיפות (דירוג)',
    searchLostIsBudget:  'איבוד נתח חשיפות (תקציב)',
    qualityScore:        'ציון איכות',
    finalUrl:            'כתובת יעד',
    adDescription:       'תיאור מודעה',
  };
  return labels[field] || field;
}

/** Sum a nullable field across rows. Returns null if no row has a value. */
function sumNullable(rows, field) {
  let total = null;
  for (const row of rows) {
    if (row[field] !== null && row[field] !== undefined) {
      total = (total ?? 0) + row[field];
    }
  }
  return total;
}
