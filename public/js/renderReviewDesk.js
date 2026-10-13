// The review desk (Console redesign, 2026-10): agent memory reviewed one
// document at a time, as the mockup's three columns — the queue, the memory
// itself, and where it came from. Pure state → HTML.
//
// The desk shows the SAVED content of one revision (state.reviewDeskDoc,
// fetched fresh), and Verify binds to exactly that revision, the same
// integrity rule the editor's Verify follows (QINV-04): if the document
// changed meanwhile the server refuses and the desk reloads it.
//
// state.reviewDeskContext: { id, codeRefs[], links[], similar[], similarReason }

import { escapeHtml } from './html.js';
import { renderMarkdownHtml } from './markdownPreview.js';
import { reviewQueue } from './renderLibrary.js';
import { DOCUMENT_TYPES } from './documentTypes.js';

const TYPE_LABELS = Object.fromEntries(DOCUMENT_TYPES.map((type) => [type.value, type.label]));

function agentOf(doc) {
  if (doc?.updatedByAgent) return String(doc.updatedByAgent);
  return doc?.kind === 'synthesized' ? 'synthesized' : 'agent';
}

function when(iso) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    + ' ' + date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function shortDay(iso) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// The queue the desk walks: the review queue, oldest first (the order agents
// wrote it), narrowed by the Library's search box like the table.
export function reviewDeskQueue(state) {
  const queue = reviewQueue(state.documents || []);
  // Opened from a filtered table: that table's rows, in its order (documents
  // verified meanwhile drop out as the queue predicate removes them).
  if (Array.isArray(state.reviewDeskIds) && state.reviewDeskIds.length) {
    const byId = new Map(queue.map((doc) => [doc.id, doc]));
    return state.reviewDeskIds.map((id) => byId.get(id)).filter(Boolean);
  }
  const query = String(state.libraryQuery || '').trim().toLowerCase();
  return queue
    .filter((doc) => !query || String(doc.title || '').toLowerCase().includes(query)
      || String(doc.body || '').toLowerCase().includes(query))
    .sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')));
}

export function reviewDeskCurrentId(state, queue = reviewDeskQueue(state)) {
  const wanted = state.reviewDeskId;
  return queue.some((doc) => doc.id === wanted) ? wanted : (queue[0]?.id || null);
}

function renderQueue(queue, currentId, state) {
  const done = (state.reviewDeskDone || []).map((entry) => (
    `<li class="rq-item rq-item--done"><span class="rq-item__mark" aria-hidden="true">${entry.outcome === 'verified' ? '✓' : '·'}</span>`
    + `<span class="rq-item__body"><span class="rq-item__title">${escapeHtml(entry.title)}</span>`
    + `<span class="rq-item__meta">${escapeHtml(entry.outcome)}</span></span></li>`
  )).join('');
  const open = queue.map((doc) => {
    const current = doc.id === currentId;
    return `<li><button type="button" class="rq-item${current ? ' is-current' : ''}" data-action="review-desk-select" data-document-id="${escapeHtml(doc.id)}"${current ? ' aria-current="true"' : ''}>`
      + `<span class="rq-item__mark" aria-hidden="true">${current ? '›' : '◌'}</span>`
      + `<span class="rq-item__body"><span class="rq-item__title">${escapeHtml(doc.title || 'Untitled document')}</span>`
      + `<span class="rq-item__meta">${escapeHtml(agentOf(doc))} · ${escapeHtml(shortDay(doc.updatedAt))}</span></span>`
      + '</button></li>';
  }).join('');
  return '<section class="rq-queue" aria-label="Queue">'
    + '<div class="rq-queue__head"><h2 class="rq-queue__title">Agent memory</h2>'
    + '<p class="rq-queue__sub">Agents recall verified memory first. Unverified memory reaches them labelled as unverified.</p></div>'
    + `<ul class="rq-queue__list">${done}${open}</ul>`
    + '<div class="rq-queue__foot"><button type="button" class="btn-ghost" data-action="review-desk-table">Table and bulk verify</button></div>'
    + '</section>';
}

