/**
 * businessContextPanel.js
 * Business context is now hardcoded for the Vancouver garage door account.
 * The form has been removed from the UI — context is built from known account defaults.
 */

import { normalizeBusinessContext } from '../storage/businessContext.js';

const ACCOUNT_DEFAULTS = {
  targetCpl:                 55,          // CA$55 — current real-world CPL target
  serviceArea:               'Vancouver, BC',
  excludedServices:          '',
  preferredLeadType:         '',
  averageDealValue:          null,
  trackingTrusted:           null,        // unknown until verified — keeps system honest
  offlineConversionsImported: false,
  goodLeadNote:              '',
};

/** No-op — form no longer exists in the DOM. */
export function initBusinessContextPanel(_onContextChange) {
  return normalizeBusinessContext(ACCOUNT_DEFAULTS);
}

/** Returns the fixed account defaults. No form to read. */
export function readCurrentBusinessContext() {
  return normalizeBusinessContext(ACCOUNT_DEFAULTS);
}
