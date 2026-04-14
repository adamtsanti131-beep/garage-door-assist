import { REPORT_TYPES }  from '../schemas.js';
import { parseCSV }      from '../csvParser.js';
import { normalizeRows } from '../normalizer.js';
import { validate }      from '../validator.js';

export function parseSearchTermsReport(csvText) {
  const { rows: rawRows } = parseCSV(csvText);
  const { rows, foundFields } = normalizeRows(rawRows, REPORT_TYPES.SEARCH_TERMS);
  const validation = validate(rows, REPORT_TYPES.SEARCH_TERMS, foundFields);
  return { rows, foundFields, validation, reportType: REPORT_TYPES.SEARCH_TERMS };
}