function renderProvenance(doc, context, state) {
  const refs = Array.isArray(context?.codeRefs) ? context.codeRefs : [];
  const links = Array.isArray(context?.links) ? context.links : [];
  const recall = state.recallCounts?.counts?.[doc.id];
  const commits = [...new Set(refs.map((ref) => ref.commitSha).filter(Boolean))];
  const facts = [
    ['agent', `<span class="rq-agent">${escapeHtml(agentOf(doc))}</span>`],
    ['written', escapeHtml(when(doc.updatedAt))],
    ...(commits.length ? [['commit', escapeHtml(commits.map((sha) => String(sha).slice(0, 7)).join(', '))]] : []),
    ...(recall ? [['recalled', `${escapeHtml(recall.hits || 0)}× · used ${escapeHtml(recall.uses || 0)}×`]] : []),
  ].map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join(''); // html-safe: values escaped above
  const refRows = refs.length
    ? refs.map((ref) => {
      const lines = ref.startLine ? `#L${escapeHtml(ref.startLine)}${ref.endLine && ref.endLine !== ref.startLine ? `-${escapeHtml(ref.endLine)}` : ''}` : '';
      return `<li class="rq-ref"><span class="rq-ref__path">${escapeHtml(ref.path)}${lines}</span>`
        + (ref.symbol ? `<span class="rq-ref__sym">${escapeHtml(ref.symbol)}</span>` : '')
        + '</li>';
    }).join('')
    : '<li class="rq-empty">No code cited. Verify it on its own words.</li>';
  const linkRows = links.length
    ? links.slice(0, 6).map((link) => (
      `<li><button type="button" class="rq-link" data-action="open-linked-doc" data-document-id="${escapeHtml(link.documentId)}">`
      + `<span class="rq-link__rel">${escapeHtml(link.direction === 'inbound' ? `${link.relation} ←` : link.relation)}</span>`
      + `<span class="rq-link__title">${escapeHtml(link.title || 'Untitled document')}</span></button></li>`
    )).join('')
    : '';
  return '<aside class="rq-prov" aria-label="Provenance">'
    + `<div class="rq-prov__block"><h3 class="rq-label">Written by</h3><dl class="rq-facts">${facts}</dl></div>`
    + `<div class="rq-prov__block"><h3 class="rq-label">Cited evidence</h3><ul class="rq-list">${refRows}</ul></div>`
    + (linkRows ? `<div class="rq-prov__block"><h3 class="rq-label">Links</h3><ul class="rq-list">${linkRows}</ul></div>` : '')
    + '<div class="rq-prov__block"><h3 class="rq-label">If you verify</h3><p class="rq-note">Agents get it in the verified section of recall and in session-start briefings for its project.</p></div>'
    + '</aside>';
}

function renderOverlap(context) {
  const similar = Array.isArray(context?.similar) ? context.similar : [];
  const match = similar.find((item) => item.verified) || similar[0];
  if (!match) {
    if (context?.similarReason === 'semantic-off') {
      return '<p class="rq-note rq-note--quiet">Overlap checks need semantic search (Settings ▸ Intelligence).</p>';
    }
    return '';
  }
  return '<div class="rq-overlap">'
    + '<span class="rq-overlap__icon" aria-hidden="true">≈</span>'
    + '<div class="rq-overlap__text">'
    + `<strong>${match.verified ? 'Overlaps a verified document' : 'Overlaps another document'}</strong>`
    + `<span>“${escapeHtml(match.title || 'Untitled document')}” covers similar ground. Supersede this memory with it instead of keeping two?</span>`
    + '</div>'
    + `<button type="button" class="btn-ghost" data-action="open-linked-doc" data-document-id="${escapeHtml(match.id)}">Compare</button>`
    + `<button type="button" class="btn-ghost" data-action="review-desk-supersede" data-replacement-id="${escapeHtml(match.id)}">Supersede with it</button>`
    + '</div>';
}

