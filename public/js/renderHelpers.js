import { designPriority } from './statusMap.js';

// Shared helpers for the Prax render modules. Every interpolated user value
// goes through escapeHtml — render modules never insert raw user content.
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Small pill chip. Variants map to prax.css chip modifiers:
// state-active / state-on-hold / state-completed / state-archived,
// due-overdue / due-today / due-soon / due-later / due-done,
// type-runbook / type-note, project, tag.
export function chip(label, variant, extraAttrs = '') {
  return `<span class="chip chip--${variant}"${extraAttrs ? ` ${extraAttrs}` : ''}>${escapeHtml(label)}</span>`;
}

// Priority dot class from an API priority value ('high'|'medium'|'low').
export function prioDotClass(apiPriorityValue) {
  return `prio-dot prio-dot--${designPriority(apiPriorityValue)}`;
}
