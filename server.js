/**
 * server.js
 * Express backend for the Garage Door PPC Assistant.
 *
 * POST /analyze  — receives up to 7 CSV files (one per report type),
 *                  routes each through the correct parser, runs the rules engine,
 *                  returns a structured JSON report.
 */

import express from 'express';
import multer  from 'multer';
import cors    from 'cors';
import path    from 'path';
import fs      from 'fs';
import { fileURLToPath } from 'url';

import { REPORT_TYPES }  from './src/parser/schemas.js';
import { routeReport }   from './src/parser/reportRouter.js';
import { runRules }      from './src/analysis/rulesEngine.js';
import { buildReport }   from './src/analysis/reportBuilder.js';
import { fetchMondayData, MondayError } from './src/monday/mondayAggregator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app    = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// ── POST /analyze ─────────────────────────────────────────────────────────────
// Accepts multipart/form-data. Field names map directly to REPORT_TYPES values:
//   campaign | adGroup | searchTerm | keyword | ad | device | location
// Each field accepts one CSV file. All fields are optional — send what you have.

const UPLOAD_FIELDS = Object.values(REPORT_TYPES).map(name => ({ name, maxCount: 1 }));
const ALL_REPORT_TYPES = Object.values(REPORT_TYPES);
const REPORT_LABELS = {
  [REPORT_TYPES.CAMPAIGN]: 'דוח קמפיינים',
  [REPORT_TYPES.AD_GROUP]: 'דוח קבוצות מודעות',
  [REPORT_TYPES.SEARCH_TERMS]: 'דוח מונחי חיפוש',
  [REPORT_TYPES.KEYWORDS]: 'דוח מילות מפתח',
  [REPORT_TYPES.ADS]: 'דוח מודעות',
  [REPORT_TYPES.DEVICES]: 'דוח מכשירים',
  [REPORT_TYPES.LOCATION]: 'דוח מיקומים',
};

app.post('/analyze', upload.fields(UPLOAD_FIELDS), (req, res) => {
  try {
    const files = req.files || {};
    const businessContext = parseBusinessContext(req.body?.businessContext);

    if (Object.keys(files).length === 0) {
      return res.status(400).json({ error: 'לא הועלו קובצי CSV.' });
    }

    // Parse each file using the correct parser for its slot type
    const parsedReports = {};
    const validationResults = {};
    const reportStatuses = {};

    for (const reportType of ALL_REPORT_TYPES) {
      const file = files[reportType]?.[0] ?? null;
      if (!file) {
        reportStatuses[reportType] = {
          reportType,
          label: REPORT_LABELS[reportType] ?? reportType,
          status: 'not_uploaded',
          uploaded: false,
          fileName: null,
          rowCount: 0,
          droppedAggregateRows: 0,
          warnings: [],
          errors: [],
          blockReason: null,
        };
      }
    }

    for (const [reportType, fileArr] of Object.entries(files)) {
      const file = fileArr[0];
      const csvText = file.buffer.toString('utf-8');
      const result = routeReport(csvText, reportType);

      validationResults[reportType] = result.validation;

      const droppedAggregateRows =
        (result.parseMeta?.droppedAggregateRows ?? 0)
        + (result.parseMeta?.droppedAggregateRowsInNormalizer ?? 0);

      const baseStatus = {
        reportType,
        label: REPORT_LABELS[reportType] ?? reportType,
        uploaded: true,
        fileName: file.originalname,
        rowCount: result.validation?.rowCount ?? 0,
        droppedAggregateRows,
        warnings: result.validation?.warnings ?? [],
        errors: result.validation?.errors ?? [],
        detectedType: result.detectedType ?? null,
        slotMatch: result.validation?.slotMatch ?? null,
        blockReason: null,
      };

      // Block this report type if required columns are missing
      if (!result.validation.ok) {
        console.warn(`[/analyze] ${reportType} נחסם:`, result.validation.errors);
        reportStatuses[reportType] = {
          ...baseStatus,
          status: 'uploaded_blocked',
          blockReason: summarizeBlockReason(result.validation),
        };
        continue;
      }

      parsedReports[reportType] = result.rows;
      // Only amber (uploaded_used_with_warnings) for warnings the user can act on:
      //   - slot mismatch detected (user may have uploaded to wrong slot)
      //   - suspicious data (e.g. zero conversions whole account, leads > clicks)
      // NOT for informational-only warnings:
      //   - "missing preferred columns" (normal — export may not include all columns)
      //   - "aggregate rows removed" (informational — expected cleanup)
      const hasMeaningfulWarning = isMeaningfulWarning(result.validation);
      reportStatuses[reportType] = {
        ...baseStatus,
        status: hasMeaningfulWarning ? 'uploaded_used_with_warnings' : 'uploaded_used',
      };
    }

    // Map slot names to the data shape the rules engine expects
    const data = {
      campaigns:   parsedReports[REPORT_TYPES.CAMPAIGN]     ?? [],
      adGroups:    parsedReports[REPORT_TYPES.AD_GROUP]      ?? [],
      searchTerms: parsedReports[REPORT_TYPES.SEARCH_TERMS]  ?? [],
      keywords:    parsedReports[REPORT_TYPES.KEYWORDS]      ?? [],
      ads:         parsedReports[REPORT_TYPES.ADS]           ?? [],
      devices:     parsedReports[REPORT_TYPES.DEVICES]       ?? [],
      locations:   parsedReports[REPORT_TYPES.LOCATION]      ?? [],
    };

    const hasAnyData = Object.values(data).some(arr => arr.length > 0);
    if (!hasAnyData) {
      return res.status(400).json({
        error: 'כל הקבצים שהועלו נכשלו בבדיקת תקינות. יש לוודא שהועלו סוגי הדוחות הנכונים.',
        validationResults,
        reportStatuses,
      });
    }

    const findings = runRules(data);
    const report   = buildReport(findings, data, businessContext, reportStatuses);

    // Attach validation results so the frontend can show per-file warnings
    report.validationResults = validationResults;
    report.reportStatuses = reportStatuses;
    report.coverageStatusCounts = countCoverageStatuses(reportStatuses);

    res.json(report);

  } catch (err) {
    console.error('[/analyze] שגיאה לא צפויה:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /monday/fetch ────────────────────────────────────────────────────────
// Accepts JSON: { apiToken, boardId, dateFrom?, dateTo? }
// Returns aggregated KPI context from the Monday.com board.

app.post('/monday/fetch', async (req, res) => {
  const { apiToken, boardId, dateFrom, dateTo } = req.body ?? {};

  if (!apiToken || !boardId) {
    return res.status(400).json({ error: 'יש לספק apiToken ו-boardId' });
  }

  try {
    const context = await fetchMondayData(apiToken, boardId, dateFrom ?? null, dateTo ?? null);
    res.json(context);
  } catch (err) {
    if (err instanceof MondayError) {
      const statusCode = err.code === 'auth_error' ? 401
                       : err.code === 'board_not_found' ? 404
                       : 502;
      return res.status(statusCode).json({ error: err.hebrew });
    }
    console.error('[/monday/fetch] שגיאה לא צפויה:', err);
    res.status(500).json({ error: 'שגיאת שרת בלתי צפויה בחיבור ל-Monday.com' });
  }
});

// ── Static files (production build) ──────────────────────────────────────────
// In production Render builds the Vite app first, then Express serves it.

const distDir = path.join(__dirname, 'dist');
const hasDist = fs.existsSync(path.join(distDir, 'index.html'));

if (hasDist) {
  app.use(express.static(distDir));
}

// ── GET /health ───────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ ok: true }));

// ── SPA fallback ─────────────────────────────────────────────────────────────
// Any request that isn't /analyze or /health falls through to index.html
// so that browser refreshes on sub-routes don't 404.

if (hasDist) {
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

// ── Global error handler ──────────────────────────────────────────────────────
// Catches anything that slips past the route try/catch (e.g. multer errors)

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[/analyze] שגיאת תווכה:', err);
  res.status(500).json({ error: err.message || 'שגיאת שרת לא צפויה' });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`שרת עוזר PPC פעיל בכתובת: http://localhost:${PORT}`);
  console.log(`בדיקת תקינות: http://localhost:${PORT}/health`);
});

function parseBusinessContext(raw) {
  if (!raw) return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      targetCpl: toNullableNumber(parsed.targetCpl),
      serviceArea: safeString(parsed.serviceArea),
      excludedServices: safeString(parsed.excludedServices),
      preferredLeadType: safeString(parsed.preferredLeadType),
      averageDealValue: toNullableNumber(parsed.averageDealValue),
      trackingTrusted: toNullableBoolean(parsed.trackingTrusted),
      offlineConversionsImported: toNullableBoolean(parsed.offlineConversionsImported),
      goodLeadNote: safeString(parsed.goodLeadNote),
      // Monday.com enrichment (optional — null when not connected)
      closeRate: toNullableNumber(parsed.closeRate),
      bookRate: toNullableNumber(parsed.bookRate),
      avgNetRevenue: toNullableNumber(parsed.avgNetRevenue),
      avgNetLessParts: toNullableNumber(parsed.avgNetLessParts),
      mondayContext: parsed.mondayContext ?? null,
    };
  } catch {
    return {};
  }
}

function toNullableNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toNullableBoolean(value) {
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function safeString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function summarizeBlockReason(validation) {
  if (!validation) return 'הקובץ נחסם עקב שגיאת בדיקה.';
  if (validation.missingRequired?.length) return 'חסרות עמודות חובה.';

  const firstError = validation.errors?.[0] ?? '';
  if (firstError.includes('Total')) return 'לא נשארו שורות נתונים אחרי הסרת שורות Total/Subtotal.';
  if (firstError.includes('פענח')) return 'מבנה CSV לא נתמך או קובץ פגום.';
  if (firstError.includes('כותרת')) return 'מבנה ייצוא לא נתמך: לא נמצאה שורת כותרת תקינה.';
  return firstError || 'הקובץ נחסם עקב שגיאת בדיקה.';
}

/**
 * A warning is "meaningful" (warrants amber status) only if it signals something
 * the user can investigate or act on:
 *   - slot mismatch: user may have uploaded the wrong file
 *   - suspicious data: zero conversions account-wide, leads > clicks, abnormal CTR
 *
 * Informational-only warnings (missing preferred columns, aggregate rows removed)
 * do NOT trigger amber — they are routine and not actionable by the uploader.
 */
function isMeaningfulWarning(validation) {
  if (!validation) return false;

  // Strong slot-type mismatch
  if (validation.slotMatch?.state === 'strong_mismatch') return true;

  // Suspicious-data warnings from checkForSuspiciousData() in validator.js
  const SUSPICIOUS_PREFIXES = ['אפס המרות', 'ההמרות', 'זוהה CTR'];
  return (validation.warnings ?? []).some(w =>
    SUSPICIOUS_PREFIXES.some(prefix => w.startsWith(prefix))
  );
}

function countCoverageStatuses(reportStatuses) {
  const counts = {
    not_uploaded: 0,
    uploaded_used: 0,
    uploaded_blocked: 0,
    uploaded_used_with_warnings: 0,
  };

  for (const item of Object.values(reportStatuses ?? {})) {
    if (counts[item.status] != null) counts[item.status] += 1;
  }

  return counts;
}
