import { escapeHtml, chip } from './renderHelpers.js';
import { icon } from './icons.js';
import {
  filterDocumentsByTags,
  sortDocuments,
  groupDocumentsByType,
  tagsForDocuments,
} from './libraryFilters.js';

// Library page (Prax design): header actions, keyword/semantic search row,
// tag-pill filters, Runbooks/Notes card grid, semantic idle/result states and
// the flat archive list. Pure state → HTML; events delegate via data-action.
//
// Semantic results deliberately show *rank + snippet only* — the semantic
// search API returns no similarity score and we never fabricate one.

const KEYWORD_PLACEHOLDER = 'Search titles, text, and tags…';
const SEMANTIC_PLACEHOLDER = 'Ask in plain language — e.g. "what do I do when the database dies"';

function normalizedTag(value) {
  return String(value || '').trim().toLowerCase();
}

function docTypeKey(doc) {
  return (doc?.documentType || 'note') === 'runbook' ? 'runbook' : 'note';
}

function typeChip(doc) {
  const key = docTypeKey(doc);
  return chip(key.toUpperCase(), `type-${key}`);
}

// Trust chips survive the redesign: SYNTH / STALE / VERIFIED / SUPERSEDED.
function trustChips(doc) {
  const chips = [];
  if (doc.kind === 'synthesized') chips.push(chip('SYNTH', 'synth'));
  if (doc.stale === true) chips.push(chip('STALE', 'stale'));
  if (doc.verified === true) chips.push(chip('VERIFIED', 'verified'));
  if (doc.status === 'superseded') chips.push(chip('SUPERSEDED', 'superseded'));
  return chips.join('');
}

// First non-empty, non-heading body line — the card's 2-line serif excerpt.
function excerptFor(body) {
  for (const line of String(body || '').split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) return trimmed;
  }
  return '';
}

// Short date label (YYYY-MM-DD) from an ISO timestamp.
function updatedLabel(updatedAt) {
  const value = String(updatedAt || '');
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : '';
}

function matchesQuery(doc, query) {
  return [doc.title, doc.body, doc.documentType, ...(doc.tags || [])]
    .map((part) => String(part ?? '').toLowerCase())
    .join(' ')
    .includes(query);
}

// Pure derivation of everything the library page renders from state.
// The `{ now }` options bag is part of the shared build* signature; the
// library shows absolute short dates, so it is currently unused.
export function buildLibraryModel(state, _options = {}) {
  const documents = Array.isArray(state.documents) ? state.documents : [];
  const activeTags = Array.isArray(state.activeLibraryTags) ? state.activeLibraryTags : [];
  const query = String(state.libraryQuery || '').trim().toLowerCase();
  const semantic = Boolean(state.librarySemantic);

  // Tag chips come from the pre-filter set so narrowing never hides pills.
  const tagChips = tagsForDocuments(documents);

  let filtered = filterDocumentsByTags(documents, activeTags);
  if (query && !semantic) filtered = filtered.filter((doc) => matchesQuery(doc, query));
  filtered = sortDocuments(filtered, state.librarySortBy);

  return {
    groups: groupDocumentsByType(filtered),
    tagChips,
    semanticIdle: semantic && !query,
    semanticActive: semantic && Boolean(query) && state.semanticResults !== null
      && state.semanticResults !== undefined,
    semanticResults: state.semanticResults ?? null,
    archive: state.libraryView === 'archive',
    visibleCount: filtered.length,
  };
}

function renderPageHead(model) {
  return `
    <header class="page-head">
      <h1 class="page-head__title">Library</h1>
      <div class="page-head__actions">
        <button class="btn-ghost" type="button" data-action="import-documents">Import .md</button>
        <button class="btn-ghost" type="button" data-action="export-library">Export all</button>
        <button class="btn-ghost" type="button" data-action="toggle-library-view" aria-pressed="${model.archive}">${model.archive ? 'Active' : 'Archive'}</button>
        <button class="btn-primary" type="button" data-action="new-document">＋ New doc</button>
      </div>
    </header>`;
}

function renderSearchRow(state, semanticVisible) {
  const isSemantic = Boolean(state.librarySemantic);
  const placeholder = isSemantic ? SEMANTIC_PLACEHOLDER : KEYWORD_PLACEHOLDER;
  const semanticButton = semanticVisible
    ? `<button class="btn-ghost${isSemantic ? ' is-on' : ''}" type="button" data-action="toggle-semantic" aria-pressed="${isSemantic}">${icon('spark', 13)}<span>Semantic</span></button>`
    : '';
  return `
    <div class="lib-search${isSemantic ? ' is-semantic' : ''}">
      <input class="lib-search__input" type="search" data-library-search placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(state.libraryQuery || '')}" autocomplete="off" aria-label="Search library">
      ${semanticButton}
      <button class="btn-ghost" type="button" data-action="cycle-lib-sort">Sort: ${state.librarySortBy === 'title' ? 'Title' : 'Updated'}</button>
    </div>`;
}

