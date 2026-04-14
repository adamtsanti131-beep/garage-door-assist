import { REPORT_TYPES } from '../schemas.js';
import { parseCSV }     from '../csvParser.js';
import { normalizeRows } from '../normalizer.js';
import { validate }     from '../validator.js';

export function parseCampaignReport(csvText) {
  return parseReport(csvText, REPORT_TYPES.CAMPAIGN);
}

function parseReport(csvText, type) {
  const { rows: rawRows } = parseCSV(csvText);
  const { rows, foundFields } = normalizeRows(rawRows, type);
  const validation = validate(rows, type, foundFields);
  return { rows, foundFields, validation, reportType: type };
}
