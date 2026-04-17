/**
 * mondayAggregator.js
 * Server-side module: fetches and aggregates CRM data from Monday.com.
 *
 * Paid Google Ads sources: 'Ad Extension', 'Website- Ad', 'Main Number'
 * Status buckets:
 *   Booked  = Appointment / Ongoing / Follow up
 *   Closed  = Done
 *   Lost    = Cancel
 *
 * Revenue fields aggregated on Closed items only.
 * Date filtering uses an explicitly mapped column (COLUMN_TITLES.date),
 * falling back to type-based detection only if the mapped column is absent.
 */

const MONDAY_API = 'https://api.monday.com/v2';

// Explicit column title mapping — edit titles here to match your board exactly.
const COLUMN_TITLES = {
  source:       'Source',
  jobStatus:    'Job Status',
  date:         'Date',         // Primary date column for filtering
  total:        'total',
  net:          'Net',
  netLessParts: 'Net Less Parts',
  parts:        'parts',
  gclid:        'gclid',
  campaignId:   'Campaign id',
  adGroupId:    'Adgroupid',
  keyword:      'Keyword',
  matchType:    'Matchtype',
  device:       'Device',
};

const PAID_SOURCES = new Set(['Ad Extension', 'Website- Ad', 'Main Number']);

const BOOKED_LABELS = new Set(['appointment', 'ongoing', 'follow up']);
const CLOSED_LABELS = new Set(['done']);
const LOST_LABELS   = new Set(['cancel']);

// ── Public error class ────────────────────────────────────────────────────────

