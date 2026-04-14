/**
 * main.js
 * Entry point — wires together uploader, renderer, and history.
 * Analysis is done server-side via POST /analyze.
 */

import { initUploader, showUploadWarnings } from './ui/uploader.js';
import { initHistoryPanel, refreshHistoryPanel } from './ui/historyPanel.js';
import { renderReport }  from './ui/reportRenderer.js';
import { saveToHistory } from './storage/history.js';

let currentFiles = {};

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initUploader(onFilesChange);
  initHistoryPanel(renderReport);
  document.getElementById('btn-analyze')?.addEventListener('click', runAnalysis);
});

// ── File change ───────────────────────────────────────────────────────────────

function onFilesChange(files) {
  currentFiles = files;
  const hasAny = Object.values(files).some(f => f !== null);
  document.getElementById('btn-analyze').disabled = !hasAny;
  document.getElementById('analyze-hint').textContent = hasAny
    ? 'Ready to analyze'
    : 'Upload at least one CSV to analyze';
}

// ── Analysis ──────────────────────────────────────────────────────────────────

async function runAnalysis() {
  const btn  = document.getElementById('btn-analyze');
  const hint = document.getElementById('analyze-hint');

  btn.disabled = true;
  btn.classList.add('loading');
  btn.textContent  = 'Analyzing...';
  hint.textContent = 'Checking server...';

  try {
    // ── Server connectivity check ─────────────────────────────────────────────
    // Fail fast with a clear message instead of a cryptic upload error
    try {
      const health = await fetch('/health');
      if (!health.ok) throw new Error();
    } catch {
      throw new Error(
        'Analysis server is not running. ' +
        'Open a terminal in the project folder and run: npm run dev  ' +
        '(both Vite and the Express server must start)'
      );
    }

    hint.textContent = 'Uploading files...';

    const formData = new FormData();
    for (const [key, file] of Object.entries(currentFiles)) {
      if (file) formData.append(key, file);
    }

    hint.textContent = 'Running analysis...';

    let response;
    try {
      response = await fetch('/analyze', { method: 'POST', body: formData });
    } catch {
      throw new Error('Cannot reach server. Open a terminal in the project folder and run: npm run dev');
    }

    if (!response.ok) {
      // Try JSON first; fall back to a status-specific human message
      const body = await response.text().catch(() => '');
      let errorMsg;
      try {
        const parsed = JSON.parse(body);
        errorMsg = parsed.error || `Server returned ${response.status}`;
      } catch {
        if (response.status === 502 || response.status === 503 || response.status === 504) {
          errorMsg = 'Cannot reach the analysis server. Make sure "npm run dev" is running and both Vite and the Express server started correctly.';
        } else {
          errorMsg = `Server returned ${response.status}. Check the terminal for error details.`;
        }
      }
      throw new Error(errorMsg);
    }

    const report = await response.json();

    // Show per-file validation warnings under each upload card
    if (report.validationResults) {
      for (const [key, result] of Object.entries(report.validationResults)) {
        if (result.warnings?.length) showUploadWarnings(key, result.warnings);
      }
    }

    saveToHistory(report);
    renderReport(report);
    refreshHistoryPanel(renderReport);

    const total = (report.waste?.length ?? 0)
                + (report.opportunities?.length ?? 0)
                + (report.controlRisks?.length ?? 0)
                + (report.measurementRisks?.length ?? 0);
    hint.textContent = `Done — ${total} finding${total !== 1 ? 's' : ''}`;

  } catch (err) {
    hint.textContent = `Error: ${err.message}`;
    console.error('[PPC Assistant]', err);
  } finally {
    btn.disabled    = false;
    btn.classList.remove('loading');
    btn.textContent = 'Analyze Reports';
  }
}
