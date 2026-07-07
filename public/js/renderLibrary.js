import { escapeHtml, chip } from './renderHelpers.js';
import { icon } from './icons.js';
import { DOCUMENT_TEMPLATES } from './documentTemplates.js';
import {
  filterDocumentsByTags,
  filterDocumentsByType,
  filterDocumentsByTrust,
  TRUST_PREDICATES,
  sortDocuments,
  groupDocumentsByType,
  tagsForDocuments,
} from './libraryFilters.js';

// Library page (Prax design): header actions, keyword/semantic search row,
// tag-pill filters, Runbooks/Notes card grid, semantic idle/result states and
// the flat archive list. Pure state → HTML; events delegate via data-action.
//
// Semantic results show the real cosine similarity the ranker computes — as a
// percentage plus a bar scaled relative to the top hit so the (narrow) spread
// is legible — alongside a snippet. If a result carries no score we fall back
// to rank; we never fabricate a number.

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
  const types = Array.isArray(state.libraryTypes) ? state.libraryTypes : [];
  const trust = Array.isArray(state.libraryTrust) ? state.libraryTrust : [];
  const query = String(state.libraryQuery || '').trim().toLowerCase();
  const semantic = Boolean(state.librarySemantic);

  // Tag chips come from the pre-filter set so narrowing never hides pills.
  const tagChips = tagsForDocuments(documents);
  // Facet counts come from the full active set, so a pill always shows how many
  // exist regardless of the other facets.
  const facetCounts = {
    type: {
      runbook: documents.filter((doc) => docTypeKey(doc) === 'runbook').length,
      note: documents.filter((doc) => docTypeKey(doc) === 'note').length,
    },
    trust: {
      verified: documents.filter(TRUST_PREDICATES.verified).length,
      stale: documents.filter(TRUST_PREDICATES.stale).length,
      superseded: documents.filter(TRUST_PREDICATES.superseded).length,
    },
  };

  let filtered = filterDocumentsByTags(documents, activeTags);
  // Type facet: two types, so exactly one selected filters; both/none = all.
  if (types.length === 1) filtered = filterDocumentsByType(filtered, types[0]);
  filtered = filterDocumentsByTrust(filtered, trust);
  if (query && !semantic) filtered = filtered.filter((doc) => matchesQuery(doc, query));
  filtered = sortDocuments(filtered, state.librarySortBy);

  const anyFilter = Boolean(query) || activeTags.length > 0 || types.length > 0 || trust.length > 0;

  return {
    groups: groupDocumentsByType(filtered),
    tagChips,
    facetCounts,
    semanticIdle: semantic && !query,
    semanticActive: semantic && Boolean(query) && state.semanticResults !== null
      && state.semanticResults !== undefined,
    semanticResults: state.semanticResults ?? null,
    archive: state.libraryView === 'archive',
    visibleCount: filtered.length,
    // A brand-new library (no documents at all, no filters/search active) gets
    // a coaching welcome instead of the "no documents match / Clear filters"
    // dead end, which only makes sense once something exists to filter.
    welcome: documents.length === 0 && !semantic && !anyFilter
      && state.libraryView !== 'archive',
  };
}

function renderNewDocMenu(state) {
  const open = Boolean(state.newDocMenuOpen);
  return `
      <div class="menu">
        <button class="btn-primary" type="button" data-action="toggle-new-doc-menu" aria-haspopup="true" aria-expanded="${open}">＋ New doc</button>
        ${open ? `<div class="menu__panel" role="menu">
          ${DOCUMENT_TEMPLATES.map((template) => `
          <button class="menu__item" type="button" data-action="new-document" data-template-id="${escapeHtml(template.id)}">
            ${escapeHtml(template.label)}
            <span class="menu__item-sub">${escapeHtml(template.hint)}</span>
          </button>`).join('')}
        </div>` : ''}
      </div>`;
}

