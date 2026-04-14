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

  // Find the header row — Google Ads sometimes prepends 1-2 metadata lines
  const headerIndex = findHeaderRow(dataLines);
  if (headerIndex === -1) {
    throw new Error('לא נמצאה שורת כותרת תקינה בקובץ ה-CSV.');
  }

  const headers = parseCSVLine(dataLines[headerIndex]).map(h => h.trim());

  const rows = [];
  for (let i = headerIndex + 1; i < dataLines.length; i++) {
    const line = dataLines[i].trim();
    if (!line) continue;

    // Skip Google Ads totals rows (they start with "Total" or "--")
    if (/^["']?Total/i.test(line) || line.startsWith('--')) continue;

    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] !== undefined ? values[idx].trim() : '';
    });
    rows.push(row);
  }

  if (rows.length === 0) {
    throw new Error('לא נמצאו שורות נתונים אחרי הכותרת. האם זה הקובץ הנכון?');
  }

  return { headers, rows };
}

/**
 * Find the index of the header row.
 * Google Ads exports can have 1-2 metadata lines before the actual headers.
 * We detect the header as the first line containing at least 2 known column signals.
 */
function findHeaderRow(lines) {
  const headerSignals = [
    'clicks', 'impressions', 'campaign', 'keyword', 'search term', 'cost', 'ctr', 'conversions',
  ];

  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const lower = lines[i].toLowerCase();
    const matches = headerSignals.filter(signal => lower.includes(signal));
    if (matches.length >= 2) return i;
  }

  // Fallback: treat the first line as the header
  return 0;
}

/**
 * Parse a single CSV line into an array of field strings.
 * Correctly handles fields wrapped in double quotes, including escaped quotes ("").
 * @param {string} line
 * @returns {string[]}
 */
function parseCSVLine(line) {
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
  return result;
}
