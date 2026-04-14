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
  hint.textContent = 'Uploading files...';

  try {
    const formData = new FormData();
    for (const [key, file] of Object.entries(currentFiles)) {
      if (file) formData.append(key, file);
    }

    hint.textContent = 'Running analysis...';

    const response = await fetch('/analyze', { method: 'POST', body: formData });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Server error' }));
      throw new Error(err.error || `Server returned ${response.status}`);
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