function renderPageHead(state, model) {
  return `
    <header class="page-head">
      <h1 class="page-head__title">Library</h1>
      <div class="page-head__actions">
        <button class="btn-ghost" type="button" data-action="import-documents">Import .md</button>
        <button class="btn-ghost" type="button" data-action="export-library">Export all</button>
        <button class="btn-ghost" type="button" data-action="toggle-library-view" aria-pressed="${model.archive}">${model.archive ? 'Active' : 'Archive'}</button>
        ${renderNewDocMenu(state)}
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

const TYPE_FACETS = [['runbook', 'Runbooks'], ['note', 'Notes']];
const TRUST_FACETS = [['verified', 'Verified'], ['stale', 'Stale'], ['superseded', 'Superseded']];

function facetPill(action, key, label, count, isActive) {
  return `<button class="facet-pill${isActive ? ' is-active' : ''}" type="button" data-action="${action}" data-facet="${escapeHtml(key)}" aria-pressed="${isActive}">`
    + `${escapeHtml(label)} <span class="facet-pill__count">${Number(count) || 0}</span></button>`;
}

// Type + trust facets. Additive AND across the two axes; the type axis is
// exactly-one-of-two, the trust axis is OR-within. Only shown while browsing
// (not archive/semantic) once documents exist; trust facets that no document
// carries (and aren't active) are omitted to avoid dead toggles.
function renderFacetRow(state, model) {
  if (model.welcome || model.archive || state.librarySemantic) return '';
  const counts = model.facetCounts;
  if (!counts) return '';
  const activeTypes = new Set(state.libraryTypes || []);
  const activeTrust = new Set(state.libraryTrust || []);

  const typePills = TYPE_FACETS
    .map(([key, label]) => facetPill('toggle-lib-type', key, label, counts.type[key], activeTypes.has(key)))
    .join('');
  const trustPills = TRUST_FACETS
    .filter(([key]) => (counts.trust[key] || 0) > 0 || activeTrust.has(key))
    .map(([key, label]) => facetPill('toggle-lib-trust', key, label, counts.trust[key], activeTrust.has(key)))
    .join('');

  const groups = [`<div class="facet-group"><span class="facet-group__label">Type</span>${typePills}</div>`];
  if (trustPills) groups.push(`<div class="facet-group"><span class="facet-group__label">Trust</span>${trustPills}</div>`);
  return `<div class="facet-row">${groups.join('')}</div>`;
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

function renderWelcome() {
  return `
    <div class="empty" role="status">
      ${icon('book', 28)}
      <h2 class="empty__title">Your library is empty</h2>
      <p class="empty__sub">Write a <strong>note</strong> for something to remember, or a <strong>runbook</strong> for a procedure you run again. Everything stays local and is searchable — by keyword or, once configured, by meaning.</p>
      <div class="empty__actions">
        <button class="btn-primary" type="button" data-action="new-document">＋ New doc</button>
        <button class="btn-ghost" type="button" data-action="import-documents">Import .md</button>
      </div>
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

function renderSemCard(result, index, maxSim = 0) {
  const rank = index + 1;
  const hasScore = Number.isFinite(result.similarity);
  const pct = hasScore ? Math.round(result.similarity * 100) : null;
  // Fill relative to the strongest match in THIS result set — raw cosine
  // similarities cluster in a narrow band, so an absolute-width bar would look
  // uniformly full. Floor at 8% so even the weakest hit shows something.
  const barPct = hasScore && maxSim > 0
    ? Math.max(8, Math.round((result.similarity / maxSim) * 100))
    : Math.max(8, Math.round(100 / rank));
  const scoreLabel = hasScore ? `${pct}%` : `#${rank}`;
  const ariaLabel = hasScore ? `${pct}% match, ranked ${rank}` : `Ranked ${rank}`;
  return `
    <button class="sem-card" type="button" data-action="open-doc" data-document-id="${escapeHtml(result.id)}">
      <div class="sem-card__score" aria-label="${ariaLabel}">
        <div class="sem-card__pct">${scoreLabel}</div>
        <div class="sem-card__bar"><span style="width:${barPct}%"></span></div>
      </div>
      <div class="sem-card__body" style="flex:1;min-width:0">
        <div class="sem-card__head"><span class="sem-card__title" style="font-weight:600">${escapeHtml(result.title || 'Untitled')}</span> ${typeChip(result)}</div>
        <p class="sem-card__reason">${escapeHtml(result.snippet || '')}</p>
      </div>
    </button>`;
}

function renderSemanticResults(results) {
  const list = Array.isArray(results) ? results : [];
  const maxSim = list.reduce((m, r) => (Number.isFinite(r.similarity) && r.similarity > m ? r.similarity : m), 0);
  return `
    <p class="sem-note">${list.length} ${list.length === 1 ? 'document' : 'documents'} matched by meaning.</p>
    <div class="sem-list">${list.map((result, index) => renderSemCard(result, index, maxSim)).join('')}</div>`;
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
  if (model.welcome) return renderWelcome();
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
    ${renderPageHead(state, model)}
    ${renderSearchRow(state, semanticVisible)}
    ${renderFacetRow(state, model)}
    ${renderTagRow(state, model)}
    ${renderBody(state, model, semanticVisible)}
  </section>`;
}
