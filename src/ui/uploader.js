/**
 * uploader.js
 * Manages the 7 CSV upload cards — one per report type.
 * Each card has a fixed slot type that maps to a REPORT_TYPES value.
 */

// Slot definitions — id must match HTML element IDs (file-{id}, status-{id}, upload-{id})
const SLOTS = [
  { key: 'campaign',   label: 'Campaign'     },
  { key: 'adGroup',    label: 'Ad Group'     },
  { key: 'searchTerm', label: 'Search Terms' },
  { key: 'keyword',    label: 'Keywords'     },
  { key: 'ad',         label: 'Ads'          },
  { key: 'device',     label: 'Devices'      },
  { key: 'location',   label: 'Location'     },
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
        setStatus(status, card, 'No file selected', '');
      } else if (!file.name.toLowerCase().endsWith('.csv')) {
        files[slot.key] = null;
        setStatus(status, card, `Not a CSV: "${file.name}"`, 'error');
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function setStatus(statusEl, cardEl, message, state) {
  statusEl.textContent = message;
  statusEl.className   = 'file-status' + (state ? ' ' + state : '');
  cardEl.classList.toggle('has-file',  state === 'success');
  cardEl.classList.toggle('has-error', state === 'error');
}
