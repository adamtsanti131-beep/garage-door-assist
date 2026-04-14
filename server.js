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
import { fileURLToPath } from 'url';

import { REPORT_TYPES }  from './src/parser/schemas.js';
import { routeReport }   from './src/parser/reportRouter.js';
import { runRules }      from './src/analysis/rulesEngine.js';
import { buildReport }   from './src/analysis/reportBuilder.js';

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

app.post('/analyze', upload.fields(UPLOAD_FIELDS), (req, res) => {
  try {
    const files = req.files || {};

    if (Object.keys(files).length === 0) {
      return res.status(400).json({ error: 'No CSV files were uploaded.' });
    }

    // Parse each file using the correct parser for its slot type
    const parsedReports = {};
    const validationResults = {};

    for (const [reportType, fileArr] of Object.entries(files)) {
      const file = fileArr[0];
      const csvText = file.buffer.toString('utf-8');
      const result = routeReport(csvText, reportType);

      validationResults[reportType] = result.validation;

      // Block this report type if required columns are missing
      if (!result.validation.ok) {
        console.warn(`[/analyze] ${reportType} blocked:`, result.validation.errors);
        continue;
      }

      parsedReports[reportType] = result.rows;
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
        error: 'All uploaded files failed validation. Check that you uploaded the correct report types.',
        validationResults,
      });
    }

    const findings = runRules(data);
    const report   = buildReport(findings, data);

    // Attach validation results so the frontend can show per-file warnings
    report.validationResults = validationResults;

    res.json(report);

  } catch (err) {
    console.error('[/analyze] Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Static files (production build) ──────────────────────────────────────────
// In production Render builds the Vite app first, then Express serves it.

const distDir = path.join(__dirname, 'dist');
app.use(express.static(distDir));

// ── GET /health ───────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ ok: true }));

// ── SPA fallback ─────────────────────────────────────────────────────────────
// Any request that isn't /analyze or /health falls through to index.html
// so that browser refreshes on sub-routes don't 404.

app.get('*', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

// ── Global error handler ──────────────────────────────────────────────────────
// Catches anything that slips past the route try/catch (e.g. multer errors)

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[/analyze] Middleware error:', err);
  res.status(500).json({ error: err.message || 'Unexpected server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`PPC Assistant server running → http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