export function renderReviewDeskHtml(state) {
  const queue = reviewDeskQueue(state);
  const currentId = reviewDeskCurrentId(state, queue);
  const doneCount = (state.reviewDeskDone || []).length;
  const total = queue.length + doneCount;
  const position = currentId ? doneCount + 1 : total;
  const progress = total ? Math.round((doneCount / total) * 100) : 100;

  const head = '<header class="rq-head">'
    + '<div><h1 class="page-head__title">Review queue</h1>'
    + '<span class="page-head__sub">Agent memory waiting for a person</span></div>'
    + (total ? `<div class="rq-progress" aria-label="${escapeHtml(position)} of ${escapeHtml(total)}"><span>${escapeHtml(position)} of ${escapeHtml(total)}</span><span class="rq-progress__bar"><span style="width:${escapeHtml(progress)}%"></span></span></div>` : '')
    + '</header>';

  if (!currentId) {
    const empty = '<div class="rq-main"><div class="rq-empty-state">'
      + `<p class="empty__title">${doneCount ? 'Queue cleared.' : 'Nothing waiting for review.'}</p>`
      + '<p class="empty__sub">Documents agents write land here until a person verifies them.</p>'
      + '</div></div>';
    // What was decided this session stays listed beside the cleared queue.
    return doneCount
      ? `<div class="rq">${head}<div class="rq-grid">${renderQueue(queue, null, state)}${empty}</div></div>`
      : `<div class="rq">${head}${empty}</div>`;
  }

  const loaded = state.reviewDeskDoc?.id === currentId ? state.reviewDeskDoc : null;
  const listed = queue.find((doc) => doc.id === currentId);
  const doc = loaded || listed;
  const context = state.reviewDeskContext?.id === currentId ? state.reviewDeskContext : null;
  const type = TYPE_LABELS[doc.documentType] || doc.documentType || 'Note';
  const project = (state.projects || []).find((item) => item.id === doc.projectId)
    || (state.managedProjects || []).find((item) => item.id === doc.projectId);
  const body = loaded
    ? renderMarkdownHtml(String(loaded.body || '').replace(/^# .*\n+/, ''), { mode: 'untrusted' }) // html-safe: renderMarkdownHtml escapes untrusted markdown
    : '<p class="rq-note rq-note--quiet">Loading the saved revision…</p>';

  const memory = '<article class="rq-memory" aria-label="Memory">'
    + '<div class="rq-memory__chips">'
    + '<span class="rq-chip rq-chip--agent">◌ unverified</span>'
    + `<span class="rq-chip">${escapeHtml(type.toLowerCase())}</span>`
    + (project ? `<span class="rq-chip">${escapeHtml(project.name)}</span>` : '')
    + ((doc.tags || []).slice(0, 3).map((tag) => `<span class="rq-chip">#${escapeHtml(tag)}</span>`).join(''))
    + '</div>'
    + `<h2 class="rq-memory__title">${escapeHtml(doc.title || 'Untitled document')}</h2>`
    + `<div class="rq-memory__body prose">${body}</div>` // html-safe: body is renderMarkdownHtml output or a literal
    + renderOverlap(context)
    + '</article>';

  const ready = Boolean(loaded);
  const actions = '<div class="rq-actions" role="group" aria-label="Decision">'
    + `<button type="button" class="btn-primary rq-act" data-action="review-desk-verify"${ready ? '' : ' disabled'}>✓ Verify<span class="kbd">V</span></button>`
    + `<button type="button" class="btn-ghost rq-act" data-action="review-doc" data-document-id="${escapeHtml(currentId)}" title="Open it in the editor, fix it, then verify there">Edit<span class="kbd">E</span></button>`
    + `<button type="button" class="btn-ghost rq-act" data-action="review-desk-supersede-pick">Supersede…<span class="kbd">M</span></button>`
    + '<span class="rq-actions__gap"></span>'
    + `<button type="button" class="btn-ghost rq-act rq-act--reject" data-action="review-desk-reject" title="Archive it: out of recall and the queue, restorable from the archive">Reject<span class="kbd">R</span></button>`
    + '<button type="button" class="btn-ghost rq-act" data-action="review-desk-skip">Skip<span class="kbd">J</span></button>'
    + '</div>';

  return `<div class="rq">${head}<div class="rq-grid">`
    + renderQueue(queue, currentId, state)
    + `<div class="rq-main">${memory}${actions}</div>` // html-safe: memory and actions are built from escaped values and renderMarkdownHtml
    + renderProvenance(doc, context, state)
    + '</div></div>';
}
