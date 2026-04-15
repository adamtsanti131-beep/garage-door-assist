/**
 * csvParser.js
 * Parses a raw CSV string into an array of row objects.
 * Handles quoted fields and common Google Ads export quirks.
 */

/**
 * Parse a CSV string into an array of objects.
 * Keys come from the header row.
 * @param {string} csvText - Raw CSV string
 * @returns {{ headers: string[], rows: Object[] }}
 */
export function parseCSV(csvText) {
  // Normalize line endings
  const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  // Remove blank lines
  const dataLines = lines.filter(line => line.trim() !== '');

  if (dataLines.length === 0) {
    throw new Error('נראה שקובץ ה-CSV ריק.');
  }

  // Find the header row — Google Ads may prepend metadata blocks before the table header.
  const headerIndex = findHeaderRow(dataLines);
  if (headerIndex === -1) {
    throw new Error('לא נמצאה שורת כותרת תקינה בקובץ ה-CSV.');
  }

  const headers = parseCSVLine(dataLines[headerIndex]).map(h => h.trim());

  const rows = [];
  let droppedAggregateRows = 0;
  for (let i = headerIndex + 1; i < dataLines.length; i++) {
    const line = dataLines[i];
    if (!line) continue;

    const values = parseCSVLine(line, i + 1);
    if (isAggregateValuesRow(values)) {
      droppedAggregateRows += 1;
      continue;
    }

    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] !== undefined ? values[idx].trim() : '';
    });
    rows.push(row);
  }

  if (rows.length === 0) {
    throw new Error('לא נמצאו שורות נתונים אחרי הכותרת. האם זה הקובץ הנכון?');
  }

  return {
    headers,
    rows,
    meta: {
      headerIndex,
      rawDataRowCount: Math.max(0, dataLines.length - (headerIndex + 1)),
      droppedAggregateRows,
    },
  };
}

/**
 * Find the index of the header row.
 * Google Ads exports can have 1-2 metadata lines before the actual headers.
 * We return the FIRST line that scores >= 2 known column signals.
 * We intentionally take the first qualifying line (not the max-score one)
 * because real Google Ads headers always appear before data rows, and data
 * rows in wide exports (e.g. 60-column Ads reports) can accidentally score high
 * by containing status/keyword text fields.
 */
function findHeaderRow(lines) {
  const scanLimit = Math.min(lines.length, 30);

  for (let i = 0; i < scanLimit; i++) {
    const columns = parseCSVLine(lines[i], i + 1).map(c => c.trim().toLowerCase()).filter(Boolean);
    if (columns.length < 2) continue;

    const score = scoreHeaderCandidate(columns);
    if (score >= 2) return i;
  }

  return -1;
}

/**
 * Parse a single CSV line into an array of field strings.
 * Correctly handles fields wrapped in double quotes, including escaped quotes ("").
 * @param {string} line
 * @returns {string[]}
 */
function parseCSVLine(line, lineNumber = null) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped double quote inside a quoted field
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  if (inQuotes) {
    const where = lineNumber != null ? ` בשורה ${lineNumber}` : '';
    throw new Error(`CSV פגום${where}: נמצאו מרכאות לא סגורות.`);
  }
  return result;
}

function scoreHeaderCandidate(columns) {
  const normalized = columns.map(normalizeToken);
  const headerSignals = [
    'campaign', 'ad group', 'search term', 'keyword', 'match type', 'device', 'location',
    'clicks', 'impressions', 'ctr', 'cost', 'conversions', 'conv. rate', 'avg. cpc',
    'cost / conv.', 'quality score', 'search impr. share',
  ];

  let score = 0;
  for (const col of normalized) {
    if (headerSignals.some(signal => col.includes(signal))) score += 1;
  }
  return score;
}

function isAggregateValuesRow(values) {
  const trimmed = values.map(v => String(v ?? '').trim()).filter(Boolean);
  if (trimmed.length === 0) return true;

  const first = normalizeToken(trimmed[0]);
  if (first === '--') return true;

  return isAggregateLabel(first);
}

function isAggregateLabel(value) {
  if (!value) return false;
  return /^(total|subtotal|grand total|total:|total\s*-|sum\s+of)/i.test(value);
}

function normalizeToken(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/["']/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}
