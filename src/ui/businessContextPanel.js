/**
 * businessContextPanel.js
 * Business context is now hardcoded for the Vancouver garage door account.
 * The form has been removed from the UI — context is built from known account defaults.
 *
 * All default values live in src/config/accountDefaults.js — edit there, not here.
 */

import { normalizeBusinessContext } from '../storage/businessContext.js';
import { ACCOUNT_DEFAULTS } from '../config/accountDefaults.js';

/** No-op — form no longer exists in the DOM. */
export function initBusinessContextPanel(_onContextChange) {
  return normalizeBusinessContext(ACCOUNT_DEFAULTS);
}

/** Returns the fixed account defaults. No form to read. */
export function readCurrentBusinessContext() {
  return normalizeBusinessContext(ACCOUNT_DEFAULTS);
}
