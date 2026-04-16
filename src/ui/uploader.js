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
    const input   = document.getElementById(`file-${slot.key}`);
    const status  = document.getElementById(`status-${slot.key}`);
    const card    = document.getElementById(`upload-${slot.key}`);
    if (!input || !status || !card) continue;

    const fileNameEl = document.createElement('div');
    fileNameEl.className = 'file-name';
    fileNameEl.id = `file-name-${slot.key}`;
    fileNameEl.textContent = 'לא נבחר קובץ';
    card.insertBefore(fileNameEl, status);

    const noteEl = document.createElement('div');
    noteEl.className = 'file-note';
    noteEl.id = `note-${slot.key}`;
    card.insertBefore(noteEl, status);

    input.addEventListener('change', () => {
      const file = input.files[0] ?? null;
      const fileLabel = file ? file.name : 'לא נבחר קובץ';
      fileNameEl.textContent = fileLabel;
      noteEl.textContent = '';

      if (!file) {
        files[slot.key] = null;
        setStatus(status, card, 'אין קובץ להעלאה', '');
      } else if (!file.name.toLowerCase().endsWith('.csv')) {
        files[slot.key] = null;
        setStatus(status, card, `זה לא קובץ CSV`, 'error');
      } else {
        files[slot.key] = file;
        setStatus(status, card, 'קובץ מוכן לניתוח', 'success');
      }

      onFilesChange({ ...files });
    });
  }
}

/**
 * Clear or append warnings to the upload note area without overwriting the file name.
 */
export function showUploadWarnings(key, warnings) {
  const note = document.getElementById(`note-${key}`);
  if (!note || !warnings?.length) return;
  const existing = note.textContent ? [note.textContent] : [];
  note.textContent = [...existing, `אזהרה: ${warnings[0]}`].join(' · ');
}

export function showUploadOutcome(key, statusInfo) {
  const status = document.getElementById(`status-${key}`);
  const note   = document.getElementById(`note-${key}`);
  const fileName = document.getElementById(`file-name-${key}`);
  const card = document.getElementById(`upload-${key}`);
  if (!status || !card || !statusInfo) return;

  if (fileName && statusInfo.fileName) {
    fileName.textContent = statusInfo.fileName;
  }

  const map = {
    not_uploaded: { text: 'לא הועלה קובץ', tone: '' },
    uploaded_used: { text: 'הועלה ונעשה בו שימוש', tone: 'success' },
    uploaded_blocked: { text: `הועלה אך נחסם`, tone: 'error' },
    uploaded_used_with_warnings: { text: 'הועלה ונעשה בו שימוש עם אזהרות', tone: 'success' },
  };

  const view = map[statusInfo.status] ?? map.not_uploaded;
  const extras = [];
  if (statusInfo.rowCount != null) extras.push(`שורות: ${statusInfo.rowCount}`);
  if ((statusInfo.droppedAggregateRows ?? 0) > 0) {
    extras.push(`הוסרו ${statusInfo.droppedAggregateRows} שורות Total/Subtotal`);
  }

  status.textContent = [view.text, ...extras].join(' · ');
  status.className = 'file-status' + (view.tone ? ' ' + view.tone : '');
  card.classList.toggle('has-file', statusInfo.uploaded && view.tone !== 'error');
  card.classList.toggle('has-error', view.tone === 'error');

  const noteLines = [];
  // Only show match state if it's meaningful: either match_confirmed or strong_mismatch
  // Don't show neutral/weak states like likely_match or possible_mismatch to avoid clutter
  if (statusInfo.slotMatch && statusInfo.slotMatch.state === 'match_confirmed') {
    const label = formatMatchLabel(statusInfo.slotMatch.state);
    noteLines.push(`${label}: ${statusInfo.slotMatch.reason}`);
  } else if (statusInfo.slotMatch && statusInfo.slotMatch.state === 'strong_mismatch') {
    const label = formatMatchLabel(statusInfo.slotMatch.state);
    noteLines.push(`${label}: ${statusInfo.slotMatch.reason}`);
  }
  if (statusInfo.blockReason) {
    noteLines.push(statusInfo.blockReason);
  }
  if (note) {
    note.textContent = noteLines.join(' · ');
  }
}

function formatMatchLabel(state) {
  const labels = {
    match_confirmed: 'התאמה מאומתת',
    likely_match: 'התאמה סבירה',
    possible_mismatch: 'אי התאמה אפשרית',
    strong_mismatch: 'אי התאמה חזקה',
  };
  return labels[state] ?? 'תאימות קובץ';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setStatus(statusEl, cardEl, message, state) {
  statusEl.textContent = message;
  statusEl.className   = 'file-status' + (state ? ' ' + state : '');
  cardEl.classList.toggle('has-file',  state === 'success');
  cardEl.classList.toggle('has-error', state === 'error');
}
