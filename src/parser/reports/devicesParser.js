import { REPORT_TYPES }  from '../schemas.js';
import { parseCSV }      from '../csvParser.js';
import { normalizeRows } from '../normalizer.js';
import { validate }      from '../validator.js';

export function parseDevicesReport(csvText) {
  const { rows: rawRows, meta: parseMeta } = parseCSV(csvText);
  const { rows, foundFields, droppedAggregateRows } = normalizeRows(rawRows, REPORT_TYPES.DEVICES);
  const validation = validate(rows, REPORT_TYPES.DEVICES, foundFields, {
    rawDataRowCount: parseMeta?.rawDataRowCount ?? null,
    droppedAggregateRows: parseMeta?.droppedAggregateRows ?? 0,
    droppedAggregateRowsInNormalizer: droppedAggregateRows,
  });
  return {
    rows,
    foundFields,
    validation,
    reportType: REPORT_TYPES.DEVICES,
    parseMeta: {
      ...(parseMeta ?? {}),
      droppedAggregateRowsInNormalizer: droppedAggregateRows,
    },
  };
}
