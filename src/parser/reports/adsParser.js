import { REPORT_TYPES }  from '../schemas.js';
import { parseCSV }      from '../csvParser.js';
import { normalizeRows } from '../normalizer.js';
import { validate }      from '../validator.js';

export function parseAdsReport(csvText) {
  const { rows: rawRows } = parseCSV(csvText);
  const { rows, foundFields } = normalizeRows(rawRows, REPORT_TYPES.ADS);
  const validation = validate(rows, REPORT_TYPES.ADS, foundFields);
  return { rows, foundFields, validation, reportType: REPORT_TYPES.ADS };
}
