// Ask Prax as a page (Console redesign, 2026-10): the question, a cited answer
// with numbered citations, the sources it was grounded in, and the questions
// asked before. Pure state → HTML over the existing /api/library/ask result
// (knowledgeToolsController owns the request; main.js owns history).
//
// Citations: the server contract has the model cite exact source titles in
// square brackets, validated against the sources it placed in context. The
// page numbers those sources 1..n and swaps each [Title] for its number, so a
// citation reads as a mark you can match to the rail, not a repeated title.

import { escapeHtml } from './html.js';
import { renderMarkdownHtml } from './markdownPreview.js';
import { icon } from './icons.js';

const CITE_OPEN = '⟦';
const CITE_CLOSE = '⟧';

function isAgentSource(source) {
  return source?.updatedBy === 'agent' || source?.kind === 'synthesized';
}

// Replace [Title] citations with numbered markers, then render untrusted and
// turn the markers into citation chips. Returns { html, cited: Set<number> }.
export function renderCitedAnswer(markdown, sources = [], { resolveWikiLink } = {}) {
  const numberByTitle = new Map(sources.map((source, index) => [String(source.title || '').trim().toLowerCase(), index + 1]));
  const cited = new Set();
  const marked = String(markdown || '').replace(/\[([^\]\n]{1,200})\](?!\()/g, (match, title) => {
    const number = numberByTitle.get(String(title).trim().toLowerCase());
    if (!number) return match;
    cited.add(number);
    return `${CITE_OPEN}${number}${CITE_CLOSE}`;
  });
  const rendered = renderMarkdownHtml(marked, { mode: 'untrusted', resolveWikiLink });
  const html = rendered.replace(new RegExp(`${CITE_OPEN}(\\d+)${CITE_CLOSE}`, 'g'), (match, digits) => {
    const source = sources[Number(digits) - 1];
    if (!source) return '';
    const trust = source.verified ? 'verified' : 'unverified';
    return `<span class="cite cite--${trust}" title="${escapeHtml(source.title)} (${trust})">${escapeHtml(digits)}</span>`;
  });
  return { html, cited };
}

function shortWhen(iso, now = new Date()) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function renderHistory(state) {
  const history = Array.isArray(state.askHistory) ? state.askHistory : [];
  const current = String(state.askPraxResult?.query || '').trim();
  const rows = history.length
    ? history.map((entry, index) => {
      const active = entry.query === current;
      return `<li><button type="button" class="ask-hist__item${active ? ' is-current' : ''}" data-action="ask-history-open" data-index="${escapeHtml(index)}"${active ? ' aria-current="true"' : ''}>`
        + `<span class="ask-hist__q">${escapeHtml(entry.query)}</span>`
        + `<span class="ask-hist__when">${escapeHtml(shortWhen(entry.at))}</span></button></li>`;
    }).join('')
    : '<li class="ask-hist__empty">Questions you ask stay here on this device.</li>';
  return '<nav class="ask-hist" aria-label="Earlier questions">'
    + '<button type="button" class="btn-ghost ask-hist__new" data-action="ask-new">＋ New question</button>'
    + `<ul class="ask-hist__list">${rows}</ul>`
    + '<p class="ask-hist__note">Answers come from your library only.</p>'
    + '<button type="button" class="btn-ghost ask-hist__assistant" data-action="open-assistant" title="The assistant can change tasks and documents (⌘I)">Use the assistant</button>'
    + '</nav>';
}

