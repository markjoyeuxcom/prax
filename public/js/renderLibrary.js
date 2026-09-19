import { incompleteIndexNotice } from './retrievalStatus.js';
import { escapeHtml, chip } from './renderHelpers.js';
import { icon } from './icons.js';
import { DOCUMENT_TEMPLATES } from './documentTemplates.js';
import {
  filterDocumentsByTags,
  filterDocumentsByTypes,
  filterDocumentsByTrust,
  TRUST_PREDICATES,
  sortDocuments,
  groupDocumentsByType,
  tagsForDocuments,
  docTypeKey as sharedDocTypeKey,
} from './libraryFilters.js';
import { DOCUMENT_TYPES, documentTypeLabel } from './documentTypes.js';

// Library page (Prax design): header actions, keyword/semantic search row,
// tag-pill filters, Runbooks/Notes card grid, semantic idle/result states and
// the flat archive list. Pure state → HTML; events delegate via data-action.
//
// Semantic results show the real cosine similarity the ranker computes — as a
// similarity value plus a bar scaled relative to the top hit so the (narrow)
// spread is legible — alongside a snippet. It is not labelled as confidence or
// probability. If a result carries no score we fall back to rank.

const KEYWORD_PLACEHOLDER = 'Search titles, text, and tags…';
const SEMANTIC_PLACEHOLDER = 'Ask in plain language — e.g. "what do I do when the database dies"';
export const LIBRARY_RENDER_BATCH_SIZE = 60;

export function limitDocumentGroups(groups, limit = LIBRARY_RENDER_BATCH_SIZE) {
  const safeGroups = Array.isArray(groups) ? groups : [];
  const normalizedLimit = Number.isFinite(Number(limit))
    ? Math.max(0, Math.floor(Number(limit)))
    : LIBRARY_RENDER_BATCH_SIZE;
  const total = safeGroups.reduce((sum, group) => sum + (Array.isArray(group.docs) ? group.docs.length : 0), 0);
  let remaining = normalizedLimit;
  const visibleGroups = [];
  for (const group of safeGroups) {
    const docs = Array.isArray(group.docs) ? group.docs : [];
    const visibleDocs = docs.slice(0, remaining);
    remaining = Math.max(0, remaining - visibleDocs.length);
    if (visibleDocs.length) visibleGroups.push({ ...group, docs: visibleDocs, totalCount: docs.length });
  }
  const shown = visibleGroups.reduce((sum, group) => sum + group.docs.length, 0);
  return { groups: visibleGroups, shown, total, hasMore: shown < total };
}

function normalizedTag(value) {
  return String(value || '').trim().toLowerCase();
}

function docTypeKey(doc) {
  return sharedDocTypeKey(doc); // registry-aware; unknown/legacy values key as 'note'
}

function typeChip(doc) {
  const key = docTypeKey(doc);
  return chip(documentTypeLabel(key).toUpperCase(), `type-${key}`);
}

