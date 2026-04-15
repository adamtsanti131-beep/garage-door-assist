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
  // We require strength >= 2 (a uniquely identifying field set) to avoid false
  // positives — e.g. Device reports contain adGroup + campaign columns and would
  // otherwise trigger a spurious "looks like Ad Group" warning.
  try {
    const { headers } = parseCSV(csvText);
    if (headers.length > 0) {
      const detected = detectReportType(headers);
      if (detected && detected.type !== reportType && detected.strength >= 2) {
        const detectedLabel = SCHEMAS[detected.type]?.label ?? detected.type;
        const expectedLabel = SCHEMAS[reportType]?.label ?? reportType;
        result.validation.warnings.unshift(
          `נראה שזה קובץ מסוג "${detectedLabel}", אבל הוא הועלה לשדה "${expectedLabel}". יש לבדוק שהקובץ הועלה למקום הנכון.`
        );
        result.detectedType = detected.type;
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
