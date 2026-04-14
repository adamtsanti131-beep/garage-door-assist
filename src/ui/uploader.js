/**
 * uploader.js
 * Manages the 7 CSV upload cards — one per report type.
 * Each card has a fixed slot type that maps to a REPORT_TYPES value.
 */

// Slot definitions — id must match HTML element IDs (file-{id}, status-{id}, upload-{id})
const SLOTS = [
  { key: 'campaign',   label: 'קמפיין'     },
  { key: 'adGroup',    label: 'קבוצת מודעות'     },
  { key: 'searchTerm', label: 'מונחי חיפוש' },
  { key: 'keyword',    label: 'מילות מפתח'     },
  { key: 'ad',         label: 'מודעות'          },
  { key: 'device',     label: 'מכשירים'      },
  { key: 'location',   label: 'מיקום'     },
];

/**
 * Initialize all upload cards.
 * @param {Function} onFilesChange — called with current files map whenever anything changes
 */
export function initUploader(onFilesChange) {
  const files = Object.fromEntries(SLOTS.map(s => [s.key, null]));

  for (const slot of SLOTS) {
    const input  = document.getElementById(`file-${slot.key}`);
    const status = document.getElementById(`status-${slot.key}`);
    const card   = document.getElementById(`upload-${slot.key}`);
    if (!input) continue;

    input.addEventListener('change', () => {
      const file = input.files[0] ?? null;

      if (!file) {
        files[slot.key] = null;
        setStatus(status, card, 'לא נבחר קובץ', '');
      } else if (!file.name.toLowerCase().endsWith('.csv')) {
        files[slot.key] = null;
        setStatus(status, card, `זה לא קובץ CSV: "${file.name}"`, 'error');
      } else {
        files[slot.key] = file;
        setStatus(status, card, `✓ ${file.name}`, 'success');
      }

      onFilesChange({ ...files });
    });
  }
}

/**
 * Show a validation warning under a specific upload card after analysis.
 * @param {string}   key      — slot key (e.g. 'campaign')
 * @param {string[]} warnings — warning messages to display
 */
export function showUploadWarnings(key, warnings) {
  const status = document.getElementById(`status-${key}`);
  if (!status || !warnings.length) return;
  const existing = status.textContent;
  status.textContent = `${existing} — ⚠️ ${warnings[0]}`;
  status.title = warnings.join('\n');
}

export function showUploadOutcome(key, statusInfo) {
  const status = document.getElementById(`status-${key}`);
  const card = document.getElementById(`upload-${key}`);
  if (!status || !card || !statusInfo) return;

  const map = {
    not_uploaded: { text: 'לא הועלה', tone: '' },
    uploaded_used: { text: 'הועלה ונעשה בו שימוש', tone: 'success' },
    uploaded_blocked: { text: `הועלה אך נחסם: ${statusInfo.blockReason ?? 'שגיאת תקינות'}`, tone: 'error' },
    uploaded_used_with_warnings: { text: 'הועלה ונעשה בו שימוש עם אזהרות', tone: 'success' },
  };

  const view = map[statusInfo.status] ?? map.not_uploaded;
  const extras = [];
  extras.push(`שורות בשימוש: ${statusInfo.rowCount ?? 0}`);
  if ((statusInfo.droppedAggregateRows ?? 0) > 0) {
    extras.push(`הוסרו ${statusInfo.droppedAggregateRows} שורות Total/Subtotal`);
  }

  status.textContent = `${view.text} · ${extras.join(' · ')}`;
  status.title = [
    ...(statusInfo.errors ?? []).slice(0, 3),
    ...(statusInfo.warnings ?? []).slice(0, 3),
  ].join('\n');

  status.className = 'file-status' + (view.tone ? ' ' + view.tone : '');
  card.classList.toggle('has-file', view.tone === 'success');
  card.classList.toggle('has-error', view.tone === 'error');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setStatus(statusEl, cardEl, message, state) {
  statusEl.textContent = message;
  statusEl.className   = 'file-status' + (state ? ' ' + state : '');
  cardEl.classList.toggle('has-file',  state === 'success');
  cardEl.classList.toggle('has-error', state === 'error');
}
