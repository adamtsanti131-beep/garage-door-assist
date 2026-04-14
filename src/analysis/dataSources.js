/**
 * dataSources.js
 * Centralizes dataset selection rules so totals and findings never double count
 * overlapping report levels.
 */

const ACCOUNT_TOTALS_PRIORITY = [
  'campaigns',
  'adGroups',
  'keywords',
  'searchTerms',
  'ads',
  'devices',
  'locations',
];

const WASTE_PRIORITY = [
  'searchTerms',
  'keywords',
  'adGroups',
  'campaigns',
  'ads',
  'devices',
  'locations',
];

const BEST_PERFORMER_PRIORITY = [
  'searchTerms',
  'keywords',
  'adGroups',
  'campaigns',
  'ads',
  'devices',
  'locations',
];

export function pickAccountTotalsSource(data) {
  return pickFirstNonEmpty(data, ACCOUNT_TOTALS_PRIORITY);
}

export function pickWasteSource(data) {
  return pickFirstNonEmpty(data, WASTE_PRIORITY);
}

export function pickBestPerformerSource(data) {
  return pickFirstNonEmpty(data, BEST_PERFORMER_PRIORITY);
}

export function sumMetric(rows, key) {
  return rows.reduce((acc, row) => acc + num(row[key]), 0);
}

export function num(value) {
  return typeof value === 'number' && !Number.isNaN(value) ? value : 0;
}

function pickFirstNonEmpty(data, priority) {
  for (const key of priority) {
    const rows = data[key] ?? [];
    if (rows.length > 0) {
      return { key, rows };
    }
  }

  return { key: null, rows: [] };
}