function renderTagRow(state, model) {
  const active = new Set((state.activeLibraryTags || []).map(normalizedTag).filter(Boolean));
  const pills = model.tagChips.map(({ tag, count }) => {
    const isActive = active.has(tag);
    return `<button class="tag-pill${isActive ? ' is-active' : ''}" type="button" data-action="toggle-lib-tag" data-tag="${escapeHtml(tag)}" aria-pressed="${isActive}">#${escapeHtml(tag)} <span class="tag-pill__count">${Number(count) || 0}</span></button>`;
  });
  if (active.size) {
    pills.push('<button class="tag-pill tag-pill--save" type="button" data-action="save-library-view">＋ Save view</button>');
  }
  return pills.length ? `<div class="tag-row">${pills.join('')}</div>` : '';
}

function renderDocCard(doc) {
  const tags = (doc.tags || []).map(normalizedTag).filter(Boolean);
  return `
    <button class="doc-card" type="button" data-action="open-doc" data-document-id="${escapeHtml(doc.id)}">
      <div class="doc-card__head">
        <span class="doc-card__title">${escapeHtml(doc.title || 'Untitled')}</span>
        <span class="doc-card__badges">${typeChip(doc)}${trustChips(doc)}</span>
      </div>
      <p class="doc-card__excerpt">${escapeHtml(excerptFor(doc.body))}</p>
      <div class="doc-card__foot">
        ${tags.map((tag) => chip(`#${tag}`, 'tag')).join('')}
        <span class="doc-card__updated">${escapeHtml(updatedLabel(doc.updatedAt))}</span>
      </div>
    </button>`;
}

function renderGroups(groups) {
  return groups.map(({ label, docs }) => `
    <div class="group-label">${escapeHtml(label)} <span class="group-label__count">${docs.length}</span></div>
    <div class="doc-grid">${docs.map(renderDocCard).join('')}</div>`).join('');
}

function renderNoResults(semanticVisible) {
  const hint = semanticVisible
    ? 'Try fewer tags, or flip on Semantic to search by meaning.'
    : 'Try fewer tags or a shorter search.';
  return `
    <div class="empty" role="status">
      <h2 class="empty__title">No documents match</h2>
      <p class="empty__sub">${hint}</p>
      <button class="btn-ghost" type="button" data-action="clear-lib-filters">Clear filters</button>
    </div>`;
}

function renderSemanticIdle() {
  return `
    <div class="empty" role="status">
      ${icon('spark', 24)}
      <h2 class="empty__title">Ask your library a question</h2>
      <p class="empty__sub">Semantic search runs against your local index — results are ranked by meaning.</p>
    </div>`;
}

function renderSemCard(result, index) {
  // Rank + mini bar scaled by inverse rank (px against the 44px score block).
  // No percentage: the API returns no similarity score.
  const rank = index + 1;
  const barWidth = Math.max(4, Math.round(44 / rank));
  return `
    <button class="sem-card" type="button" data-action="open-doc" data-document-id="${escapeHtml(result.id)}">
      <div class="sem-card__score" aria-label="Ranked ${rank}">
        <div class="sem-card__pct">#${rank}</div>
        <div class="sem-card__bar"><span style="width:${barWidth}px"></span></div>
      </div>
      <div class="sem-card__body" style="flex:1;min-width:0">
        <div class="sem-card__head"><span class="sem-card__title" style="font-weight:600">${escapeHtml(result.title || 'Untitled')}</span> ${typeChip(result)}</div>
        <p class="sem-card__reason">${escapeHtml(result.snippet || '')}</p>
      </div>
    </button>`;
}

function renderSemanticResults(results) {
  const list = Array.isArray(results) ? results : [];
  return `
    <p class="sem-note">${list.length} ${list.length === 1 ? 'document' : 'documents'} matched by meaning.</p>
    <div class="sem-list">${list.map(renderSemCard).join('')}</div>`;
}

function renderArchiveRows(model) {
  const docs = model.groups.flatMap((group) => group.docs);
  if (!docs.length) {
    return `
    <div class="empty" role="status">
      <h2 class="empty__title">No archived documents</h2>
      <p class="empty__sub">Documents you archive land here — restore them or delete them for good.</p>
    </div>`;
  }
  return `
    <div class="rows">${docs.map((doc) => `
      <div class="plain-row is-dim" data-action="open-doc" data-document-id="${escapeHtml(doc.id)}">
        <span class="plain-row__title">${escapeHtml(doc.title || 'Untitled')}</span>
        ${typeChip(doc)}${trustChips(doc)}
        <button class="btn-outline" type="button" data-action="restore-document" data-document-id="${escapeHtml(doc.id)}">Restore</button>
        <button class="btn-outline btn-outline--danger" type="button" data-action="delete-archived-document" data-document-id="${escapeHtml(doc.id)}">Delete</button>
      </div>`).join('')}
    </div>`;
}

function renderBody(state, model, semanticVisible) {
  if (model.archive) return renderArchiveRows(model);
  if (state.librarySemantic) {
    // Idle covers both "no query yet" and "results not back yet".
    return model.semanticActive ? renderSemanticResults(model.semanticResults) : renderSemanticIdle();
  }
  if (!model.visibleCount) return renderNoResults(semanticVisible);
  return renderGroups(model.groups);
}

export function renderLibraryHtml(state, model) {
  const semanticVisible = Boolean(state.semanticStatus?.available && state.semanticStatus?.enabled);
  return `
  <section class="page" aria-label="Library">
    ${renderPageHead(model)}
    ${renderSearchRow(state, semanticVisible)}
    ${renderTagRow(state, model)}
    ${renderBody(state, model, semanticVisible)}
  </section>`;
}