export class MondayError extends Error {
  constructor(code, hebrew, cause) {
    super(hebrew);
    this.code   = code;
    this.hebrew = hebrew;
    this.cause  = cause;
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * @param {string}      apiToken
 * @param {string|number} boardId
 * @param {string|null} dateFrom  — ISO "YYYY-MM-DD" or null
 * @param {string|null} dateTo    — ISO "YYYY-MM-DD" or null
 * @returns {Promise<Object>}     — aggregated KPI context
 */
export async function fetchMondayData(apiToken, boardId, dateFrom = null, dateTo = null) {
  // Swap dates if from > to
  if (dateFrom && dateTo && new Date(dateFrom) > new Date(dateTo)) {
    [dateFrom, dateTo] = [dateTo, dateFrom];
  }

  // ── Step 1: fetch board column definitions ──────────────────────────────────
  const columnsQuery = `{
    boards(ids: [${boardId}]) {
      columns { id title type }
    }
  }`;

  const colResponse = await gqlRequest(apiToken, columnsQuery);
  const board = colResponse?.data?.boards?.[0];
  if (!board) {
    throw new MondayError('board_not_found', 'הלוח לא נמצא — בדוק את מזהה הלוח');
  }

  const columns = board.columns;
  const colMap  = buildColumnMap(columns);

  // ── Step 2: resolve date column ─────────────────────────────────────────────
  const dateInfo = resolveDateColumn(columns, colMap);

  // ── Step 3: paginate all items ──────────────────────────────────────────────
  const rows = await fetchAllItems(apiToken, boardId);

  // ── Step 4: parse rows ──────────────────────────────────────────────────────
  const parsed = rows.map(item => parseItem(item, colMap));

  // ── Step 5: date filtering ──────────────────────────────────────────────────
  const dateResult = filterByDate(parsed, dateInfo, dateFrom, dateTo);
  const filtered   = dateResult.items;
  const warnings   = [...dateResult.warnings];
  if (dateInfo.fallbackUsed) {
    warnings.push(`עמודת תאריך: נעשה שימוש בגיבוי ("${dateInfo.columnTitle}") — לא נמצאה עמודת "${COLUMN_TITLES.date}"`);
  }

  // ── Step 6: filter to paid Google Ads sources only ──────────────────────────
  const paid = filtered.filter(r => PAID_SOURCES.has(r.source));

  // ── Step 7: aggregate KPIs ──────────────────────────────────────────────────
  return aggregate(paid, warnings, colMap);
}

// ── Column map ────────────────────────────────────────────────────────────────

function buildColumnMap(columns) {
  const map = {};
  for (const [key, title] of Object.entries(COLUMN_TITLES)) {
    const col = columns.find(c => c.title === title);
    if (col) map[key] = { id: col.id, type: col.type };
  }
  return map;
}

// ── Date column resolution ────────────────────────────────────────────────────
// Use explicitly mapped 'date' column FIRST.
// Only fall back to type-based detection if the mapped column is absent.

function resolveDateColumn(columns, colMap) {
  if (colMap.date) {
    const col = columns.find(c => c.id === colMap.date.id);
    return { columnId: colMap.date.id, columnTitle: col?.title ?? COLUMN_TITLES.date, fallbackUsed: false };
  }

  // Fallback: first column with type === 'date'
  const fallbackCol = columns.find(c => c.type === 'date');
  if (fallbackCol) {
    return { columnId: fallbackCol.id, columnTitle: fallbackCol.title, fallbackUsed: true };
  }

  return { columnId: null, columnTitle: null, fallbackUsed: false };
}

// ── Item pagination ───────────────────────────────────────────────────────────

async function fetchAllItems(apiToken, boardId) {
  const rows  = [];
  let cursor  = null;
  let page    = 0;

  do {
    const cursorArg = cursor ? `, cursor: "${cursor}"` : '';
    const query = `{
      boards(ids: [${boardId}]) {
        items_page(limit: 500${cursorArg}) {
          cursor
          items {
            id
            column_values { id text value }
          }
        }
      }
    }`;

    const res  = await gqlRequest(apiToken, query);
    const page_data = res?.data?.boards?.[0]?.items_page;
    if (!page_data) break;

    rows.push(...(page_data.items ?? []));
    cursor = page_data.cursor ?? null;
    page++;
  } while (cursor && page < 20);

  return rows;
}

// ── Row parsing ───────────────────────────────────────────────────────────────

function parseItem(item, colMap) {
  const byId = {};
  for (const cv of item.column_values ?? []) {
    byId[cv.id] = cv;
  }

  const getText  = key => (colMap[key] ? byId[colMap[key].id]?.text?.trim() ?? '' : '');
  const getNum   = key => {
    const col = colMap[key];
    if (!col) return null;
    const cv = byId[col.id];
    if (!cv) return null;
    let raw;
    if (col.type === 'formula' || col.type === 'numbers') {
      raw = cv.value ?? cv.text;
    } else {
      raw = cv.text;
    }
    if (!raw) return null;
    const str = raw.toString().replace(/[^0-9.-]/g, '');
    const n = parseFloat(str);
    return Number.isFinite(n) ? n : null;
  };

  const result = {
    id:           item.id,
    source:       getText('source'),
    jobStatus:    getText('jobStatus'),
    date:         getText('date'),
    total:        getNum('total'),
    net:          getNum('net'),
    netLessParts: getNum('netLessParts'),
    parts:        getNum('parts'),
    gclid:        getText('gclid'),
    campaignId:   getText('campaignId'),
    adGroupId:    getText('adGroupId'),
    keyword:      getText('keyword'),
    matchType:    getText('matchType'),
    device:       getText('device'),
  };

  return result;
}

// ── Date filtering ────────────────────────────────────────────────────────────
// Parses dates safely — excludes items with missing/invalid dates with a warning count.

function filterByDate(items, dateInfo, dateFrom, dateTo) {
  const warnings = [];

  if (!dateInfo.columnId || (!dateFrom && !dateTo)) {
    return { items, warnings };
  }

  const fromMs = dateFrom ? parseDateMs(dateFrom) : null;
  const toMs   = dateTo   ? parseDateMs(dateTo)   : null;

  let invalidCount = 0;
  const result = [];

  for (const item of items) {
    const raw = item.date;
    if (!raw) {
      invalidCount++;
      continue;
    }
    const ms = parseDateMs(raw);
    if (ms === null) {
      invalidCount++;
      continue;
    }
    if (fromMs !== null && ms < fromMs) continue;
    if (toMs   !== null && ms > toMs)   continue;
    result.push(item);
  }

  if (invalidCount > 0) {
    warnings.push(`${invalidCount} פריטים הוחרגו — תאריך חסר או לא תקין`);
  }

  return { items: result, warnings };
}

function parseDateMs(str) {
  if (!str || typeof str !== 'string') return null;
  const d = new Date(str);
  return Number.isFinite(d.getTime()) ? d.getTime() : null;
}

// ── KPI aggregation ───────────────────────────────────────────────────────────

function aggregate(paid, warnings, colMap) {
  let bookedCount  = 0;
  let closedCount  = 0;
  let lostCount    = 0;

  let totalNet          = 0;
  let totalNetLessParts = 0;
  let totalGross        = 0;
  let closedWithNet     = 0;
  let closedWithNlp     = 0;

  const missingColumns = [];
  for (const key of ['source', 'jobStatus', 'net', 'netLessParts', 'total']) {
    if (!colMap[key]) missingColumns.push(COLUMN_TITLES[key]);
  }
  if (missingColumns.length) {
    warnings.push(`עמודות לא נמצאו בלוח: ${missingColumns.join(', ')}`);
  }

  for (const r of paid) {
    const statusLower = r.jobStatus.toLowerCase();
    const isClosed = CLOSED_LABELS.has(statusLower);
    const isBooked = BOOKED_LABELS.has(statusLower);
    const isLost   = LOST_LABELS.has(statusLower);

    if (isBooked) bookedCount++;
    if (isClosed) closedCount++;
    if (isLost)   lostCount++;

    if (isClosed) {
      if (r.net != null)          { totalNet          += r.net;          closedWithNet++; }
      if (r.netLessParts != null) { totalNetLessParts += r.netLessParts; closedWithNlp++; }
      if (r.total != null)        { totalGross        += r.total; }
    }
  }

  const paidLeadCount = paid.length;
  const bookRate  = paidLeadCount > 0 ? bookedCount  / paidLeadCount : null;
  const closeRate = paidLeadCount > 0 ? closedCount  / paidLeadCount : null;

  const avgNetRevenue    = closedWithNet > 0 ? totalNet          / closedWithNet : null;
  const avgNetLessParts  = closedWithNlp > 0 ? totalNetLessParts / closedWithNlp : null;

  // Warn when closed deals have no revenue data at all — silent blanks are confusing
  if (closedCount > 0 && closedWithNet === 0 && closedWithNlp === 0) {
    warnings.push(`נסגרו ${closedCount} עסקות אך לא נמצאו ערכי הכנסה — בדוק שעמודות "Net" ו-"Net Less Parts" ממולאות בלוח`);
  }

  return {
    paidLeadCount,
    bookedCount,
    closedCount,
    lostCount,
    bookRate,
    closeRate,
    avgNetRevenue,
    avgNetLessParts,
    totalNetRevenue:              closedWithNet > 0 ? totalNet          : null,
    totalNetLessParts:            closedWithNlp > 0 ? totalNetLessParts : null,
    totalGrossSoldIncludingGst:   closedWithNet > 0 ? totalGross        : null,
    warnings,
  };
}

// ── GraphQL request ───────────────────────────────────────────────────────────

async function gqlRequest(apiToken, query) {
  let res;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
    res = await fetch(MONDAY_API, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        Authorization:   `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new MondayError('network_error', 'החיבור ל-Monday.com נכשל בגלל timeout — נסה שוב מאוחר יותר', err);
    }
    throw new MondayError('network_error', 'לא ניתן להתחבר ל-Monday.com — בדוק את החיבור לאינטרנט', err);
  }

  if (res.status === 401 || res.status === 403) {
    throw new MondayError('auth_error', 'טוקן ה-API אינו תקין — בדוק את ההגדרות');
  }
  if (!res.ok) {
    throw new MondayError('network_error', `שגיאת שרת Monday.com (${res.status})`, null);
  }

  const json = await res.json();
  if (json?.errors?.length) {
    const msg = json.errors[0]?.message ?? '';
    if (/not found|invalid id/i.test(msg)) {
      throw new MondayError('board_not_found', 'הלוח לא נמצא — בדוק את מזהה הלוח');
    }
    throw new MondayError('network_error', `שגיאת Monday.com: ${msg}`);
  }

  return json;
}
