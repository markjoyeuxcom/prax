import { escapeHtml } from './renderHelpers.js';
import { icon } from './icons.js';

// The built-in AI assistant panel — an agentic, multi-turn chat over the whole
// Prax tool tree. Reads run automatically; writes surface a confirmation card
// that names each target by title and shows every field the write sets
// (before → after, with a line diff for bodies); several writes are approved
// or declined one by one.
// Pure state->HTML; the caller passes `renderMarkdown` (closing over the app's
// wiki-link resolver) to render assistant answers. The composer value is mirrored
// in state.assistantInput so it survives re-renders.

const SUGGESTIONS = [
  "What's overdue across my projects?",
  'Which library docs need review?',
  'Draft a runbook for a Postgres failover',
];

// Collapse a tool-call's arguments to a short inline preview.
function compactArgs(input) {
  if (!input || typeof input !== 'object' || Object.keys(input).length === 0) return '';
  const s = JSON.stringify(input);
  return s.length > 72 ? `${s.slice(0, 71)}…` : s;
}

// Walk the canonical conversation into render-ready display items, pairing each
// assistant tool-call turn with the tool-result turn that answers it. Pure and
// exported so the pairing logic is unit-testable.
export function assistantDisplayItems(messages) {
  const items = [];
  const list = Array.isArray(messages) ? messages : [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (!m) continue;
    if (m.role === 'user' && typeof m.content === 'string') {
      items.push({ kind: 'user', text: m.content });
    } else if (m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length) {
      if (typeof m.content === 'string' && m.content.trim()) items.push({ kind: 'ai', text: m.content });
      const next = list[i + 1];
      const results = next && next.role === 'tool' && Array.isArray(next.results) ? next.results : [];
      const byId = new Map(results.map((r) => [r.id, r]));
      items.push({
        kind: 'tools',
        calls: m.toolCalls.map((c) => ({ name: c.name, args: compactArgs(c.input), result: byId.get(c.id) || null })),
      });
    } else if (m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) {
      items.push({ kind: 'ai', text: m.content });
    }
    // Standalone tool-result turns are consumed by the preceding tool-call turn.
  }
  return items;
}

function toolStatus(result) {
  if (!result) return { cls: 'is-pending', label: 'pending' };
  if (result.isError) return { cls: 'is-error', label: 'error' };
  if (/declined to run/i.test(result.content || '')) return { cls: 'is-declined', label: 'skipped' };
  return { cls: 'is-ok', label: 'done' };
}

function renderTools(calls) {
  const rows = calls.map((c) => {
    const st = toolStatus(c.result);
    const preview = c.result ? String(c.result.content || '').replace(/\s+/g, ' ').slice(0, 100) : '';
    return `<div class="asst__tool">
      <span class="asst__tool-dot ${st.cls}"></span>
      <span class="asst__tool-name">${escapeHtml(c.name)}</span>
      ${c.args ? `<code class="asst__tool-args">${escapeHtml(c.args)}</code>` : ''}
      <span class="asst__tool-badge ${st.cls}">${st.label}</span>
      ${preview ? `<span class="asst__tool-preview" title="${escapeHtml(String(c.result.content || '').slice(0, 800))}">${escapeHtml(preview)}</span>` : ''}
    </div>`;
  }).join('');
  return `<div class="asst__turn asst__turn--tools"><div class="asst__tools">${rows}</div></div>`;
}

function renderItem(item, renderMarkdown) {
  if (item.kind === 'user') {
    return `<div class="asst__turn asst__turn--user"><div class="asst__bubble">${escapeHtml(item.text)}</div></div>`;
  }
  if (item.kind === 'ai') {
    return `<div class="asst__turn asst__turn--ai"><div class="asst__bubble prose">${renderMarkdown(item.text)}</div></div>`;
  }
  return renderTools(item.calls);
}

// Line-level difference between a document's current body and a proposed
// one: the unchanged leading/trailing lines are counted, and every line in
// between is listed as removed or added. Conservative (one hunk) but exact:
// nothing that changes is hidden. Exported for tests.
export function lineDiff(before, after) {
  const a = String(before ?? '').split('\n');
  const b = String(after ?? '').split('\n');
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix
    && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  return {
    prefix,
    removed: a.slice(prefix, a.length - suffix),
    added: b.slice(prefix, b.length - suffix),
    suffix,
  };
}

function unchangedLines(n) {
  return n ? `<div class="asst__diff-ctx">${n} unchanged line${n === 1 ? '' : 's'}</div>` : '';
}

