/**
 * main.js
 * Entry point — wires together uploader, renderer, and history.
 * Analysis is done server-side via POST /analyze.
 */

import { initUploader, showUploadOutcome, showUploadWarnings } from './ui/uploader.js';
import { initHistoryPanel, refreshHistoryPanel } from './ui/historyPanel.js';
import { renderReport }  from './ui/reportRenderer.js';
import { saveToHistory } from './storage/history.js';
import { readCurrentBusinessContext } from './ui/businessContextPanel.js';

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
    ? 'מוכן לניתוח'
    : 'יש להעלות לפחות קובץ CSV אחד לניתוח';
}

// ── Analysis ──────────────────────────────────────────────────────────────────

async function runAnalysis() {
  const btn  = document.getElementById('btn-analyze');
  const hint = document.getElementById('analyze-hint');

  btn.disabled = true;
  btn.classList.add('loading');
  btn.textContent  = 'מנתח...';
  hint.textContent = 'בודק זמינות שרת...';

  try {
    // ── Server connectivity check ─────────────────────────────────────────────
    // Fail fast with a clear message instead of a cryptic upload error
    try {
      const health = await fetch('/health');
      if (!health.ok) throw new Error();
    } catch {
      throw new Error(
        'Analysis server is not running. ' +
        'פתח טרמינל בתיקיית הפרויקט והריץ: npm run dev  ' +
        '(גם Vite וגם שרת Express חייבים לעלות)'
      );
    }

    hint.textContent = 'מעלה קבצים...';

    const formData = new FormData();
    for (const [key, file] of Object.entries(currentFiles)) {
      if (file) formData.append(key, file);
    }

    const businessContext = readCurrentBusinessContext();
    formData.append('businessContext', JSON.stringify(businessContext));

    hint.textContent = 'מריץ ניתוח...';

    let response;
    try {
      response = await fetch('/analyze', { method: 'POST', body: formData });
    } catch {
      throw new Error('לא ניתן להתחבר לשרת. פתח טרמינל בתיקיית הפרויקט והרץ: npm run dev');
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
          errorMsg = 'לא ניתן להגיע לשרת הניתוח. ודא ש-"npm run dev" רץ ושגם Vite וגם שרת Express עלו תקין.';
        } else {
          errorMsg = `השרת החזיר ${response.status}. בדוק את הטרמינל לפרטי שגיאה.`;
        }
      }
      throw new Error(errorMsg);
    }

    const report = await response.json();

    // Show per-file usage status and warnings under each upload card
    if (report.reportStatuses) {
      for (const [key, status] of Object.entries(report.reportStatuses)) {
        showUploadOutcome(key, status);
      }
    }

    if (report.validationResults) {
      for (const [key, result] of Object.entries(report.validationResults)) {
        if (result.warnings?.length) showUploadWarnings(key, result.warnings);
      }
    }

    saveToHistory(report);
    renderReport(report);
    refreshHistoryPanel(renderReport);

    const highCount = report.summary?.highSeverityCount ?? 0;
    const totalWaste = report.waste?.length ?? 0;
    hint.textContent = highCount > 0
      ? `הושלם — ${highCount} ממצאים דחופים דורשים טיפול`
      : totalWaste > 0
      ? `הושלם — נמצאו ${totalWaste} ממצאי בזבוז לבדיקה`
      : 'הושלם — לא נמצאו ממצאים דחופים';

  } catch (err) {
    hint.textContent = `שגיאה: ${err.message}`;
    console.error('[PPC Assistant]', err);
  } finally {
    btn.disabled    = false;
    btn.classList.remove('loading');
    btn.textContent = 'ניתוח דוחות';
  }
}
