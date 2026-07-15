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
  const facetCounts = {
    type: Object.fromEntries(DOCUMENT_TYPES.map((t) => [t.value, documents.filter((doc) => docTypeKey(doc) === t.value).length])),
    trust: {
      verified: documents.filter(TRUST_PREDICATES.verified).length,
      stale: documents.filter(TRUST_PREDICATES.stale).length,
      superseded: documents.filter(TRUST_PREDICATES.superseded).length,
      agent: documents.filter(TRUST_PREDICATES.agent).length,
    },
    project: Object.fromEntries(
      [...new Set(documents.map(doc => doc.projectId).filter(Boolean))]
        .map(projectId => [projectId, documents.filter(doc => doc.projectId === projectId).length]),
    ),
  };

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
    semanticError: Boolean(state.semanticError),
    semanticLoading: Boolean(state.semanticLoading),
    semanticLoadingMore: Boolean(state.semanticLoadingMore),
    semanticMoreError: Boolean(state.semanticMoreError),
    embeddedCount: Number(state.semanticStatus?.embeddedCount) || 0,
    totalCount: Number(state.semanticStatus?.totalCount) || 0,
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

function renderPageHead(state, model) {
  return `
    <header class="page-head">
      <h1 class="page-head__title">Library</h1>
      <div class="page-head__actions">
        <button class="btn-ghost" type="button" data-action="open-ask-prax" title="Ask Prax a question, answered from your library">${icon('spark', 13)}<span>Ask Prax</span></button>
        <button class="btn-ghost" type="button" data-action="open-generate-runbook" title="Generate a runbook from an incident description">${icon('spark', 13)}<span>New runbook</span></button>
        <button class="btn-ghost" type="button" data-action="open-health" title="Library health — docs needing attention">Health</button>
        <button class="btn-ghost" type="button" data-action="import-documents" title="Choose Markdown files and their destination project">Import Markdown…</button>
        <button class="btn-ghost" type="button" data-action="export-library" title="Choose scope and where to save the Markdown archive">Export…</button>
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

const TYPE_FACETS = DOCUMENT_TYPES.map((t) => [t.value, t.plural]);
const TRUST_FACETS = [['verified', 'Verified'], ['stale', 'Stale'], ['superseded', 'Superseded'], ['agent', 'Agent-written']];

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
  if (!list.length) return renderSemanticEmpty(model);
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
