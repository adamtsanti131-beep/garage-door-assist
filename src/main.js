/**
 * main.js
 * Entry point — wires together every module.
 */

import { initUploader }                       from './ui/uploader.js';
import { initHistoryPanel, refreshHistoryPanel } from './ui/historyPanel.js';
import { renderReport }                       from './ui/reportRenderer.js';
import { parseCSV }                           from './parser/csvParser.js';
import { normalizeRows }                      from './parser/fieldNormalizer.js';
import { runRules }                           from './analysis/rulesEngine.js';
import { buildReport }                        from './analysis/reportBuilder.js';
import { saveToHistory }                      from './storage/history.js';

// Current file selection — updated by the uploader whenever a card changes
let currentFiles = { searchTerms: null, keywords: null, campaigns: null };

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initUploader(onFilesChange);
  initHistoryPanel(renderReport); // clicking history entries re-renders the report
  setupAnalyzeButton();
});

// ── File change handler ───────────────────────────────────────────────────────

function onFilesChange(files) {
  currentFiles = files;

  const hasAny = Object.values(files).some(f => f !== null);
  const btn  = document.getElementById('btn-analyze');
  const hint = document.getElementById('analyze-hint');

  btn.disabled      = !hasAny;
  hint.textContent  = hasAny ? 'Ready to analyze' : 'Upload at least one CSV to analyze';
}

// ── Analyze button ────────────────────────────────────────────────────────────

function setupAnalyzeButton() {
  document.getElementById('btn-analyze')?.addEventListener('click', runAnalysis);
}

async function runAnalysis() {
  const btn  = document.getElementById('btn-analyze');
  const hint = document.getElementById('analyze-hint');

  // Loading state
  btn.disabled     = true;
  btn.classList.add('loading');
  btn.textContent  = 'Analyzing...';
  hint.textContent = 'Reading files...';

  try {
    const data = await readAndParseFiles(currentFiles);

    hint.textContent = 'Running analysis...';
    const findings = runRules(data);
    const report   = buildReport(findings, data);

    saveToHistory(report);
    renderReport(report);
    refreshHistoryPanel(renderReport);

    const total = findings.length;
    hint.textContent = `Done — ${total} finding${total !== 1 ? 's' : ''}`;
  } catch (err) {
    hint.textContent = `Error: ${err.message}`;
    console.error('[PPC Assistant] Analysis failed:', err);
  } finally {
    btn.disabled    = false;
    btn.classList.remove('loading');
    btn.textContent = 'Analyze Reports';
  }
}

// ── File reading + parsing ────────────────────────────────────────────────────

async function readAndParseFiles(files) {
  const [stRaw, kwRaw, campRaw] = await Promise.all([
    files.searchTerms ? readFile(files.searchTerms) : null,
    files.keywords    ? readFile(files.keywords)    : null,
    files.campaigns   ? readFile(files.campaigns)   : null,
  ]);

  return {
    searchTerms: stRaw   ? normalizeRows(parseCSV(stRaw).rows)   : [],
    keywords:    kwRaw   ? normalizeRows(parseCSV(kwRaw).rows)   : [],
    campaigns:   campRaw ? normalizeRows(parseCSV(campRaw).rows) : [],
  };
}

/** Read a File object as UTF-8 text. */
function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error(`Failed to read "${file.name}"`));
    reader.readAsText(file, 'UTF-8');
  });
}
