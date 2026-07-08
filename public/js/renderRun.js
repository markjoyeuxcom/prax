import { escapeHtml } from './renderHelpers.js';

// A bare checkmark (no surrounding box — the box is drawn by .run-step__box).
const CHECK = '<svg width="11" height="11" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8 L6.3 10.8 L11.5 4.5"/></svg>';

// HH:MM from an ISO timestamp — a deterministic slice, no locale conversion.
function hm(iso) {
  const m = String(iso || '').match(/T(\d{2}:\d{2})/);
  return m ? m[1] : '';
}

// Elapsed between two ISO timestamps as "Xm" / "Xh Ym"; '' if unparseable.
function elapsed(startIso, endIso) {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
  const mins = Math.round((end - start) / 60000);
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// A run's steps + timestamps rendered as a Markdown chronicle for copy/paste —
// the incident record. Independent of the source document.
export function buildChronicle(run, docTitle = '') {
  if (!run) return '';
  const lines = [`# Run: ${run.title || docTitle || 'Runbook'}`, '', `- Status: ${run.status}`, `- Started: ${run.startedAt}`];
  if (run.finishedAt) lines.push(`- Finished: ${run.finishedAt}`);
  lines.push('');
  for (const step of run.steps || []) {
    const stamp = step.checkedAt ? ` — ${step.checkedAt}` : '';
    lines.push(`- [${step.checkedAt ? 'x' : ' '}] ${step.text}${stamp}`);
  }
  return lines.join('\n');
}

export function renderRunHtml(state, run, { docTitle = '', now = new Date() } = {}) {
  if (!run) return '<div class="page"><p class="view-hint">Run not found.</p></div>';
  const steps = Array.isArray(run.steps) ? run.steps : [];
  const done = steps.filter((s) => s.checkedAt).length;
  const total = steps.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const running = run.status === 'running';
  const endIso = run.finishedAt || (now instanceof Date ? now.toISOString() : String(now));

  const stepRows = steps.map((step) => `
      <button type="button" class="run-step${step.checkedAt ? ' is-done' : ''}" data-action="toggle-run-step" data-step-id="${escapeHtml(step.id)}" data-checked="${step.checkedAt ? '1' : '0'}"${running ? '' : ' disabled'}>
        <span class="run-step__box">${step.checkedAt ? CHECK : ''}</span>
        <span class="run-step__text">${escapeHtml(step.text)}</span>
        <span class="run-step__time">${escapeHtml(hm(step.checkedAt))}</span>
      </button>`).join('');

  const footer = running
    ? `<button class="btn-primary" type="button" data-action="finish-run" data-run-id="${escapeHtml(run.id)}">Finish run</button>
        <button class="btn-outline btn-outline--danger" type="button" data-action="abort-run" data-run-id="${escapeHtml(run.id)}">Abort</button>`
    : `<span class="view-hint">Run ${escapeHtml(run.status)}${run.finishedAt ? ` at ${hm(run.finishedAt)}` : ''}.</span>`;

  return `<div class="page run">
      <header class="page-head">
        <button class="btn-ghost" type="button" data-action="back-from-run" title="Back to the runbook">← ${escapeHtml(docTitle || 'Runbook')}</button>
        <span class="chip chip--run-${escapeHtml(run.status)}">${escapeHtml(run.status)}</span>
        <span class="run-meta">Started ${escapeHtml(hm(run.startedAt))} · ${escapeHtml(elapsed(run.startedAt, endIso))}</span>
        <div class="run-actions"><button class="btn-ghost" type="button" data-action="copy-chronicle" data-run-id="${escapeHtml(run.id)}">Copy chronicle</button></div>
      </header>
      ${run.title ? `<p class="page-head__sub">${escapeHtml(run.title)}</p>` : ''}
      <div class="run-progress"><div class="run-progress__bar"><span style="width:${pct}%"></span></div><span class="run-progress__label">${done} of ${total} steps</span></div>
      <div class="run-steps">${total ? stepRows : '<p class="view-hint">This runbook has no checkbox steps — add <code>- [ ] step</code> lines to make it runnable.</p>'}</div>
      <div class="run-foot">${footer}</div>
    </div>`;
}