function renderSourcesRail(sources, cited) {
  if (!sources.length) return '<aside class="ask-sources" aria-label="Sources"><h2 class="rq-label">Sources</h2><p class="rq-note rq-note--quiet">Sources appear here with each answer.</p></aside>';
  const cards = sources.map((source, index) => {
    const number = index + 1;
    const trust = source.verified ? '✓ verified' : `◌ unverified${isAgentSource(source) ? ' · agent' : ''}`;
    const label = [source.title || 'Untitled', source.documentType || 'note', ...(source.stale ? ['stale'] : []), source.verified ? 'verified' : 'unverified'].join(', ');
    return `<li><button type="button" class="ask-src${source.verified ? '' : ' ask-src--agent'}${cited.has(number) ? ' is-cited' : ''}" data-action="open-ask-source" data-document-id="${escapeHtml(source.id || '')}" aria-label="Open ${escapeHtml(label)}">`
      + `<span class="ask-src__head"><span class="ask-src__n">${escapeHtml(number)}</span><span class="ask-src__title">${escapeHtml(source.title || 'Untitled')}</span></span>`
      + `<span class="ask-src__trust">${escapeHtml(trust)} · ${escapeHtml(source.documentType || 'note')}${source.stale ? ' · stale' : ''}</span>`
      + '</button></li>';
  }).join('');
  const uncited = sources.length - cited.size;
  return '<aside class="ask-sources" aria-label="Sources">'
    + '<h2 class="rq-label">Sources</h2>'
    + `<ol class="ask-sources__list">${cards}</ol>`
    + (cited.size && uncited > 0 ? `<p class="rq-note rq-note--quiet">${escapeHtml(uncited)} searched, not cited.</p>` : '')
    + '</aside>';
}

const DEGRADED = {
  'generation-failed': 'The AI model failed to answer, so here are the relevant sources instead. Check the model and API key in Settings ▸ Intelligence.',
  'citation-validation-failed': 'The generated answer did not cite its sources correctly, so Prax withheld it and is showing the sources instead.',
  'no-chat-model': 'No AI model is set, so here are the most relevant sources. Configure one in Settings ▸ Intelligence for a written answer.',
  'no-sources': 'Nothing in your library matches this question, so there is nothing to answer from. Try other words, widen the scope, or write the document it needs.',
};

