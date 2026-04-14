/**
 * main.js
 * Entry point — wires together the uploader, report renderer, and history.
 * Analysis is now done server-side via POST /analyze.
 */

import { initUploader }                          from './ui/uploader.js';
import { initHistoryPanel, refreshHistoryPanel } from './ui/historyPanel.js';
import { renderReport }                          from './ui/reportRenderer.js';
import { saveToHistory }                         from './storage/history.js';

// Current file selection — updated by the uploader whenever a card changes
let currentFiles = { searchTerms: null, keywords: null, campaigns: null };

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initUploader(onFilesChange);
  initHistoryPanel(renderReport);
  setupAnalyzeButton();
});

// ── File change handler ───────────────────────────────────────────────────────

function onFilesChange(files) {
  currentFiles = files;

  const hasAny = Object.values(files).some(f => f !== null);
  const btn  = document.getElementById('btn-analyze');
  const hint = document.getElementById('analyze-hint');

  btn.disabled     = !hasAny;
  hint.textContent = hasAny ? 'Ready to analyze' : 'Upload at least one CSV to analyze';
}

// ── Analyze button ────────────────────────────────────────────────────────────

function setupAnalyzeButton() {
  document.getElementById('btn-analyze')?.addEventListener('click', runAnalysis);
}

async function runAnalysis() {
  const btn  = document.getElementById('btn-analyze');
  const hint = document.getElementById('analyze-hint');

  btn.disabled     = true;
  btn.classList.add('loading');
  btn.textContent  = 'Analyzing...';
  hint.textContent = 'Uploading files...';

  try {
    // Build FormData — only include files that were actually selected
    const formData = new FormData();
    if (currentFiles.searchTerms) formData.append('searchTerms', currentFiles.searchTerms);
    if (currentFiles.keywords)    formData.append('keywords',    currentFiles.keywords);
    if (currentFiles.campaigns)   formData.append('campaigns',   currentFiles.campaigns);

    hint.textContent = 'Running analysis...';

    // Send to Express backend (Vite proxies /analyze → localhost:3001)
    const response = await fetch('/analyze', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Server error' }));
      throw new Error(err.error || `Server returned ${response.status}`);
    }

    const report = await response.json();

    saveToHistory(report);
    renderReport(report);
    refreshHistoryPanel(renderReport);

    const total = (report.criticalIssues?.length || 0)
                + (report.improvements?.length   || 0)
                + (report.whatsWorking?.length    || 0);
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