function renderBody(change) {
  if (change.before === undefined) {
    return `<pre class="asst__diff">${escapeHtml(change.after ?? '')}</pre>`;
  }
  if (change.unchanged) return '<span class="asst__confirm-muted">unchanged</span>';
  const d = lineDiff(change.before ?? '', change.after ?? '');
  const removed = d.removed.map((line) => `<del class="asst__diff-del">${escapeHtml(line) || ' '}</del>`).join('');
  const added = d.added.map((line) => `<ins class="asst__diff-add">${escapeHtml(line) || ' '}</ins>`).join('');
  return `<div class="asst__diff" role="group" aria-label="Body changes">${unchangedLines(d.prefix)}${removed}${added}${unchangedLines(d.suffix)}</div>`;
}

function valueHtml(value) {
  return value === null || value === undefined
    ? '<span class="asst__confirm-muted">(empty)</span>'
    : escapeHtml(value);
}

function renderChange(change) {
  const label = escapeHtml(change.label || change.field);
  if (change.format === 'body') {
    return `<div class="asst__change asst__change--body"><span class="asst__change-label">${label}</span>${renderBody(change)}</div>`;
  }
  let value;
  if (change.before === undefined) {
    value = `${valueHtml(change.after)}${change.defaulted ? ' <span class="asst__confirm-muted">(default)</span>' : ''}`;
  } else if (change.unchanged) {
    value = `${valueHtml(change.after)} <span class="asst__confirm-muted">(unchanged)</span>`;
  } else {
    value = `<del class="asst__change-before">${valueHtml(change.before)}</del> <span aria-hidden="true">→</span> <ins class="asst__change-after">${valueHtml(change.after)}</ins>`;
  }
  return `<div class="asst__change"><span class="asst__change-label">${label}</span><span class="asst__change-value">${value}</span></div>`;
}

function renderTarget(target) {
  const name = target.title
    ? `“${escapeHtml(target.title)}”`
    : `<code>${escapeHtml(target.id || '')}</code>`;
  const state = target.missing
    ? ' <span class="asst__confirm-warn">not found</span>'
    : (target.detail ? ` <span class="asst__confirm-muted">${escapeHtml(target.detail)}</span>` : '');
  return `<div class="asst__change"><span class="asst__change-label">${escapeHtml(target.role || 'Target')}</span><span class="asst__change-value">${name}${state}</span></div>`;
}

// Record one call's decision on the pending list (pure; the caller stores it).
export function withCallDecision(pending, id, decision) {
  if (!Array.isArray(pending) || (decision !== 'approve' && decision !== 'deny')) return pending;
  return pending.map((p) => (p.id === id ? { ...p, decision } : p));
}

// The decisions map sent to the server. 'deny' declines every call. With one
// call, approving means approving that call. With several, each call carries
// its own recorded decision, and nothing is sent until every call has one —
// one click never approves a batch the person has not looked at call by call.
export function assistantDecisions(pending, action) {
  const list = Array.isArray(pending) ? pending : [];
  if (!list.length) return null;
  if (action === 'deny') return Object.fromEntries(list.map((p) => [p.id, 'deny']));
  if (list.length === 1) return { [list[0].id]: list[0].decision === 'deny' ? 'deny' : 'approve' };
  if (!list.every((p) => p.decision === 'approve' || p.decision === 'deny')) return null;
  return Object.fromEntries(list.map((p) => [p.id, p.decision]));
}

function renderPendingCall(p, { multi, locked }) {
  const changes = Array.isArray(p.changes) ? p.changes : [];
  const targets = Array.isArray(p.targets) ? p.targets : [];
  const notes = Array.isArray(p.notes) ? p.notes : [];
  const choice = (decision, text) => `<button type="button" class="btn-ghost btn-ghost--sm${p.decision === decision ? ' is-selected' : ''}" data-action="assistant-call-decision" data-call-id="${escapeHtml(p.id)}" data-decision="${decision}" aria-pressed="${p.decision === decision}" ${locked ? 'disabled' : ''}>${text}</button>`;
  const decide = multi
    ? `<div class="asst__confirm-decide" role="group" aria-label="Decision for ${escapeHtml(p.summary || p.name)}">${choice('approve', 'Approve')}${choice('deny', 'Decline')}</div>`
    : '';
  const details = [...targets.map(renderTarget), ...changes.map(renderChange)].join('');
  return `<li class="asst__confirm-item" data-call-id="${escapeHtml(p.id)}">
      <div class="asst__confirm-row"><span class="asst__confirm-sum">${escapeHtml(p.summary || p.name)}</span> <code>${escapeHtml(p.name)}</code></div>
      ${details ? `<div class="asst__changes">${details}</div>` : ''}
      ${notes.length ? `<ul class="asst__confirm-notes">${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : ''}
      ${decide}
    </li>`;
}

function renderConfirm(pending, attempted = false, loading = false) {
  const n = pending.length;
  const multi = n > 1;
  const rows = pending.map((p) => renderPendingCall(p, { multi, locked: loading || attempted })).join('');
  const ready = Boolean(assistantDecisions(pending, 'approve'));
  const approved = pending.filter((p) => p.decision === 'approve').length;
  const primary = attempted
    ? 'Retry safely'
    : (multi ? `Submit decisions${ready ? ` (${approved} of ${n} approved)` : ''}` : 'Approve &amp; run');
  const head = multi
    ? `Prax wants to make ${n} changes — approve or decline each one:`
    : 'Prax wants to make 1 change — review it, then approve to run:';
  return `<div class="asst__turn asst__turn--ai">
    <div class="asst__confirm">
      <div class="asst__confirm-head">${icon('spark')} ${head}</div>
      <ul class="asst__confirm-list">${rows}</ul>
      <div class="asst__confirm-actions">
        <button type="button" class="btn-primary btn-primary--sm" data-action="assistant-approve" ${loading || (!attempted && !ready) ? 'disabled' : ''}>${primary}</button>
        ${!attempted ? `<button type="button" class="btn-ghost btn-ghost--sm" data-action="assistant-decline" ${loading ? 'disabled' : ''}>${multi ? 'Decline all' : 'Decline'}</button>` : ''}
      </div>
    </div>
  </div>`;
}

function renderEmpty() {
  const chips = SUGGESTIONS.map((s) => `<button type="button" class="asst__chip" data-action="assistant-suggest" data-suggest="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('');
  return `<div class="asst__empty">
    <div class="asst__empty-icon">${icon('chat', 20)}</div>
    <div class="asst__empty-title">Ask Prax to do things</div>
    <div class="asst__empty-sub">It searches your tasks and library, drafts runbooks, and makes changes — you approve anything that writes.</div>
    <div class="asst__suggest">${chips}</div>
  </div>`;
}

