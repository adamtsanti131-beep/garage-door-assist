/**
 * uploader.js
 * Manages the three CSV upload cards.
 * Calls back with the current file selection whenever any card changes.
 */

const CARDS = [
  {
    key:         'searchTerms',
    fileInputId: 'file-search-terms',
    statusId:    'status-search-terms',
    cardId:      'upload-search-terms',
  },
  {
    key:         'keywords',
    fileInputId: 'file-keywords',
    statusId:    'status-keywords',
    cardId:      'upload-keywords',
  },
  {
    key:         'campaigns',
    fileInputId: 'file-campaigns',
    statusId:    'status-campaigns',
    cardId:      'upload-campaigns',
  },
];

/**
 * Initialize upload card event listeners.
 * @param {Function} onFilesChange - Called with { searchTerms, keywords, campaigns }
 *   each time any file selection changes. Values are File objects or null.
 */
export function initUploader(onFilesChange) {
  const files = { searchTerms: null, keywords: null, campaigns: null };

  for (const card of CARDS) {
    const input  = document.getElementById(card.fileInputId);
    const status = document.getElementById(card.statusId);
    const cardEl = document.getElementById(card.cardId);

    if (!input) continue;

    input.addEventListener('change', () => {
      const file = input.files[0] || null;

      if (!file) {
        files[card.key] = null;
        setStatus(status, cardEl, 'No file selected', '');
      } else if (!file.name.toLowerCase().endsWith('.csv')) {
        files[card.key] = null;
        setStatus(status, cardEl, `Not a CSV file: "${file.name}"`, 'error');
      } else {
        files[card.key] = file;
        setStatus(status, cardEl, `✓ ${file.name}`, 'success');
      }

      onFilesChange({ ...files });
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setStatus(statusEl, cardEl, message, state) {
  statusEl.textContent = message;
  statusEl.className = 'file-status' + (state ? ' ' + state : '');
  cardEl.classList.toggle('has-file',  state === 'success');
  cardEl.classList.toggle('has-error', state === 'error');
}
