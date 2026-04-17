/**
 * reportRouter.js
 * Routes a CSV file to the correct parser based on the explicitly assigned slot type.
 * Auto-detection is used only as a fallback warning — not as primary routing.
 */

import { REPORT_TYPES, SCHEMAS }          from './schemas.js';
import { detectReportType }               from './normalizer.js';
import { parseCampaignReport }            from './reports/campaignParser.js';
import { parseAdGroupReport }             from './reports/adGroupParser.js';
import { parseSearchTermsReport }         from './reports/searchTermsParser.js';
import { parseKeywordsReport }            from './reports/keywordsParser.js';
import { parseAdsReport }                 from './reports/adsParser.js';
import { parseDevicesReport }             from './reports/devicesParser.js';
import { parseLocationReport }            from './reports/locationParser.js';
import { parseCSV }                       from './csvParser.js';

const PARSERS = {
  [REPORT_TYPES.CAMPAIGN]:     parseCampaignReport,
  [REPORT_TYPES.AD_GROUP]:     parseAdGroupReport,
  [REPORT_TYPES.SEARCH_TERMS]: parseSearchTermsReport,
  [REPORT_TYPES.KEYWORDS]:     parseKeywordsReport,
  [REPORT_TYPES.ADS]:          parseAdsReport,
  [REPORT_TYPES.DEVICES]:      parseDevicesReport,
  [REPORT_TYPES.LOCATION]:     parseLocationReport,
};

/**
 * Parse and validate a CSV text for a known report type.
 * Adds a warning if the file looks like a different report type.
 *
 * @param {string} csvText    — raw CSV content
 * @param {string} reportType — explicit slot type (one of REPORT_TYPES)
 * @returns {ParsedReport}
 */
export function routeReport(csvText, reportType) {
  const parser = PARSERS[reportType];
  if (!parser) {
    return errorResult(`סוג דוח לא מוכר: "${reportType}"`);
  }

  let result;
  try {
    result = parser(csvText);
  } catch (err) {
    return errorResult(
      `לא ניתן היה לפענח את הקובץ. הסיבה: ${err?.message ?? 'מבנה CSV לא נתמך או קובץ פגום.'}`
    );
  }

  // Auto-detect the likely type and warn only when strongly confident it differs.
  // We only show user-facing mismatch warnings for strength >= 3 (very strong signals).
  // Weak signals (strength 1-2) are logged internally but never surfaced to the UI.
  try {
    const { headers } = parseCSV(csvText);
    if (headers.length > 0) {
      const detected = detectReportType(headers);
      if (detected) {
        const detectedLabel = SCHEMAS[detected.type]?.label ?? detected.type;
        const expectedLabel = SCHEMAS[reportType]?.label ?? reportType;
        if (detected.type === reportType) {
          // Perfect match: file is what was expected
          result.validation.slotMatch = {
            state: 'match_confirmed',
            reason: `נמצאו שדות שמאשרים את סוג הדוח "${expectedLabel}".`,
          };
        } else if (detected.strength >= 3) {
          // Very strong mismatch signal: show warning to user
          result.validation.slotMatch = {
            state: 'strong_mismatch',
            reason: `השדות דומים יותר לדוח "${detectedLabel}" מאשר ל"${expectedLabel}".`,
          };
          result.validation.warnings.unshift(
            `יתכן שקובץ זה מתאים יותר ל"${detectedLabel}" מאשר ל"${expectedLabel}". יש לוודא שהקובץ הועלה לסלוט הנכון.`
          );
          result.detectedType = detected.type;
        } else {
          // Weak signal (strength 1-2): don't show mismatch to user, stay neutral
          // (could be a generic column like "Locations of interest" in an Ad Group file)
          result.validation.slotMatch = {
            state: 'likely_match',
            reason: `לא נמצאו שדות חזקים שמצביעים על סוג דוח אחר.`,
          };
        }
      } else {
        result.validation.slotMatch = {
          state: 'likely_match',
          reason: `לא ניתן לזהות את סוג הקובץ על סמך כותרות העמודות.`,
        };
      }
    }
  } catch {
    // auto-detection is best-effort — never block on failure
  }


  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function errorResult(message) {
  return {
    rows: [],
    foundFields: [],
    reportType: null,
    validation: {
      ok: false,
      errors: [message],
      warnings: [],
      missingRequired: [],
      missingPreferred: [],
      rowCount: 0,
      droppedAggregateRows: 0,
    },
    parseMeta: { rawDataRowCount: 0, droppedAggregateRows: 0, droppedAggregateRowsInNormalizer: 0 },
  };
}