function isoToday(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function dueLabel(dueDate, today) {
  if (!dueDate) return '';
  if (dueDate === today) return 'today';
  const [y, m, d] = today.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  if (dueDate === tomorrow) return 'tomorrow';
  const date = new Date(`${dueDate}T00:00:00`);
  return Number.isNaN(date.getTime()) ? dueDate : date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Suggested tasks (proposals only) and the answer's actions, as one card.
function renderSuggestions(state, { written, projects, today }) {
  const suggest = state.askSuggest;
  const scope = String(state.askScope || 'all');
  const project = projects.find((item) => item.id === scope);
  const where = project ? project.name : 'Inbox';
  const canSuggest = written && Boolean(state.chatStatus?.available);
  const tasks = suggest && !suggest.loading ? suggest.tasks : [];
  const chosen = tasks.filter((_, index) => suggest.checked[index]).length;
  const created = suggest?.created;
  let body = '';
  if (suggest?.loading) {
    body = '<p class="ask-tasks__status" role="status">Suggesting follow-up tasks from the sources…</p>';
  } else if (tasks.length) {
    body = '<ul class="ask-tasks__list">' + tasks.map((task, index) => {
      const on = Boolean(suggest.checked[index]);
      const due = dueLabel(task.dueDate, today);
      const hot = task.priority === 'high' && due === 'today';
      return `<li><button type="button" class="ask-task${on ? ' is-on' : ''}" role="checkbox" aria-checked="${on ? 'true' : 'false'}" data-action="ask-task-toggle" data-index="${escapeHtml(index)}"${created != null ? ' disabled' : ''}>`
        + `<span class="ask-task__box" aria-hidden="true"></span><span class="ask-task__title">${escapeHtml(task.title)}</span>`
        + `<span class="ask-task__meta${hot ? ' is-hot' : ''}">${escapeHtml([task.priority, due].filter(Boolean).join(' · '))}</span>`
        + `<span class="ask-task__src">from ${escapeHtml(task.sourceTitle)}</span></button></li>`;
    }).join('') + '</ul>';
  } else if (suggest?.error) {
    body = `<p class="ask-tasks__status">${escapeHtml(suggest.error)}</p>`;
  } else if (suggest && !suggest.loading) {
    body = '<p class="ask-tasks__status">Nothing in this answer calls for a task.</p>';
  }
  const primary = tasks.length && created == null
    ? `<button type="button" class="btn-primary ask-tasks__create" data-action="ask-create-tasks"${chosen && !suggest.creating ? '' : ' disabled'}>${suggest.creating ? 'Creating…' : `Create ${escapeHtml(chosen)} task${chosen === 1 ? '' : 's'}`}</button>`
    : (created != null ? `<span class="ask-tasks__done" role="status">✓ Created ${escapeHtml(created)} task${created === 1 ? '' : 's'} in ${escapeHtml(where)}</span>` : '');
  const actions = '<div class="ask-actions">'
    + primary
    + (written ? '<button type="button" class="btn-ghost" data-action="save-ask-note">Save answer as note</button>' : '')
    + '<button type="button" class="btn-ghost" data-action="copy-ask-prax">Copy with citations</button>'
    + (canSuggest && !suggest ? '<button type="button" class="btn-ghost" data-action="ask-suggest-tasks">Suggest tasks</button>' : '')
    + '</div>';
  if (!suggest) return actions;
  return `<section class="ask-tasks" aria-label="Suggested tasks"><h2 class="rq-label">Suggested tasks · ${escapeHtml(where)}</h2>${body}${actions}</section>`; // html-safe: body and actions are built from escaped values
}

export function renderAskPageHtml(state, { resolveWikiLink, projects = [], today = isoToday() } = {}) {
  const r = state.askPraxResult;
  const sources = Array.isArray(r?.sources) ? r.sources : [];
  let thread = '';
  let cited = new Set();
  if (state.askPraxLoading) {
    thread = `<div class="ask-q">${escapeHtml(state.askPraxQuery || '')}</div>`
      + '<p class="ask-status" role="status">Reading the most relevant documents and writing an answer…</p>';
  } else if (state.askPraxError) {
    thread = `<div class="ask-q">${escapeHtml(state.askPraxQuery || '')}</div>`
      + '<p class="ask-status ask-status--error" role="status">Could not get an answer. Check the AI model in Settings ▸ Intelligence, or try again.</p>';
  } else if (r) {
    const written = !r.degraded && typeof r.answer === 'string' && r.answer.trim();
    const answer = renderCitedAnswer(written ? r.answer : (r.markdown || ''), written ? sources : [], { resolveWikiLink });
    cited = answer.cited;
    const mode = r.retrieval?.mode === 'semantic' ? 'searched by meaning' : 'keyword search';
    const meta = [`${sources.length} source${sources.length === 1 ? '' : 's'}`, mode, ...(cited.size ? [`${cited.size} cited`] : []), ...(r.retrieval?.trust === 'verified' ? ['verified only'] : []), r.model || (written ? '' : 'no model')]
      .filter(Boolean).map((part) => `<span>${escapeHtml(part)}</span>`).join('<span aria-hidden="true">·</span>');
    const unverifiedCited = sources.filter((source, index) => cited.has(index + 1) && !source.verified);
    const warning = unverifiedCited.length
      ? `<div class="ask-warn" role="note"><span aria-hidden="true">◌</span><span>${unverifiedCited.length === 1 ? `“${escapeHtml(unverifiedCited[0].title)}” is` : `${escapeHtml(unverifiedCited.length)} cited sources are`} unverified memory nobody has checked yet. Check before you act. ${unverifiedCited.length === 1 ? `<button type="button" class="ask-warn__link" data-action="ask-review-source" data-document-id="${escapeHtml(unverifiedCited[0].id || '')}">Review it now</button>` : '<button type="button" class="ask-warn__link" data-action="nav-review">Open the review queue</button>'}</span></div>`
      : '';
    const notice = r.degraded ? `<div class="ask-notice">${escapeHtml(DEGRADED[r.reason] || DEGRADED['no-chat-model'])}</div>` : '';
    thread = `<div class="ask-q">${escapeHtml(r.query || state.askPraxQuery || '')}</div>`
      + `<div class="ask-meta"><span class="ask-meta__who">${icon('spark', 12)}prax</span>${meta}</div>`
      + notice
      + `<div class="ask-answer prose">${answer.html}</div>` // html-safe: renderCitedAnswer renders untrusted markdown and escapes chips
      + warning
      + renderSuggestions(state, { written: Boolean(written), projects, today });
  } else {
    thread = '<div class="ask-intro">'
      + `<span class="ask-intro__icon">${icon('spark', 20)}</span>`
      + '<h1 class="ask-intro__title">Ask Prax</h1>'
      + '<p class="ask-intro__sub">Ask about a system, an incident or a runbook. Prax answers from your library, cites what it used, and says when a source is unverified.</p>'
      + '</div>';
  }

  const scope = String(state.askScope || 'all');
  const scopeProject = projects.find((project) => project.id === scope);
  const verifiedOnly = state.askTrust === 'verified';
  const chat = state.chatStatus || {};
  const modelLabel = chat.available ? [chat.backend, chat.model].filter(Boolean).join(' · ') || 'AI model' : 'No AI model';
  const scopeOptions = [['all', 'All projects'], ...projects.map((project) => [project.id, project.name])]
    .map(([value, label]) => `<option value="${escapeHtml(value)}"${value === scope ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
  const composer = '<div class="ask-composer">'
    + '<label class="visually-hidden" for="ask-page-input">Question for Prax</label>'
    // A textarea: Enter asks, Shift+Enter is a new line. Its own draft
    // (askDraft), so asking clears it while the thread keeps the question.
    + `<textarea id="ask-page-input" class="ask-composer__input" data-ask-page-input rows="${escapeHtml(Math.min(8, String(state.askDraft || '').split('\n').length))}" placeholder="${r ? 'Ask a follow-up…' : 'Ask Prax about your library…'}" autocomplete="off" spellcheck="false">${escapeHtml(state.askDraft || '')}</textarea>`
    + '<div class="ask-composer__row">'
    + `<label class="ask-chip ask-chip--scope"><span class="ask-chip__dot" style="background:${escapeHtml(scopeProject?.color || 'var(--ink3)')}" aria-hidden="true"></span><span class="visually-hidden">Scope</span><select data-ask-scope aria-label="Scope">${scopeOptions}</select></label>`
    + `<button type="button" class="ask-chip" data-action="toggle-ask-trust" aria-pressed="${verifiedOnly ? 'true' : 'false'}" title="Which memory an answer may draw on">${verifiedOnly ? '✓ Verified only' : 'Verified + unverified'}</button>`
    + `<button type="button" class="ask-chip ask-chip--model" data-action="open-ai-settings" title="The model that writes answers. Change it in Settings ▸ Intelligence">${escapeHtml(modelLabel)}</button>`
    + '<span class="ask-composer__gap"></span>'
    + '<span class="ask-composer__hint">⇧↵ new line</span>'
    + `<button type="button" class="btn-primary ask-composer__go" data-action="run-ask-prax"${String(state.askDraft || '').trim() ? '' : ' disabled'}>Ask<span class="kbd">↵</span></button>`
    + '</div></div>';

  return '<div class="ask-page">'
    + renderHistory(state)
    + `<section class="ask-thread" aria-label="Answer" aria-busy="${Boolean(state.askPraxLoading)}">`
    + '<button type="button" class="btn-icon ask-close" data-action="close-ask-page" aria-label="Close Ask Prax" title="Close (Esc)">×</button>'
    + `<div class="ask-thread__scroll">${thread}</div>${composer}</section>` // html-safe: thread and composer are built from escaped values and renderCitedAnswer
    + renderSourcesRail(sources, cited)
    + '</div>';
}
