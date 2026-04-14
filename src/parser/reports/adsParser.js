import { REPORT_TYPES }  from '../schemas.js';
import { parseCSV }      from '../csvParser.js';
import { normalizeRows } from '../normalizer.js';
import { validate }      from '../validator.js';

export function parseAdsReport(csvText) {
  const { rows: rawRows, meta: parseMeta } = parseCSV(csvText);
  const { rows, foundFields, droppedAggregateRows } = normalizeRows(rawRows, REPORT_TYPES.ADS);
  const validation = validate(rows, REPORT_TYPES.ADS, foundFields, {
    rawDataRowCount: parseMeta?.rawDataRowCount ?? null,
    droppedAggregateRows: parseMeta?.droppedAggregateRows ?? 0,
    droppedAggregateRowsInNormalizer: droppedAggregateRows,
  });
  return {
    rows,
    foundFields,
    validation,
    reportType: REPORT_TYPES.ADS,
    parseMeta: {
      ...(parseMeta ?? {}),
      droppedAggregateRowsInNormalizer: droppedAggregateRows,
    },
  };
}
