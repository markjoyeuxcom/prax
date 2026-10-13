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
import { incompleteIndexNotice } from './retrievalStatus.js';

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
    // A button, not a hover-only span: keyboard and touch reach the source too.
    return `<button type="button" class="cite cite--${trust}" data-action="ask-cite" data-source="${escapeHtml(digits)}" aria-label="Source ${escapeHtml(digits)}: ${escapeHtml(source.title)} (${trust})" title="${escapeHtml(source.title)} (${trust})">${escapeHtml(digits)}</button>`;
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

// How many earlier questions show before "Show all": a glance back, not an
// archive. Asking again is one keypress; a long scroll is not.
export const ASK_HISTORY_RECENT = 6;

function dayGroup(iso, now) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return 'Earlier';
  const day = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  if (day(date) === day(now)) return 'Today';
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (day(date) === day(yesterday)) return 'Yesterday';
  return 'Earlier';
}

function renderHistory(state, projects = [], now = new Date()) {
  const history = Array.isArray(state.askHistory) ? state.askHistory : [];
  const current = String(state.askPraxResult?.query || '').trim();
  const currentScope = String(state.askPraxResult?.scope || 'all');
  const open = state.askHistoryOpen !== false;
  const showAll = Boolean(state.askHistoryShowAll);
  const shown = showAll ? history : history.slice(0, ASK_HISTORY_RECENT);
  let lastGroup = null;
  const rows = shown.map((entry, index) => {
    const active = entry.query === current && String(entry.scope || 'all') === currentScope;
    const scope = entry.scope && entry.scope !== 'all' ? (projects.find((p) => p.id === entry.scope)?.name || null) : null;
    const when = [shortWhen(entry.at, now), scope, entry.trust === 'verified' ? 'verified only' : null].filter(Boolean).join(' · ');
    const group = dayGroup(entry.at, now);
    const heading = group !== lastGroup ? `<li class="ask-hist__group" role="presentation">${escapeHtml(group)}</li>` : '';
    lastGroup = group;
    // Two lines of the question (CSS clamps it); the full text is the title.
    return heading + `<li class="ask-hist__row${active ? ' is-current' : ''}">`
      + `<button type="button" class="ask-hist__item${entry.result?.degraded ? ' ask-hist__item--empty' : ''}" data-action="ask-history-open" data-index="${escapeHtml(index)}" title="${escapeHtml(entry.query)}"${active ? ' aria-current="true"' : ''}>`
      + `<span class="ask-hist__q">${escapeHtml(entry.query)}</span>`
      + `<span class="ask-hist__when">${escapeHtml(when)}${entry.result?.degraded ? ' · no answer' : ''}</span></button>`
      + `<button type="button" class="ask-hist__remove" data-action="ask-history-remove" data-index="${escapeHtml(index)}" aria-label="Forget “${escapeHtml(entry.query.slice(0, 60))}”" title="Forget this question">×</button>`
      + '</li>';
  }).join('');
  const hidden = history.length - shown.length;
  const list = history.length
    ? `<ul class="ask-hist__list">${rows}</ul>`
      + '<div class="ask-hist__tools">'
      + (hidden > 0 ? `<button type="button" class="ask-hist__tool" data-action="ask-history-show-all">Show all ${escapeHtml(history.length)}</button>` : (showAll && history.length > ASK_HISTORY_RECENT ? '<button type="button" class="ask-hist__tool" data-action="ask-history-show-recent">Show recent</button>' : ''))
      + '<button type="button" class="ask-hist__tool" data-action="ask-history-clear">Clear history</button>'
      + '</div>'
    : '<p class="ask-hist__empty">Questions you ask stay here on this device, the most recent few at hand.</p>';
  return '<nav class="ask-hist" aria-label="Earlier questions">'
    + '<button type="button" class="btn-ghost ask-hist__new" data-action="ask-new">＋ New question</button>'
    + `<button type="button" class="ask-hist__toggle" data-action="ask-history-toggle" aria-expanded="${open ? 'true' : 'false'}"><span class="ask-hist__chev" aria-hidden="true">${open ? '▾' : '▸'}</span>Earlier questions<span class="ask-hist__count">${escapeHtml(history.length)}</span></button>`
    + (open ? list : '')
    + '<p class="ask-hist__note">Answers come from your library only.</p>'
    + (state.askPraxResult?.sources?.length || state.askPraxResult?.answer
      ? '<button type="button" class="btn-ghost ask-hist__assistant" data-action="ask-to-assistant" title="Give the assistant this question and its sources to act on. It can change tasks and documents (⌘I)">Act on this with the assistant</button>'
      : '<button type="button" class="btn-ghost ask-hist__assistant" data-action="open-assistant" title="The assistant can change tasks and documents (⌘I)">Use the assistant</button>')
    + '</nav>';
}

