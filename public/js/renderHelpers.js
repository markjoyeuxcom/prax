import { designPriority } from './statusMap.js';
import { escapeHtml } from './html.js';

// Shared helpers for the Prax render modules. Escaping lives in html.js;
// escapeHtml is re-exported here for modules that still import it from this
// file (main.js).
export { escapeHtml };

// Small pill chip. Variants map to prax.css chip modifiers:
// state-active / state-on-hold / state-completed / state-archived,
// due-overdue / due-today / due-soon / due-later / due-done,
// type-runbook / type-note, project, tag.
// extraAttrs is attribute HTML the caller built, and escaped, itself.
export function chip(label, variant, extraAttrs = '') {
  return `<span class="chip chip--${escapeHtml(variant)}"${extraAttrs ? ` ${extraAttrs}` : ''}>${escapeHtml(label)}</span>`; // html-safe: extraAttrs is caller-built attribute HTML
}

// Priority dot class from an API priority value ('high'|'medium'|'low').
export function prioDotClass(apiPriorityValue) {
  return `prio-dot prio-dot--${escapeHtml(designPriority(apiPriorityValue))}`;
}
