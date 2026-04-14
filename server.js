/**
 * server.js
 * Express backend for the Garage Door PPC Assistant.
 *
 * POST /analyze  — receives up to 3 CSV files, runs the rules engine,
 *                  returns a structured JSON report.
 *
 * Easy to extend later: add an /analyze/ai endpoint that calls OpenAI
 * with the same report data for a natural language summary.
 */

import express  from 'express';
import multer   from 'multer';
import cors     from 'cors';

import { parseCSV }      from './src/parser/csvParser.js';
import { normalizeRows } from './src/parser/fieldNormalizer.js';
import { runRules }      from './src/analysis/rulesEngine.js';
import { buildReport }   from './src/analysis/reportBuilder.js';

const app    = express();
const upload = multer({ storage: multer.memoryStorage() }); // files stay in RAM, no disk writes

app.use(cors());
app.use(express.json());

// ── POST /analyze ─────────────────────────────────────────────────────────────
// Accepts multipart/form-data with optional fields:
//   searchTerms  — CSV file
//   keywords     — CSV file
//   campaigns    — CSV file
// Returns a JSON report with criticalIssues, improvements, whatsWorking, topActions

app.post('/analyze', upload.fields([
  { name: 'searchTerms', maxCount: 1 },
  { name: 'keywords',    maxCount: 1 },
  { name: 'campaigns',   maxCount: 1 },
]), (req, res) => {
  try {
    const files = req.files || {};

    if (Object.keys(files).length === 0) {
      return res.status(400).json({ error: 'No CSV files were uploaded.' });
    }

    // Parse each uploaded file from buffer → normalized rows
    const data = {
      searchTerms: parseBuffer(files.searchTerms?.[0]),
      keywords:    parseBuffer(files.keywords?.[0]),
      campaigns:   parseBuffer(files.campaigns?.[0]),
    };

    const findings = runRules(data);
    const report   = buildReport(findings, data);

    res.json(report);

  } catch (err) {
    console.error('[/analyze] Error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse a multer file object into normalized rows.
 * Returns an empty array if no file was provided.
 */
function parseBuffer(file) {
  if (!file) return [];
  const text = file.buffer.toString('utf-8');
  return normalizeRows(parseCSV(text).rows);
}

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`PPC Assistant server running → http://localhost:${PORT}`);
});