function renderSourcesRail(sources, cited) {
  if (!sources.length) return '<aside class="ask-sources" aria-label="Sources"><h2 class="rq-label">Sources</h2><p class="rq-note rq-note--quiet">Sources appear here with each answer.</p></aside>';
  const cards = sources.map((source, index) => {
    const number = index + 1;
    const trust = source.missing ? 'no longer in the library' : (source.verified ? '✓ verified' : `◌ unverified${isAgentSource(source) ? ' · agent' : ''}`);
    // A source re-read after the answer was given (history): say what moved.
    const changed = source.changed ? (source.changed === 'trust' ? ' · trust changed since this answer' : ' · edited since this answer') : '';
    const label = [`Source ${number}`, source.title || 'Untitled', source.documentType || 'note', ...(source.stale ? ['stale'] : []), source.missing ? 'no longer in the library' : (source.verified ? 'verified' : 'unverified'), ...(source.changed ? ['changed since this answer'] : [])].join(', ');
    return `<li><button type="button" class="ask-src${source.verified ? '' : ' ask-src--agent'}${cited.has(number) ? ' is-cited' : ''}${source.changed || source.missing ? ' ask-src--changed' : ''}" data-action="open-ask-source" data-document-id="${escapeHtml(source.id || '')}" data-source-n="${escapeHtml(number)}" aria-label="Open ${escapeHtml(label)}"${source.missing ? ' disabled' : ''}>`
      + `<span class="ask-src__head"><span class="ask-src__n">${escapeHtml(number)}</span><span class="ask-src__title">${escapeHtml(source.title || 'Untitled')}</span></span>`
      + `<span class="ask-src__trust">${escapeHtml(trust)} · ${escapeHtml(source.documentType || 'note')}${source.stale ? ' · stale' : ''}${escapeHtml(changed)}</span>`
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
const KEYWORD_ONLY = ' This was a keyword search: it finds documents that share words with the question. Semantic search (Settings ▸ Intelligence) understands questions in your own words.';

// What the retrieval could not cover: an incomplete index, candidates left
// out until triaged, unverified memory excluded by the toggle. The old overlay
// said these; the page must too, or a refusal looks like a complete search.
function renderCoverage(r) {
  const retrieval = r?.retrieval || {};
  const notes = [];
  const index = incompleteIndexNotice(retrieval.index);
  if (index) notes.push(index);
  const hidden = Number(retrieval.hiddenHarvested) || 0;
  if (hidden > 0) notes.push(`${hidden} unreviewed harvested candidate${hidden === 1 ? ' was' : 's were'} left out until triaged in the Inbox.`);
  const excluded = Number(retrieval.hiddenUnverified) || 0;
  if (excluded > 0) notes.push(`${excluded} unverified document${excluded === 1 ? ' was' : 's were'} left out (Verified only).`);
  if (retrieval.fallback) {
    notes.push(retrieval.reason === 'semantic-unavailable'
      ? 'Semantic search was unavailable, so this used keyword search.'
      : 'Semantic search found nothing relevant, so this used keyword search.');
  }
  return notes.length ? `<div class="ask-coverage" role="note">${notes.map((note) => `<span>${escapeHtml(note)}</span>`).join('')}</div>` : '';
}

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
  // Where tasks go: the scope the ANSWER was asked under (recorded with the
  // result), not whatever the composer shows now.
  const scope = String(state.askPraxResult?.scope || state.askScope || 'all');
  const project = projects.find((item) => item.id === scope);
  const where = suggest?.createdIn || (project ? project.name : 'Inbox');
  const canSuggest = written && Boolean(state.chatStatus?.available);
  const tasks = suggest && !suggest.loading ? suggest.tasks : [];
  const done = Array.isArray(suggest?.done) ? suggest.done : [];
  const chosen = tasks.filter((_, index) => suggest.checked[index] && !done[index]).length;
  const created = suggest?.created;
  let body = '';
  if (suggest?.loading) {
    body = '<p class="ask-tasks__status" role="status">Suggesting follow-up tasks from the sources…</p>';
  } else if (tasks.length) {
    body = '<p class="ask-tasks__hint">Proposals from the answer\'s sources. Tick the ones you want; nothing is created until you choose.</p>'
      + '<ul class="ask-tasks__list">' + tasks.map((task, index) => {
      const on = Boolean(suggest.checked[index]);
      const isDone = Boolean(done[index]);
      const due = dueLabel(task.dueDate, today);
      const hot = task.priority === 'high' && due === 'today';
      return `<li><button type="button" class="ask-task${on || isDone ? ' is-on' : ''}${isDone ? ' is-done' : ''}" role="checkbox" aria-checked="${on || isDone ? 'true' : 'false'}" data-action="ask-task-toggle" data-index="${escapeHtml(index)}"${isDone || suggest.creating ? ' disabled' : ''}>`
        + `<span class="ask-task__box" aria-hidden="true"></span><span class="ask-task__title">${escapeHtml(task.title)}</span>`
        + `<span class="ask-task__meta${hot ? ' is-hot' : ''}">${isDone ? `✓ created in ${escapeHtml(where)}` : escapeHtml([task.priority, due].filter(Boolean).join(' · '))}</span>`
        + `<span class="ask-task__src">from ${escapeHtml(task.sourceTitle)}</span></button></li>`;
    }).join('') + '</ul>';
  } else if (suggest?.degraded) {
    // The model failed or answered badly: that is not "no tasks needed".
    body = `<p class="ask-tasks__status" role="status">${escapeHtml(suggest.error || 'The model could not suggest tasks.')} <button type="button" class="ask-warn__link" data-action="ask-suggest-tasks">Try again</button></p>`;
  } else if (suggest?.error) {
    body = `<p class="ask-tasks__status" role="status">${escapeHtml(suggest.error)} <button type="button" class="ask-warn__link" data-action="ask-suggest-tasks">Try again</button></p>`;
  } else if (suggest && !suggest.loading) {
    body = '<p class="ask-tasks__status">Nothing in this answer calls for a task.</p>';
  }
  const remaining = tasks.filter((_, index) => !done[index]).length;
  const allDone = tasks.length > 0 && (remaining === 0 || (created != null && !Array.isArray(suggest.done)));
  const primary = tasks.length && !allDone
    ? `<button type="button" class="${chosen ? 'btn-primary' : 'btn-ghost'} ask-tasks__create" data-action="ask-create-tasks"${chosen && !suggest.creating ? '' : ' disabled'}>${suggest.creating ? 'Creating…' : (chosen ? `Create ${escapeHtml(chosen)} task${chosen === 1 ? '' : 's'}` : 'Create tasks')}</button>`
    : (created != null ? `<span class="ask-tasks__done" role="status">✓ Created ${escapeHtml(created)} task${created === 1 ? '' : 's'} in ${escapeHtml(where)}</span>` : '');
  const copyable = written || state.askPraxResult?.sources?.length;
  const actions = '<div class="ask-actions">'
    + primary
    + (written ? '<button type="button" class="btn-ghost" data-action="save-ask-note">Save answer as note</button>' : '')
    + (copyable ? '<button type="button" class="btn-ghost" data-action="copy-ask-prax">Copy with citations</button>' : '')
    + (canSuggest && !suggest ? '<button type="button" class="btn-ghost" data-action="ask-suggest-tasks">Suggest tasks</button>' : '')
    + '</div>';
  if (!suggest) return actions;
  return `<section class="ask-tasks" aria-label="Suggested tasks"><h2 class="rq-label">Suggested tasks · ${escapeHtml(where)}</h2>${body}${actions}</section>`; // html-safe: body and actions are built from escaped values
}

export function renderAskPageHtml(state, { resolveWikiLink, projects = [], today = isoToday(), now = new Date() } = {}) {
  const r = state.askPraxResult;
  const sources = Array.isArray(r?.sources) ? r.sources : [];
  let thread = '';
  let cited = new Set();
  if (state.askPraxLoading) {
    thread = `<div class="ask-q">${escapeHtml(state.askPraxQuery || '')}</div>`
      + '<p class="ask-status" role="status">Reading the most relevant documents and writing an answer…</p>';
  } else if (state.askPraxError) {
    // The question stays, and so does a way to send it again.
    thread = `<div class="ask-q">${escapeHtml(state.askPraxQuery || '')}</div>`
      + '<p class="ask-status ask-status--error" role="alert">Could not get an answer. <button type="button" class="ask-warn__link" data-action="ask-retry">Try again</button> or check the AI model in <button type="button" class="ask-warn__link" data-action="open-ai-settings">Settings ▸ Intelligence</button>.</p>';
  } else if (r) {
    const written = !r.degraded && typeof r.answer === 'string' && r.answer.trim();
    // Without a written answer the retrieved pack stands in — but only when
    // there is something in it; an empty pack is debris under a refusal.
    const fallback = sources.length ? (r.markdown || '') : '';
    const answer = renderCitedAnswer(written ? r.answer : fallback, written ? sources : [], { resolveWikiLink });
    cited = answer.cited;
    const mode = r.retrieval?.mode === 'semantic' ? 'searched by meaning' : 'keyword search';
    const meta = [`${sources.length} source${sources.length === 1 ? '' : 's'}`, mode, ...(cited.size ? [`${cited.size} cited`] : []), ...(r.retrieval?.trust === 'verified' ? ['verified only'] : []), r.model || (written ? '' : 'no model'), ...(r.at ? [`answered ${shortWhen(r.at)}`] : [])]
      .filter(Boolean).map((part) => `<span>${escapeHtml(part)}</span>`).join('<span aria-hidden="true">·</span>');
    const unverifiedCited = sources.filter((source, index) => cited.has(index + 1) && !source.verified && !source.missing);
    const reviewTarget = unverifiedCited[0];
    const warning = unverifiedCited.length
      ? `<div class="ask-warn" role="note"><span aria-hidden="true">◌</span><span>${unverifiedCited.length === 1 ? `“${escapeHtml(unverifiedCited[0].title)}” is` : `${escapeHtml(unverifiedCited.length)} cited sources are`} unverified memory nobody has checked yet. Check before you act. ${unverifiedCited.length === 1 ? `<button type="button" class="ask-warn__link" data-action="ask-review-source" data-document-id="${escapeHtml(reviewTarget.id || '')}" data-agent="${isAgentSource(reviewTarget) ? 'true' : 'false'}">Review it now</button>` : '<button type="button" class="ask-warn__link" data-action="nav-review">Open the review queue</button>'}</span></div>`
      : '';
    const changedSources = sources.filter((source) => source.changed || source.missing);
    const snapshot = r.at
      ? `<div class="ask-snapshot" role="note">Answered ${escapeHtml(shortWhen(r.at))} from the library as it was then.${changedSources.length ? ` ${escapeHtml(changedSources.length)} source${changedSources.length === 1 ? ' has' : 's have'} changed since.` : ''} <button type="button" class="ask-warn__link" data-action="ask-retry">Ask again</button></div>`
      : '';
    const keywordOnly = r.degraded && r.reason === 'no-sources' && r.retrieval?.mode !== 'semantic' ? KEYWORD_ONLY : '';
    const notice = r.degraded ? `<div class="ask-notice">${escapeHtml((DEGRADED[r.reason] || DEGRADED['no-chat-model']) + keywordOnly)}</div>` : '';
    thread = `<div class="ask-q">${escapeHtml(r.query || state.askPraxQuery || '')}</div>`
      + `<div class="ask-meta"><span class="ask-meta__who">${icon('spark', 12)}prax</span>${meta}</div>`
      + snapshot
      + notice
      + renderCoverage(r)
      + (answer.html ? `<div class="ask-answer prose">${answer.html}</div>` : '') // html-safe: renderCitedAnswer renders untrusted markdown and escapes chips
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
    + `<textarea id="ask-page-input" class="ask-composer__input" data-ask-page-input rows="${escapeHtml(Math.min(8, String(state.askDraft || '').split('\n').length))}" placeholder="${r ? 'Ask another question…' : 'Ask Prax about your library…'}" autocomplete="off" spellcheck="false">${escapeHtml(state.askDraft || '')}</textarea>`
    + '<div class="ask-composer__row">'
    + `<label class="ask-chip ask-chip--scope"><span class="ask-chip__dot" style="background:${escapeHtml(scopeProject?.color || 'var(--ink3)')}" aria-hidden="true"></span><span class="visually-hidden">Scope</span><select data-ask-scope aria-label="Scope">${scopeOptions}</select></label>`
    + `<button type="button" class="ask-chip" data-action="toggle-ask-trust" aria-pressed="${verifiedOnly ? 'true' : 'false'}" title="Which memory an answer may draw on">${verifiedOnly ? '✓ Verified only' : 'Verified + unverified'}</button>`
    + `<button type="button" class="ask-chip ask-chip--model" data-action="open-ai-settings" title="The model that writes answers. Change it in Settings ▸ Intelligence">${escapeHtml(modelLabel)}</button>`
    + '<span class="ask-composer__gap"></span>'
    + `<span class="ask-composer__hint">${r ? 'each question stands alone · ' : ''}⇧↵ new line</span>`
    + `<button type="button" class="btn-primary ask-composer__go" data-action="run-ask-prax"${String(state.askDraft || '').trim() ? '' : ' disabled'}>Ask<span class="kbd">↵</span></button>`
    + '</div></div>';

  return '<div class="ask-page">'
    + renderHistory(state, projects, now)
    + `<section class="ask-thread" aria-label="Answer" aria-busy="${Boolean(state.askPraxLoading)}">`
    + '<button type="button" class="btn-icon ask-close" data-action="close-ask-page" aria-label="Close Ask Prax" title="Close (Esc)">×</button>'
    + `<div class="ask-thread__scroll">${thread}</div>${composer}</section>` // html-safe: thread and composer are built from escaped values and renderCitedAnswer
    + renderSourcesRail(sources, cited)
    + '</div>';
}
