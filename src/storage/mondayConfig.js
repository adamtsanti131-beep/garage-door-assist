/**
 * mondayConfig.js
 * localStorage wrapper for Monday.com date range and fetched KPI context.
 * API token and board ID are server-side only (MONDAY_API_TOKEN / MONDAY_BOARD_ID in .env).
 */

const KEY = 'ppc_monday_config_v1';

const DEFAULTS = {
  dateFrom:     '',
  dateTo:       '',
  lastFetched:  null,
  mondayContext: null,
};

export function loadMondayConfig() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    // Strip any legacy apiToken / boardId that may have been saved previously
    const { apiToken: _a, boardId: _b, ...rest } = parsed;
    return { ...DEFAULTS, ...rest };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveMondayConfig(patch) {
  try {
    const current = loadMondayConfig();
    // Never persist credentials to localStorage
    const { apiToken: _a, boardId: _b, ...safePatch } = patch;
    localStorage.setItem(KEY, JSON.stringify({ ...current, ...safePatch }));
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
