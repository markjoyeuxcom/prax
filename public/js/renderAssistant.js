import { escapeHtml } from './renderHelpers.js';
import { icon } from './icons.js';

// The built-in AI assistant panel — an agentic, multi-turn chat over the whole
// Prax tool tree. Reads run automatically; writes surface a confirmation card.
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

function renderConfirm(pending) {
  const n = pending.length;
  const rows = pending.map((p) => `<li><span class="asst__confirm-sum">${escapeHtml(p.summary || p.name)}</span> <code>${escapeHtml(p.name)}</code></li>`).join('');
  return `<div class="asst__turn asst__turn--ai">
    <div class="asst__confirm">
      <div class="asst__confirm-head">${icon('spark')} Prax wants to make ${n} change${n === 1 ? '' : 's'} — approve to run:</div>
      <ul class="asst__confirm-list">${rows}</ul>
      <div class="asst__confirm-actions">
        <button type="button" class="btn-primary btn-primary--sm" data-action="assistant-approve">Approve &amp; run</button>
        <button type="button" class="btn-ghost btn-ghost--sm" data-action="assistant-decline">Decline</button>
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
  if (noModel) {
    body = '<div class="asst__notice">No AI model is configured. Set one in <strong>Settings ▸ Intelligence ▸ AI answers</strong> to use the assistant.</div>';
  } else if (!items.length && !state.assistantLoading) {
    body = renderEmpty();
  } else {
    body = items.map((it) => renderItem(it, renderMarkdown)).join('');
    if (state.assistantPending && state.assistantPending.length) body += renderConfirm(state.assistantPending);
    if (state.assistantLoading) {
      body += '<div class="asst__turn asst__turn--ai"><div class="asst__thinking"><span></span><span></span><span></span></div></div>';
    }
  }
  if (state.assistantError) {
    body += `<div class="asst__notice asst__notice--error">${escapeHtml(state.assistantError)}</div>`;
  }

  const busy = state.assistantLoading || Boolean(state.assistantPending && state.assistantPending.length);
  const composerDisabled = noModel || busy;
  const modelNote = status && status.available
    ? `${escapeHtml(status.model || 'model')} · ${status.toolCount} tools${status.supportsTools ? '' : ' · no tool-calling'}`
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