// Trust chips survive the redesign: SYNTH / STALE / VERIFIED / SUPERSEDED.
function trustChips(doc, { showUnverified = false } = {}) {
  const chips = [];
  if (doc.kind === 'synthesized') chips.push(chip('SYNTH', 'synth'));
  if (doc.stale === true) chips.push(chip('STALE', 'stale'));
  if (doc.verified === true) chips.push(chip('VERIFIED', 'verified'));
  else if (showUnverified) chips.push(chip('UNVERIFIED', 'unverified'));
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

// Type / trust / project counts over the full active set — shared by the main
// view's facet rows (narrow windows) and the Library panel (wide windows), so
// both surfaces show the same numbers.
export function libraryFacetCounts(documents) {
  const docs = Array.isArray(documents) ? documents : [];
  return {
    type: Object.fromEntries(DOCUMENT_TYPES.map((t) => [t.value, docs.filter((doc) => docTypeKey(doc) === t.value).length])),
    trust: {
      verified: docs.filter(TRUST_PREDICATES.verified).length,
      stale: docs.filter(TRUST_PREDICATES.stale).length,
      superseded: docs.filter(TRUST_PREDICATES.superseded).length,
      agent: docs.filter(TRUST_PREDICATES.agent).length,
    },
    project: Object.fromEntries(
      [...new Set(docs.map(doc => doc.projectId).filter(Boolean))]
        .map(projectId => [projectId, docs.filter(doc => doc.projectId === projectId).length]),
    ),
  };
}

// Pure derivation of everything the library page renders from state.
// The `{ now }` options bag is part of the shared build* signature; the
// library shows absolute short dates, so it is currently unused.
export function buildLibraryModel(state, { limit = LIBRARY_RENDER_BATCH_SIZE } = {}) {
  const documents = Array.isArray(state.documents) ? state.documents : [];
  const activeTags = Array.isArray(state.activeLibraryTags) ? state.activeLibraryTags : [];
  const types = Array.isArray(state.libraryTypes) ? state.libraryTypes : [];
  const trust = Array.isArray(state.libraryTrust) ? state.libraryTrust : [];
  const projectIds = Array.isArray(state.libraryProjects) ? state.libraryProjects : [];
  const query = String(state.libraryQuery || '').trim().toLowerCase();
  const semantic = Boolean(state.librarySemantic);

  // Tag chips come from the pre-filter set so narrowing never hides pills.
  const tagChips = tagsForDocuments(documents);
  // Facet counts come from the full active set, so a pill always shows how many
  // exist regardless of the other facets.
  const facetCounts = libraryFacetCounts(documents);

  let filtered = filterDocumentsByTags(documents, activeTags);
  // Type + trust + project facets only apply where their pills are shown (the browse
  // view). In archive/semantic the facet row is hidden, so a leftover selection
  // would be an invisible, unclearable filter — ignore it there.
  const facetsShown = state.libraryView !== 'archive' && !semantic;
  if (facetsShown) {
    filtered = filterDocumentsByTypes(filtered, types); // OR within the axis (like trust)
    filtered = filterDocumentsByTrust(filtered, trust);
    if (projectIds.length) filtered = filtered.filter(doc => projectIds.includes(doc.projectId));
  }
  if (query && !semantic) filtered = filtered.filter((doc) => matchesQuery(doc, query));
  filtered = sortDocuments(filtered, state.librarySortBy);

  const anyFilter = Boolean(query) || activeTags.length > 0
    || (facetsShown && (types.length > 0 || trust.length > 0 || projectIds.length > 0));

  const collection = limitDocumentGroups(groupDocumentsByType(filtered), limit);

  return {
    groups: collection.groups,
    tagChips,
    facetCounts,
    semanticIdle: semantic && !query,
    semanticActive: semantic && Boolean(query) && state.semanticResults !== null
      && state.semanticResults !== undefined,
    semanticResults: state.semanticResults ?? null,
    semanticPage: state.semanticPage ?? null,
    semanticIndex: state.semanticIndex ?? null,
    semanticError: Boolean(state.semanticError),
    semanticLoading: Boolean(state.semanticLoading),
    semanticLoadingMore: Boolean(state.semanticLoadingMore),
    semanticMoreError: Boolean(state.semanticMoreError),
    embeddedCount: Number(state.semanticIndex?.embedded ?? state.semanticStatus?.embeddedCount) || 0,
    totalCount: Number(state.semanticIndex?.total ?? state.semanticStatus?.totalCount) || 0,
    archive: state.libraryView === 'archive',
    visibleCount: filtered.length,
    renderedCount: collection.shown,
    hasMore: collection.hasMore,
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

// The header keeps three things (year-one shell spec, item 3): Ask Prax, the
// ＋ New doc template menu, and an overflow holding the occasional actions —
// every one of them keeps its data-action, so nothing else needs to change.
function renderLibraryMenu(state, model) {
  const open = Boolean(state.libraryMenuOpen);
  const item = (action, label, hint, extra = '') => `
          <button class="menu__item" type="button" data-action="${action}"${extra}>
            ${label}
            ${hint ? `<span class="menu__item-sub">${hint}</span>` : ''}
          </button>`;
  return `
      <div class="menu">
        <button class="btn-ghost btn-ghost--icon" type="button" data-action="toggle-library-menu" aria-haspopup="true" aria-expanded="${open}" aria-label="More library actions" title="More library actions">⋯</button>
        ${open ? `<div class="menu__panel menu__panel--right" role="menu">
          ${item('open-generate-runbook', `${icon('spark', 13)} New runbook from an incident`, 'Generate a runbook from an incident description')}
          ${item('open-health', 'Health', 'Library health — docs needing attention')}
          ${item('generate-weekly-review', 'Weekly review', 'Compile last week into a Library doc (idempotent per week)')}
          ${item('import-documents', 'Import Markdown…', 'Choose Markdown files and their destination project', ' title="Choose Markdown files and their destination project"')}
          ${item('export-library', 'Export…', 'Choose scope and where to save the Markdown archive', ' title="Choose scope and where to save the Markdown archive"')}
          ${item('toggle-library-view', model.archive ? 'Active' : 'Archive', model.archive ? 'Back to the browse view' : 'Archived documents: restore or delete', ` aria-pressed="${model.archive}"`)}
        </div>` : ''}
      </div>`;
}

function renderPageHead(state, model) {
  const sub = model.archive ? '<span class="page-head__sub">Archive</span>' : '';
  return `
    <header class="page-head">
      <h1 class="page-head__title">Library</h1>
      ${sub}
      <div class="page-head__actions">
        <button class="btn-ghost" type="button" data-action="open-ask-prax" title="Ask Prax a question, answered from your library">${icon('spark', 13)}<span>Ask Prax</span></button>
        ${renderNewDocMenu(state)}
        ${renderLibraryMenu(state, model)}
      </div>
    </header>`;
}

// Wide windows carry the facets in the Library panel; the main view then shows
// only what is ACTIVE, as removable chips, so a filter is never invisible.
export function renderActiveFilters(state, model) {
  if (model.welcome) return '';
  const facetsShown = !model.archive && !state.librarySemantic;
  const chips = [];
  const chipHtml = (action, attrs, label) => (
    `<button class="filter-chip" type="button" data-action="${action}" ${attrs} aria-label="Remove filter ${escapeHtml(label)}">${escapeHtml(label)}<span class="filter-chip__x" aria-hidden="true">×</span></button>`
  );
  if (facetsShown) {
    for (const key of (state.libraryTypes || [])) {
      const type = DOCUMENT_TYPES.find((t) => t.value === key);
      chips.push(chipHtml('toggle-lib-type', `data-facet="${escapeHtml(key)}"`, `Type: ${type?.plural || key}`));
    }
    for (const key of (state.libraryTrust || [])) {
      const trust = TRUST_FACETS.find(([value]) => value === key);
      chips.push(chipHtml('toggle-lib-trust', `data-facet="${escapeHtml(key)}"`, `Trust: ${trust?.[1] || key}`));
    }
    const projects = [...(state.managedProjects || []), ...(state.projects || [])];
    for (const id of (state.libraryProjects || [])) {
      const project = projects.find((item) => item?.id === id);
      chips.push(chipHtml('toggle-lib-project', `data-facet="${escapeHtml(id)}"`, `Project: ${project?.name || 'Unavailable'}`));
    }
  }
  const activeTags = (state.activeLibraryTags || []).map(normalizedTag).filter(Boolean);
  for (const tag of activeTags) {
    chips.push(chipHtml('toggle-lib-tag', `data-tag="${escapeHtml(tag)}"`, `#${tag}`));
  }
  if (!chips.length) return '';
  const save = activeTags.length
    ? '<button class="tag-pill tag-pill--save" type="button" data-action="save-library-view">＋ Save view</button>'
    : '';
  return `<div class="filter-row" aria-label="Active filters">${chips.join('')}${save}<button class="btn-ghost" type="button" data-action="clear-lib-filters">Clear filters</button></div>`;
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

// How many tag pills the row shows before folding the rest behind "+N more".
// A library's tag set grows without bound — one-off tags from agent memories
// dominate it — and rendering all of them pushed the documents themselves
// below the fold. Ten is about one row at the default width; the most-used
// tags come first (tagsForDocuments sorts by count), so the fold hides the
// long tail, never the tags people actually filter by.
export const TAG_ROW_LIMIT = 10;

function renderTagRow(state, model) {
  const active = new Set((state.activeLibraryTags || []).map(normalizedTag).filter(Boolean));
  const chips = model.tagChips || [];
  const expanded = Boolean(state.libraryTagsExpanded);
  // An active tag is always shown, wherever it ranks: a filter the user cannot
  // see is a filter they cannot clear.
  const shown = expanded ? chips : chips.filter(({ tag }, index) => index < TAG_ROW_LIMIT || active.has(tag));
  const hidden = chips.length - shown.length;
  const pills = shown.map(({ tag, count }) => {
    const isActive = active.has(tag);
    return `<button class="tag-pill${isActive ? ' is-active' : ''}" type="button" data-action="toggle-lib-tag" data-tag="${escapeHtml(tag)}" aria-pressed="${isActive}">#${escapeHtml(tag)} <span class="tag-pill__count">${Number(count) || 0}</span></button>`;
  });
  if (hidden > 0) {
    pills.push(`<button class="tag-pill tag-pill--more" type="button" data-action="toggle-lib-tags" aria-expanded="false">+${hidden} more</button>`);
  } else if (expanded && chips.length > TAG_ROW_LIMIT) {
    pills.push('<button class="tag-pill tag-pill--more" type="button" data-action="toggle-lib-tags" aria-expanded="true">Show fewer</button>');
  }
  if (active.size) {
    pills.push('<button class="tag-pill tag-pill--save" type="button" data-action="save-library-view">＋ Save view</button>');
  }
  if (!pills.length) return '';
  // Same label treatment as the Type / Trust / Project facets above it, so the
  // four filter axes read as one bar instead of three labelled rows and a cloud.
  return `<div class="tag-row facet-group"><span class="facet-group__label">Tags</span>${pills.join('')}</div>`;
}

const TYPE_FACETS = DOCUMENT_TYPES.map((t) => [t.value, t.plural]);
export const TRUST_FACETS = [['verified', 'Verified'], ['stale', 'Stale'], ['superseded', 'Superseded'], ['agent', 'Agent-written']];

function facetPill(action, key, label, count, isActive) {
  return `<button class="facet-pill${isActive ? ' is-active' : ''}" type="button" data-action="${action}" data-facet="${escapeHtml(key)}" aria-pressed="${isActive}">`
    + `${escapeHtml(label)} <span class="facet-pill__count">${Number(count) || 0}</span></button>`;
}

// Type + trust + project facets. Additive AND across axes; every axis is
// OR-within. Only shown while browsing
// (not archive/semantic) once documents exist; trust facets that no document
// carries (and aren't active) are omitted to avoid dead toggles.
function renderFacetRow(state, model) {
  if (model.welcome || model.archive || state.librarySemantic) return '';
  const counts = model.facetCounts;
  if (!counts) return '';
  const activeTypes = new Set(state.libraryTypes || []);
  const activeTrust = new Set(state.libraryTrust || []);
  const activeProjects = new Set(state.libraryProjects || []);
  const projects = [...(state.managedProjects || []), ...(state.projects || [])]
    .filter((project, index, all) => project?.id && all.findIndex(item => item?.id === project.id) === index);

  const typePills = TYPE_FACETS
    .filter(([key]) => (counts.type[key] || 0) > 0 || activeTypes.has(key))
    .map(([key, label]) => facetPill('toggle-lib-type', key, label, counts.type[key], activeTypes.has(key)))
    .join('');
  const trustPills = TRUST_FACETS
    .filter(([key]) => (counts.trust[key] || 0) > 0 || activeTrust.has(key))
    .map(([key, label]) => facetPill('toggle-lib-trust', key, label, counts.trust[key], activeTrust.has(key)))
    .join('');
  const projectPills = projects
    .filter(project => (counts.project?.[project.id] || 0) > 0 || activeProjects.has(project.id))
    .map(project => facetPill('toggle-lib-project', project.id, project.name, counts.project?.[project.id], activeProjects.has(project.id)))
    .join('');

  const groups = [];
  if (typePills) groups.push(`<div class="facet-group"><span class="facet-group__label">Type</span>${typePills}</div>`);
  if (trustPills) groups.push(`<div class="facet-group"><span class="facet-group__label">Trust</span>${trustPills}</div>`);
  if (projectPills) groups.push(`<div class="facet-group"><span class="facet-group__label">Project</span>${projectPills}</div>`);
  if (!groups.length) return ''; // nothing to show (e.g. an empty library with a query)
  return `<div class="facet-row">${groups.join('')}</div>`;
}

function projectOwnershipChip(doc, state) {
  const projects = [...(state.managedProjects || []), ...(state.projects || [])];
  const project = projects.find(item => item?.id === doc?.projectId);
  return chip(project?.name || 'Project unavailable', 'project');
}

function renderDocCard(doc, state) {
  const tags = (doc.tags || []).map(normalizedTag).filter(Boolean);
  return `
    <button class="doc-card" type="button" data-action="open-doc" data-document-id="${escapeHtml(doc.id)}">
      <div class="doc-card__head">
        <span class="doc-card__title">${escapeHtml(doc.title || 'Untitled')}</span>
        <span class="doc-card__badges">${typeChip(doc)}${trustChips(doc)}</span>
      </div>
      <p class="doc-card__excerpt">${escapeHtml(excerptFor(doc.body))}</p>
      <div class="doc-card__foot">
        ${projectOwnershipChip(doc, state)}
        ${tags.map((tag) => chip(`#${tag}`, 'tag')).join('')}
        <span class="doc-card__updated">${escapeHtml(updatedLabel(doc.updatedAt))}</span>
      </div>
    </button>`;
}

function renderGroups(groups, state) {
  return groups.map(({ label, docs, totalCount }) => `
    <div class="group-label">${escapeHtml(label)} <span class="group-label__count">${Number.isInteger(totalCount) ? totalCount : docs.length}</span></div>
    <div class="doc-grid">${docs.map(doc => renderDocCard(doc, state)).join('')}</div>`).join('');
}

function renderCollectionProgress(model) {
  if (!model.hasMore) return '';
  return `<div class="collection-progress" role="status">`
    + `<span>Showing ${model.renderedCount} of ${model.visibleCount} documents.</span>`
    + `<button class="btn-ghost" type="button" data-action="show-more-library">Show ${Math.min(LIBRARY_RENDER_BATCH_SIZE, model.visibleCount - model.renderedCount)} more</button>`
    + '</div>';
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

function renderWelcome(state) {
  return `
    <div class="empty" role="status">
      ${icon('book', 28)}
      <h2 class="empty__title">Your library is empty</h2>
      <p class="empty__sub">Write a <strong>note</strong> for something to remember, or a <strong>runbook</strong> for a procedure you run again. Everything stays local and is searchable — by keyword or, once configured, by meaning.</p>
      <div class="empty__actions">
        <button class="btn-primary" type="button" data-action="new-document">＋ New doc</button>
        <button class="btn-ghost" type="button" data-action="import-documents" title="Choose Markdown files and their destination project">Import Markdown…</button>
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

function renderSemCard(result, index, maxSim = 0, state = {}) {
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
  const ariaLabel = hasScore ? `${pct}% cosine similarity, ranked ${rank}` : `Ranked ${rank}`;
  return `
    <button class="sem-card" type="button" data-action="open-doc" data-document-id="${escapeHtml(result.id)}">
      <div class="sem-card__score" aria-label="${ariaLabel}">
        <div class="sem-card__pct">${scoreLabel}</div>
        <div class="sem-card__bar"><span style="width:${barPct}%"></span></div>
      </div>
      <div class="sem-card__body" style="flex:1;min-width:0">
        <div class="sem-card__head"><span class="sem-card__title" style="font-weight:600">${escapeHtml(result.title || 'Untitled')}</span> <span class="sem-card__badges">${projectOwnershipChip(result, state)}${typeChip(result)}${trustChips(result, { showUnverified: true })}</span></div>
        <p class="sem-card__reason">${escapeHtml(result.snippet || '')}</p>
      </div>
    </button>`;
}

// The empty semantic result has three very different meanings — distinguish
// them so "connected but nothing" isn't a dead end: a backend error, nothing
// embedded yet for the active provider (the usual cause after switching
// providers without re-indexing), or a genuine no-match.
function renderSemanticEmpty(model) {
  if (model.semanticError) {
    return `
      <div class="empty" role="status">
        ${icon('spark', 24)}
        <h2 class="empty__title">Semantic search is unavailable</h2>
        <p class="empty__sub">The embedding backend couldn't be reached. Check the provider in <strong>Settings ▸ Intelligence</strong>.</p>
        <button class="btn-ghost" type="button" data-action="nav-settings">Open Settings</button>
      </div>`;
  }
  if (!model.embeddedCount) {
    return `
      <div class="empty" role="status">
        ${icon('spark', 24)}
        <h2 class="empty__title">Nothing is embedded yet</h2>
        <p class="empty__sub">Semantic search only matches documents embedded with the active provider — ${model.totalCount ? `<strong>0 of ${model.totalCount}</strong> so far` : 'none so far'}. Re-index to build the index (needed after switching providers).</p>
        <div class="empty__actions">
          <button class="btn-primary" type="button" data-action="reindex-embeddings">Re-index now</button>
          <button class="btn-ghost" type="button" data-action="nav-settings">Open Settings</button>
        </div>
      </div>`;
  }
  return `
    <div class="empty" role="status">
      ${icon('spark', 24)}
      <h2 class="empty__title">No matches by meaning</h2>
      <p class="empty__sub">None of your ${model.embeddedCount} embedded document${model.embeddedCount === 1 ? '' : 's'} matched. Try rephrasing, or turn off Semantic for a keyword search.</p>
    </div>`;
}

function renderSemanticResults(results, model = {}, state = {}) {
  const list = Array.isArray(results) ? results : [];
  const indexNotice = incompleteIndexNotice(model.semanticIndex);
  const coverage = indexNotice ? `<p class="sem-note" role="status" data-semantic-coverage>${escapeHtml(indexNotice)}</p>` : '';
  if (!list.length) return coverage + renderSemanticEmpty(model);
  const maxSim = list.reduce((m, r) => (Number.isFinite(r.similarity) && r.similarity > m ? r.similarity : m), 0);
  const reportedTotal = Number(model.semanticPage?.total);
  const total = Number.isInteger(reportedTotal) && reportedTotal >= list.length ? reportedTotal : list.length;
  const hasMore = Boolean(model.semanticPage?.hasMore);
  const count = hasMore ? `${list.length} of ${total}` : String(total);
  let more = '';
  if (model.semanticLoadingMore) {
    more = '<div class="sem-more" role="status" aria-live="polite">Loading more matches…</div>';
  } else if (model.semanticMoreError) {
    more = '<div class="sem-more sem-more--error" role="status">More matches could not be loaded. <button class="btn-ghost" type="button" data-action="load-more-semantic">Try again</button></div>';
  } else if (hasMore) {
    more = `<div class="sem-more"><button class="btn-ghost" type="button" data-action="load-more-semantic">Load more <span class="sem-more__count">(${list.length} of ${total})</span></button></div>`;
  }
  return `
    ${coverage}
    <p class="sem-note">${count} ${total === 1 ? 'document' : 'documents'} matched by meaning.</p>
    <div class="sem-list">${list.map((result, index) => renderSemCard(result, index, maxSim, state)).join('')}</div>
    ${more}`;
}

function renderSemanticLoading() {
  return `
    <div class="empty" role="status" aria-live="polite">
      ${icon('spark', 24)}
      <h2 class="empty__title">Searching by meaning…</h2>
      <p class="empty__sub">Checking the local library index for the closest matches.</p>
    </div>`;
}

function renderArchiveRows(model, state) {
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
      <div class="plain-row is-dim">
        <button class="plain-row__open" type="button" data-action="open-doc" data-document-id="${escapeHtml(doc.id)}">
          <span class="plain-row__title">${escapeHtml(doc.title || 'Untitled')}</span>
          ${projectOwnershipChip(doc, state)}${typeChip(doc)}${trustChips(doc)}
        </button>
        <button class="btn-outline" type="button" data-action="restore-document" data-document-id="${escapeHtml(doc.id)}">Restore</button>
        <button class="btn-outline btn-outline--danger" type="button" data-action="delete-document" data-document-id="${escapeHtml(doc.id)}">Delete</button>
      </div>`).join('')}
    </div>${renderCollectionProgress(model)}`;
}

function renderBody(state, model, semanticVisible) {
  if (model.welcome) return renderWelcome(state);
  if (model.archive) return renderArchiveRows(model, state);
  if (state.librarySemantic) {
    if (model.semanticLoading) return renderSemanticLoading();
    // Idle covers both "no query yet" and "results not back yet".
    return model.semanticActive ? renderSemanticResults(model.semanticResults, model, state) : renderSemanticIdle();
  }
  if (!model.visibleCount) return renderNoResults(semanticVisible);
  return renderGroups(model.groups, state) + renderCollectionProgress(model);
}

// `facetsInPanel`: the caller (main.js) sets it when the Library panel is on
// screen (wide windows), where the facet and tag rows would duplicate it; the
// main view then shows active filters only. Narrow windows keep the rows.
export function renderLibraryHtml(state, model, { facetsInPanel = false } = {}) {
  const semanticVisible = Boolean(state.semanticStatus?.available && state.semanticStatus?.enabled);
  const filters = facetsInPanel
    ? renderActiveFilters(state, model)
    : renderFacetRow(state, model) + renderTagRow(state, model);
  return `
  <section class="page" aria-label="Library">
    ${renderPageHead(state, model)}
    ${renderSearchRow(state, semanticVisible)}
    ${filters}
    ${renderBody(state, model, semanticVisible)}
  </section>`;
}