export function renderAssistantHtml(state, { renderMarkdown = (s) => escapeHtml(s) } = {}) {
  const status = state.assistantStatus;
  const items = assistantDisplayItems(state.assistantMessages);
  const noModel = status && !status.available;

  let body;
  if (noModel && !state.assistantPending?.length) {
    body = '<div class="asst__notice">No AI model is configured. Set one in <strong>Settings ▸ Intelligence ▸ AI answers</strong> to use the assistant.</div>';
  } else if (!items.length && !state.assistantLoading) {
    body = renderEmpty();
  } else {
    body = items.map((it) => renderItem(it, renderMarkdown)).join('');
    if (state.assistantPending && state.assistantPending.length) body += renderConfirm(state.assistantPending, state.assistantApprovalAttempted, state.assistantLoading);
    if (state.assistantLoading) {
      body += '<div class="asst__turn asst__turn--ai"><div class="asst__thinking"><span></span><span></span><span></span></div></div>';
    }
  }
  if (state.assistantError) {
    const partial = state.assistantErrorKind === 'partial';
    const kind = partial ? 'partial' : 'error';
    const role = partial ? 'status' : 'alert';
    body += `<div class="asst__notice asst__notice--${kind}" role="${role}" data-assistant-outcome="${kind}">${escapeHtml(state.assistantError)}</div>`;
  }

  const busy = state.assistantLoading || Boolean(state.assistantPending && state.assistantPending.length);
  const composerDisabled = noModel || busy;
  const modelNote = status && status.available
    ? (status.supportsTools
      ? `${escapeHtml(status.model || 'model')} · ${status.toolCount} tools`
      : `${escapeHtml(status.model || 'model')} · read-only · answers from a live snapshot`)
    : '';

  return `
    <div class="overlay-scrim asst-scrim" data-overlay="assistant" data-action="close-assistant">
      <aside class="asst" role="dialog" aria-label="Prax assistant">
        <header class="asst__head">
          <div class="asst__title">${icon('chat', 14)}<span>Assistant</span>${modelNote ? `<span class="asst__model">${modelNote}</span>` : ''}</div>
          <div class="asst__head-actions">
            ${items.length ? '<button type="button" class="btn-ghost btn-ghost--sm" data-action="assistant-clear">New chat</button>' : ''}
            <button type="button" class="btn-icon" data-action="close-assistant" title="Close (Esc)">✕</button>
          </div>
        </header>
        <div class="asst__scroll" data-assistant-scroll>${body}</div>
        <div class="asst__composer">
          <textarea class="asst__input" data-assistant-input rows="1" placeholder="Ask Prax to find, draft, or change something…" autocomplete="off" ${composerDisabled ? 'disabled' : ''}>${escapeHtml(state.assistantInput || '')}</textarea>
          <button type="button" class="btn-primary btn-primary--sm asst__send" data-action="assistant-send" ${composerDisabled ? 'disabled' : ''}>Send</button>
        </div>
        <div class="asst__foot"><span class="asst__hint-k"><span class="kbd">↵</span> send · <span class="kbd">⇧↵</span> newline · <span class="kbd">Esc</span> close</span></div>
      </aside>
    </div>`;
}
