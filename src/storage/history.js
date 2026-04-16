/**
 * history.js
 * Reads and writes analysis history to localStorage.
 * Keeps the 10 most recent analyses to avoid unbounded storage growth.
 */

const STORAGE_KEY = 'ppc_analysis_history';
const MAX_ENTRIES = 10;

/**
 * Save a report to the history list.
 * Prepends the new entry (newest first) and trims to MAX_ENTRIES.
 * @param {Object} report - Full report object from reportBuilder.buildReport()
 */
export function saveToHistory(report) {
  const history = getHistory();

  const entry = {
    id: Date.now(),
    timestamp: report.timestamp,
    summary: buildSummary(report),
    report,
  };

  history.unshift(entry);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, MAX_ENTRIES)));
  } catch (e) {
    // localStorage can fail if quota is exceeded (rare, but handle gracefully)
    console.warn('לא ניתן לשמור את הניתוח בהיסטוריה:', e);
  }
}

/**
 * Return all history entries, newest first.
 * @returns {Object[]}
 */
export function getHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Delete all history entries.
 */
export function clearHistory() {
  localStorage.removeItem(STORAGE_KEY);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a one-line text summary for the history list. */
function buildSummary(report) {
  const immediate = report.decisionFlow?.decisionBuckets?.immediateActions?.length || 0;
  const review    = report.decisionFlow?.decisionBuckets?.reviewBeforeAction?.length || 0;
  const hold      = report.decisionFlow?.decisionBuckets?.doNotTouchYet?.length || 0;
  const spend    = typeof report.summary?.totalSpend === 'number'
    ? ` · הוצאה CA$${report.summary.totalSpend.toFixed(0)}`
    : '';
  return `${immediate} עכשיו · ${review} לבדיקה · ${hold} בהמתנה${spend}`;
}
