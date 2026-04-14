/**
 * businessContextPanel.js
 * Handles the lightweight business settings form used by decision guidance.
 */

import {
  loadBusinessContext,
  saveBusinessContext,
  normalizeBusinessContext,
} from '../storage/businessContext.js';

export function initBusinessContextPanel(onContextChange) {
  const form = document.getElementById('business-context-form');
  const status = document.getElementById('business-context-status');
  if (!form) return { ...loadBusinessContext() };

  const context = loadBusinessContext();
  applyFormValues(form, context);

  form.addEventListener('submit', event => {
    event.preventDefault();
    const next = readFormValues(form);
    const saved = saveBusinessContext(next);
    status.textContent = 'Saved. These settings will be used in the next analysis.';
    onContextChange(saved);
  });

  form.addEventListener('input', () => {
    status.textContent = 'Unsaved changes';
  });

  onContextChange(context);
  return context;
}

export function readCurrentBusinessContext() {
  const form = document.getElementById('business-context-form');
  if (!form) return loadBusinessContext();
  return readFormValues(form);
}

function applyFormValues(form, context) {
  setValue(form, 'target-cpl', context.targetCpl);
  setValue(form, 'service-area', context.serviceArea);
  setValue(form, 'excluded-services', context.excludedServices);
  setValue(form, 'preferred-lead-type', context.preferredLeadType);
  setValue(form, 'average-deal-value', context.averageDealValue);
  setValue(form, 'tracking-trusted', context.trackingTrusted);
  setValue(form, 'offline-conversions-imported', context.offlineConversionsImported);
  setValue(form, 'good-lead-note', context.goodLeadNote);
}

function readFormValues(form) {
  const raw = {
    targetCpl: getValue(form, 'target-cpl'),
    serviceArea: getValue(form, 'service-area'),
    excludedServices: getValue(form, 'excluded-services'),
    preferredLeadType: getValue(form, 'preferred-lead-type'),
    averageDealValue: getValue(form, 'average-deal-value'),
    trackingTrusted: getValue(form, 'tracking-trusted'),
    offlineConversionsImported: getValue(form, 'offline-conversions-imported'),
    goodLeadNote: getValue(form, 'good-lead-note'),
  };
  return normalizeBusinessContext(raw);
}

function getValue(form, id) {
  return form.querySelector(`#${id}`)?.value ?? '';
}

function setValue(form, id, value) {
  const el = form.querySelector(`#${id}`);
  if (!el) return;
  if (value === null || value === undefined) {
    el.value = '';
  } else if (typeof value === 'boolean') {
    el.value = String(value);
  } else {
    el.value = String(value);
  }
}
