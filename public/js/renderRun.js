import { escapeHtml } from './html.js';
import { localTimeOf } from './dateHelpers.js';

// A bare checkmark (no surrounding box — the box is drawn by .run-step__box).
const CHECK = '<svg width="11" height="11" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8 L6.3 10.8 L11.5 4.5"/></svg>';

// HH:MM in the viewer's local time from an ISO (UTC) timestamp.
const hm = localTimeOf;

// Elapsed between two ISO timestamps as "Xm" / "Xh Ym"; '' if unparseable.
function elapsed(startIso, endIso) {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
  const mins = Math.round((end - start) / 60000);
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function eventLabel(event) {
  switch (event?.type) {
    case 'started': return 'Run started';
    case 'step-checked': return `Checked “${event.stepText || 'step'}”`;
    case 'step-unchecked': return `Unchecked “${event.stepText || 'step'}”`;
    case 'aborted': return 'Run aborted';
    case 'resumed': return 'Run resumed';
    case 'completed': return 'Run completed';
    default: return String(event?.type || 'Run event');
  }
}

function actorLabel(actor) {
  return actor && actor !== 'unknown' ? `by ${actor}` : 'actor unavailable';
}

// A run's steps + timestamps rendered as a Markdown chronicle for copy/paste —
// the incident record. Independent of the source document.
export function buildChronicle(run, docTitle = '') {
  if (!run) return '';
  const sourceTitle = run.documentTitle || docTitle || 'Runbook';
  const lines = [
    `# Run: ${run.title || sourceTitle}`,
    '',
    `- Runbook: ${sourceTitle}`,
    `- Status: ${run.status}`,
    `- Started: ${run.startedAt} (${actorLabel(run.startedBy)})`,
  ];
  if (run.finishedAt) lines.push(`- Finished: ${run.finishedAt} (${actorLabel(run.finishedBy)})`);
  lines.push('', '## Current steps', '');
  for (const step of run.steps || []) {
    const stamp = step.checkedAt ? ` — ${step.checkedAt} (${actorLabel(step.checkedBy)})` : '';
    lines.push(`- [${step.checkedAt ? 'x' : ' '}] ${step.text}${stamp}`);
  }
  lines.push('', '## Chronicle', '');
  for (const event of run.events || []) {
    lines.push(`- ${event.createdAt} — ${eventLabel(event)} (${actorLabel(event.actor)})`);
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
  const aborted = run.status === 'aborted';
  const pending = Boolean(state.runMutationPending);
  const endIso = run.finishedAt || (now instanceof Date ? now.toISOString() : String(now));

  const stepRows = steps.map((step) => `
      <button type="button" class="run-step${step.checkedAt ? ' is-done' : ''}" data-action="toggle-run-step" data-step-id="${escapeHtml(step.id)}" data-checked="${step.checkedAt ? '1' : '0'}"${running && !pending ? '' : ' disabled'}>
        <span class="run-step__box">${step.checkedAt ? CHECK : ''}</span>
        <span class="run-step__text">${escapeHtml(step.text)}</span>
        <span class="run-step__time">${step.checkedAt ? `${escapeHtml(hm(step.checkedAt))}${step.checkedBy ? ` · ${escapeHtml(step.checkedBy)}` : ''}` : ''}</span>
      </button>`).join('');

  let footer;
  if (running) {
    footer = `<button class="btn-primary" type="button" data-action="finish-run" data-run-id="${escapeHtml(run.id)}"${pending ? ' disabled' : ''}>${pending ? 'Saving…' : 'Finish run'}</button>
        <button class="btn-outline btn-outline--danger" type="button" data-action="abort-run" data-run-id="${escapeHtml(run.id)}"${pending ? ' disabled' : ''}>Abort</button>`;
  } else if (aborted) {
    footer = `<button class="btn-primary" type="button" data-action="resume-run" data-run-id="${escapeHtml(run.id)}"${pending ? ' disabled' : ''}>${pending ? 'Saving…' : 'Resume run'}</button>
      <span class="view-hint">Run aborted${run.finishedAt ? ` at ${escapeHtml(hm(run.finishedAt))}` : ''}${run.finishedBy ? ` by ${escapeHtml(run.finishedBy)}` : ''}.</span>`;
  } else {
    footer = `<span class="view-hint">Run completed${run.finishedAt ? ` at ${escapeHtml(hm(run.finishedAt))}` : ''}${run.finishedBy ? ` by ${escapeHtml(run.finishedBy)}` : ''}.</span>`;
  }

  const events = Array.isArray(run.events) ? run.events : [];
  const eventRows = events.map((event) => `
        <li class="run-event">
          <time datetime="${escapeHtml(event.createdAt || '')}">${escapeHtml(hm(event.createdAt))}</time>
          <span class="run-event__label">${escapeHtml(eventLabel(event))}</span>
          <span class="run-event__actor">${escapeHtml(actorLabel(event.actor))}</span>
        </li>`).join('');

  return `<div class="page run"${pending ? ' aria-busy="true"' : ''}>
      <header class="page-head">
        <button class="btn-ghost" type="button" data-action="back-from-run" title="Back to the runbook"${pending ? ' disabled' : ''}>← ${escapeHtml(run.documentTitle || docTitle || 'Runbook')}</button>
        <span class="chip chip--run-${escapeHtml(run.status)}">${escapeHtml(run.status)}</span>
        <span class="run-meta">Started ${escapeHtml(hm(run.startedAt))}${run.startedBy ? ` by ${escapeHtml(run.startedBy)}` : ''} · ${escapeHtml(elapsed(run.startedAt, endIso))}</span>
        <div class="run-actions">
          ${running ? '' : `<button class="btn-ghost" type="button" data-action="generate-post-mortem" data-run-id="${escapeHtml(run.id)}"${state.postMortemLoading || pending ? ' disabled' : ''}>${state.postMortemLoading ? 'Generating…' : '✦ Post-mortem'}</button>`}
          <button class="btn-ghost" type="button" data-action="copy-chronicle" data-run-id="${escapeHtml(run.id)}">Copy chronicle</button>
        </div>
      </header>
      ${run.title ? `<p class="page-head__sub">${escapeHtml(run.title)}</p>` : ''}
      <div class="run-progress"><div class="run-progress__bar"><span style="width:${pct}%"></span></div><span class="run-progress__label">${done} of ${total} steps</span></div>
      <div class="run-steps">${total ? stepRows : '<p class="view-hint">This runbook has no checkbox steps — add <code>- [ ] step</code> lines to make it runnable.</p>'}</div>
      <div class="run-foot">${footer}</div>
      <section class="run-chronicle" aria-labelledby="run-chronicle-title">
        <div class="run-chronicle__head">
          <h2 id="run-chronicle-title">Chronicle</h2>
          <span>${events.length} event${events.length === 1 ? '' : 's'}</span>
        </div>
        ${events.length ? `<ol class="run-events">${eventRows}</ol>` : '<p class="view-hint">No chronological events were recorded.</p>'}
      </section>
    </div>`;
}
