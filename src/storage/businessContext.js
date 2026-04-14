/**
 * businessContext.js
 * Lightweight local persistence for business settings used by decision logic.
 */

const STORAGE_KEY = 'ppc_business_context_v1';

export const DEFAULT_BUSINESS_CONTEXT = {
  targetCpl: null,
  serviceArea: '',
  excludedServices: '',
  preferredLeadType: '',
  averageDealValue: null,
  trackingTrusted: null,
  offlineConversionsImported: null,
  goodLeadNote: '',
};

export function loadBusinessContext() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_BUSINESS_CONTEXT };
    return normalizeBusinessContext(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_BUSINESS_CONTEXT };
  }
}

export function saveBusinessContext(context) {
  const normalized = normalizeBusinessContext(context);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function normalizeBusinessContext(context = {}) {
  return {
    targetCpl: toNullableNumber(context.targetCpl),
    serviceArea: String(context.serviceArea ?? '').trim(),
    excludedServices: String(context.excludedServices ?? '').trim(),
    preferredLeadType: String(context.preferredLeadType ?? '').trim(),
    averageDealValue: toNullableNumber(context.averageDealValue),
    trackingTrusted: toNullableBoolean(context.trackingTrusted),
    offlineConversionsImported: toNullableBoolean(context.offlineConversionsImported),
    goodLeadNote: String(context.goodLeadNote ?? '').trim(),
  };
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNullableBoolean(value) {
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}
