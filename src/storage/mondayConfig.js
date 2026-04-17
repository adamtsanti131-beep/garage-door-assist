/**
 * mondayConfig.js
 * localStorage wrapper for Monday.com connection config and fetched context.
 * API token stored client-side — acceptable for a single-user personal tool.
 */

const KEY = 'ppc_monday_config_v1';

const DEFAULTS = {
  apiToken:     '',
  boardId:      '',
  dateFrom:     '',
  dateTo:       '',
  lastFetched:  null,
  mondayContext: null,
};

export function loadMondayConfig() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveMondayConfig(patch) {
  try {
    const current = loadMondayConfig();
    localStorage.setItem(KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    // localStorage unavailable — silent fail
  }
}

export function clearMondayConfig() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // silent
  }
}
