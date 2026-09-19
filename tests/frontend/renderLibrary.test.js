import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLibraryModel, limitDocumentGroups, renderLibraryHtml, libraryFacetCounts,
  isReviewQueueDoc, reviewQueue, reviewQueueSummary, renderDocTable, renderDocBulkBarHtml,
} from '../../public/js/renderLibrary.js';

const NOW = new Date('2026-07-06T12:00:00.000Z');

const DOCS = [
  {
    id: 'doc-restore',
    title: 'Restore CloudNativePG',
    body: '# Restore CloudNativePG\n\nCheck backups nightly before promoting a replica.',
    documentType: 'runbook',
    projectId: 'p1',
    tags: ['postgres', 'backup'],
    updatedAt: '2026-05-18T10:00:00.000Z',
  },
  {
    id: 'doc-ideas',
    title: 'Ideas',
    body: 'General notes about the homelab.',
    documentType: 'note',
    projectId: 'p2',
    tags: ['homelab'],
    updatedAt: '2026-06-02T11:00:00.000Z',
  },
  {
    id: 'doc-dns',
    title: 'DNS failover',
    body: '# DNS\n\nSwitch resolvers when upstream dies.',
    documentType: 'runbook',
    projectId: 'p1',
    tags: ['dns', 'postgres'],
    updatedAt: '2026-04-01T09:00:00.000Z',
  },
];

function makeState(overrides = {}) {
  return {
    documents: DOCS,
    libraryQuery: '',
    librarySemantic: false,
    activeLibraryTags: [],
    libraryTypes: [],
    libraryTrust: [],
    libraryProjects: [],
    librarySortBy: 'updated',
    libraryView: 'active',
    projects: [
      { id: 'p1', slug: 'homelab', name: 'Homelab' },
      { id: 'p2', slug: 'work', name: 'Work' },
    ],
    navId: 'p1',
    semanticStatus: { available: false },
    semanticResults: null,
    ...overrides,
  };
}

function build(overrides = {}) {
  return buildLibraryModel(makeState(overrides), { now: NOW });
}

function render(overrides = {}) {
  const state = makeState(overrides);
  return renderLibraryHtml(state, buildLibraryModel(state, { now: NOW }));
}

// ---------------------------------------------------------------------------
// buildLibraryModel — filtering, sorting, grouping, flags
// ---------------------------------------------------------------------------

test('model applies the tag filter as an AND across active tags', () => {
  const model = build({ activeLibraryTags: ['postgres', 'backup'] });
  assert.equal(model.visibleCount, 1);
  assert.deepEqual(model.groups.flatMap((g) => g.docs.map((d) => d.id)), ['doc-restore']);
});

test('model keyword filter matches title, body, type, and tags case-insensitively', () => {
  const byBody = build({ libraryQuery: 'REPLICA' });
  assert.deepEqual(byBody.groups.flatMap((g) => g.docs.map((d) => d.id)), ['doc-restore']);

  const byTitle = build({ libraryQuery: 'failover' });
  assert.deepEqual(byTitle.groups.flatMap((g) => g.docs.map((d) => d.id)), ['doc-dns']);

  const byTag = build({ libraryQuery: 'homelab' });
  assert.deepEqual(byTag.groups.flatMap((g) => g.docs.map((d) => d.id)), ['doc-ideas']);

  const byType = build({ libraryQuery: 'runbook' });
  assert.equal(byType.visibleCount, 2);
});

test('model skips the keyword filter while semantic mode is on', () => {
  const model = build({ libraryQuery: 'replica', librarySemantic: true });
  assert.equal(model.visibleCount, DOCS.length);
});

test('model sorts by updatedAt (newest first) and by title', () => {
  const updated = build({});
  const runbooks = updated.groups.find((g) => g.label === 'Runbooks');
  assert.deepEqual(runbooks.docs.map((d) => d.id), ['doc-restore', 'doc-dns']);

  const titled = build({ librarySortBy: 'title' });
  const titledRunbooks = titled.groups.find((g) => g.label === 'Runbooks');
  assert.deepEqual(titledRunbooks.docs.map((d) => d.id), ['doc-dns', 'doc-restore']);
});

test('model groups documents Runbooks before Notes and drops empty groups', () => {
  const model = build({});
  assert.deepEqual(model.groups.map((g) => g.label), ['Runbooks', 'Notes']);

  const onlyRunbooks = build({ documents: [DOCS[0], DOCS[2]] });
  assert.deepEqual(onlyRunbooks.groups.map((g) => g.label), ['Runbooks']);
});

test('limitDocumentGroups bounds cards across type groups without losing full counts', () => {
  const collection = limitDocumentGroups([
    { label: 'Runbooks', docs: [DOCS[0], DOCS[2]] },
    { label: 'Notes', docs: [DOCS[1]] },
  ], 2);

  assert.equal(collection.shown, 2);
  assert.equal(collection.total, 3);
  assert.equal(collection.hasMore, true);
  assert.deepEqual(collection.groups.map((group) => [group.label, group.docs.length, group.totalCount]), [
    ['Runbooks', 2, 2],
  ]);
});

test('library rendering announces the bounded card set and offers explicit expansion', () => {
  const state = makeState();
  const html = renderLibraryHtml(state, buildLibraryModel(state, { limit: 2 }));

  assert.match(html, /Showing 2 of 3 documents/);
  assert.match(html, /data-action="show-more-library"[^>]*>Show 1 more/);
  assert.doesNotMatch(html, /data-document-id="doc-ideas"/);
});

test('model tag chips come from the pre-filter set with counts', () => {
  const model = build({ activeLibraryTags: ['backup'], libraryQuery: 'replica' });
  const tags = Object.fromEntries(model.tagChips.map(({ tag, count }) => [tag, count]));
  assert.equal(tags.postgres, 2);
  assert.equal(tags.backup, 1);
  assert.equal(tags.homelab, 1);
  assert.equal(tags.dns, 1);
});

test('model semantic flags: idle without query, active only once results landed', () => {
  const idle = build({ librarySemantic: true, libraryQuery: '' });
  assert.equal(idle.semanticIdle, true);
  assert.equal(idle.semanticActive, false);

  const pending = build({ librarySemantic: true, libraryQuery: 'db dies', semanticResults: null });
  assert.equal(pending.semanticIdle, false);
  assert.equal(pending.semanticActive, false);

  const active = build({ librarySemantic: true, libraryQuery: 'db dies', semanticResults: [] });
  assert.equal(active.semanticActive, true);
  assert.equal(active.semanticIdle, false);

  const keyword = build({ libraryQuery: 'db dies', semanticResults: [] });
  assert.equal(keyword.semanticActive, false);
});

test('semantic search renders an announced loading state instead of stale results', () => {
  const html = render({
    librarySemantic: true,
    libraryQuery: 'database recovery',
    semanticLoading: true,
    semanticResults: [{ id: 'old', title: 'Old result', snippet: 'stale' }],
  });
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /Searching by meaning/);
  assert.doesNotMatch(html, /Old result/);
});

test('model flags archive mode from state.libraryView', () => {
  assert.equal(build({}).archive, false);
  assert.equal(build({ libraryView: 'archive' }).archive, true);
});

test('semantic empty state prompts a re-index when nothing is embedded (the switch-provider gap)', () => {
  const html = render({
    librarySemantic: true, libraryQuery: 'db dies', semanticResults: [],
    semanticStatus: { available: true, connected: true, embeddedCount: 0, totalCount: 5 },
  });
  assert.match(html, /Nothing is embedded yet/);
  assert.match(html, /0 of 5/);
  assert.match(html, /data-action="reindex-embeddings"/);
});

test('semantic empty state shows an unavailable message when the backend errored', () => {
  const html = render({
    librarySemantic: true, libraryQuery: 'db dies', semanticResults: [], semanticError: true,
    semanticStatus: { available: true, connected: false, embeddedCount: 3, totalCount: 5 },
  });
  assert.match(html, /Semantic search is unavailable/);
  assert.match(html, /data-action="nav-settings"/);
  assert.doesNotMatch(html, /Nothing is embedded yet/);
});

test('semantic empty state is a genuine no-match when docs are embedded but nothing scored', () => {
  const html = render({
    librarySemantic: true, libraryQuery: 'db dies', semanticResults: [],
    semanticStatus: { available: true, connected: true, embeddedCount: 5, totalCount: 5 },
  });
  assert.match(html, /No matches by meaning/);
  assert.match(html, /5 embedded documents/);
  assert.doesNotMatch(html, /reindex-embeddings/);
});

test('semantic results render match cards when there are hits', () => {
  const html = render({
    librarySemantic: true, libraryQuery: 'db dies',
    semanticResults: [{ id: 'doc-1', title: 'Restore', similarity: 0.8, snippet: 'x' }],
    semanticStatus: { available: true, embeddedCount: 5, totalCount: 5 },
  });
  assert.match(html, /matched by meaning/);
  assert.match(html, /data-document-id="doc-1"/);
});

// ---------------------------------------------------------------------------
// renderLibraryHtml — header, search row, tag row
// ---------------------------------------------------------------------------

test('header keeps Ask Prax, ＋ New doc and a closed ⋯ overflow; the rest waits inside it', () => {
  const html = render();
  assert.match(html, /class="page-head__title">Library</);
  assert.match(html, /data-action="open-ask-prax"/);
  // ＋ New doc is a template chooser: the button toggles the menu; the menu's
  // items carry the actual new-document action (only when open).
  assert.match(html, /class="btn-primary"[^>]*data-action="toggle-new-doc-menu"[^>]*>＋ New doc</);
  assert.doesNotMatch(html, /data-action="new-document"/); // closed by default
  assert.match(html, /data-action="toggle-library-menu"[^>]*aria-haspopup="true"[^>]*aria-expanded="false"[^>]*aria-label="More library actions"/);
  for (const action of ['open-generate-runbook', 'open-health', 'generate-weekly-review', 'import-documents', 'export-library', 'toggle-library-view']) {
    assert.doesNotMatch(html, new RegExp(`data-action="${action}"`), `${action} stays behind the overflow until opened`);
  }
});

test('the ⋯ overflow, when open, lists every occasional action with its original data-action', () => {
  const html = render({ libraryMenuOpen: true });
  assert.match(html, /data-action="toggle-library-menu"[^>]*aria-expanded="true"/);
  assert.match(html, /class="menu__panel menu__panel--right" role="menu"/);
  assert.match(html, /class="menu__item"[^>]*data-action="open-generate-runbook"/);
  assert.match(html, /class="menu__item"[^>]*data-action="open-health"[^>]*>\s*Health/);
  assert.match(html, /class="menu__item"[^>]*data-action="generate-weekly-review"[^>]*>\s*Weekly review/);
  assert.match(html, /data-action="import-documents"[^>]*title="Choose Markdown files and their destination project"[^>]*>\s*Import Markdown…/);
  assert.match(html, /data-action="export-library"[^>]*title="Choose scope and where to save the Markdown archive"[^>]*>\s*Export…/);
  assert.match(html, /data-action="toggle-library-view"[^>]*aria-pressed="false"[^>]*>\s*Archive/);
});

test('Markdown intake opens a dedicated destination dialog instead of deriving ownership from navigation', () => {
  const html = render({ navId: 'p2', libraryMenuOpen: true });
  assert.match(html, /data-action="import-documents"[^>]*>\s*Import Markdown…/);
  assert.doesNotMatch(html, /Import plain \.md · Work|Import plain \.md · Homelab/);
  assert.doesNotMatch(html, /data-action="import-documents"[^>]*disabled/);
});

test('the ＋ New doc menu, when open, offers Blank note and Runbook templates', () => {
  const html = render({ newDocMenuOpen: true });
  assert.match(html, /class="menu__panel"/);
  assert.match(html, /data-action="new-document" data-template-id="note"[\s\S]*?Blank note/);
  assert.match(html, /data-action="new-document" data-template-id="runbook"[\s\S]*?Runbook/);
});

test('archive view flips the overflow toggle label to Active and says so in the header', () => {
  const html = render({ libraryView: 'archive', libraryMenuOpen: true });
  assert.match(html, /data-action="toggle-library-view"[^>]*aria-pressed="true"[^>]*>\s*Active/);
  assert.match(html, /class="page-head__sub">Archive</);
});

// ---- facets in the panel (wide windows) --------------------------------------

test('facetsInPanel drops the facet and tag rows and shows nothing when no filter is active', () => {
  const html = renderLibraryHtml(makeState(), buildLibraryModel(makeState()), { facetsInPanel: true });
  assert.doesNotMatch(html, /facet-row/);
  assert.doesNotMatch(html, /tag-row/);
  assert.doesNotMatch(html, /filter-row/);
  assert.match(html, /data-library-search/, 'search stays in the main view');
  // Narrow windows (default) keep the rows.
  const narrow = render();
  assert.match(narrow, /facet-row/);
  assert.match(narrow, /tag-row/);
});

test('facetsInPanel renders active filters as removable chips with the same toggle actions', () => {
  const state = makeState({ libraryTypes: ['runbook'], libraryTrust: ['verified'], libraryProjects: ['p2'], activeLibraryTags: ['postgres'] });
  const html = renderLibraryHtml(state, buildLibraryModel(state), { facetsInPanel: true });
  assert.match(html, /class="filter-row" aria-label="Active filters"/);
  assert.match(html, /class="filter-chip"[^>]*data-action="toggle-lib-type" data-facet="runbook" aria-label="Remove filter Type: Runbooks"/);
  assert.match(html, /data-action="toggle-lib-trust" data-facet="verified" aria-label="Remove filter Trust: Verified"/);
  assert.match(html, /data-action="toggle-lib-project" data-facet="p2" aria-label="Remove filter Project: Work"/);
  assert.match(html, /data-action="toggle-lib-tag" data-tag="postgres" aria-label="Remove filter #postgres"/);
  assert.match(html, /data-action="save-library-view"/);
  assert.match(html, /data-action="clear-lib-filters"[^>]*>Clear filters</);
});

test('facetsInPanel: in archive and semantic modes only tag chips remain, since type/trust/project do not apply there', () => {
  const state = makeState({ libraryView: 'archive', libraryTypes: ['runbook'], activeLibraryTags: ['dns'] });
  const html = renderLibraryHtml(state, buildLibraryModel(state), { facetsInPanel: true });
  assert.doesNotMatch(html, /data-facet="runbook"/);
  assert.match(html, /data-tag="dns"/);
});

test('libraryFacetCounts counts type, trust and project over the whole set', () => {
  const counts = libraryFacetCounts([
    ...DOCS,
    { id: 'v', documentType: 'note', projectId: 'p1', verified: true, kind: 'synthesized' },
  ]);
  assert.equal(counts.type.runbook, 2);
  assert.equal(counts.type.note, 2);
  assert.equal(counts.trust.verified, 1);
  assert.equal(counts.trust.agent, 1);
  assert.deepEqual(counts.project, { p1: 3, p2: 1 });
});

test('search input uses the keyword placeholder and search action hooks', () => {
  const html = render({ libraryQuery: 'backup' });
  assert.match(html, /data-library-search/);
  assert.match(html, /placeholder="Search titles, text, and tags…"/);
  assert.match(html, /value="backup"/);
  assert.match(html, /data-action="cycle-lib-sort"[^>]*>Sort: Updated</);
  assert.doesNotMatch(html, /class="lib-search is-semantic"/);
});

test('semantic mode switches the placeholder and marks the search row', () => {
  const html = render({
    librarySemantic: true,
    semanticStatus: { available: true, enabled: true },
  });
  assert.match(html, /class="lib-search is-semantic"/);
  assert.match(html, /placeholder="Ask in plain language — e\.g\. &quot;what do I do when the database dies&quot;"/);
});

test('semantic toggle renders only when available AND enabled, with is-on state', () => {
  const on = render({ semanticStatus: { available: true, enabled: true }, librarySemantic: true });
  assert.match(on, /data-action="toggle-semantic"/);
  assert.match(on, /class="btn-ghost is-on"[^>]*data-action="toggle-semantic"[^>]*aria-pressed="true"/);
  assert.match(on, /toggle-semantic[^>]*>[\s\S]*?<span>Semantic<\/span>/);

  const off = render({ semanticStatus: { available: true, enabled: true }, librarySemantic: false });
  assert.match(off, /class="btn-ghost"[^>]*data-action="toggle-semantic"[^>]*aria-pressed="false"/);

  assert.doesNotMatch(render({ semanticStatus: { available: false } }), /data-action="toggle-semantic"/);
  assert.doesNotMatch(
    render({ semanticStatus: { available: true, enabled: false } }),
    /data-action="toggle-semantic"/,
  );
});

test('sort cycler shows Title when sorting by title', () => {
  assert.match(render({ librarySortBy: 'title' }), /data-action="cycle-lib-sort"[^>]*>Sort: Title</);
});

test('tag row renders pills with counts and marks active tags', () => {
  const html = render({ activeLibraryTags: ['postgres'] });
  assert.match(html, /class="tag-pill is-active"[^>]*data-action="toggle-lib-tag"[^>]*data-tag="postgres"[^>]*aria-pressed="true"[^>]*>#postgres <span class="tag-pill__count">2<\/span></);
  assert.match(html, /class="tag-pill"[^>]*data-tag="homelab"[^>]*aria-pressed="false"/);
});

// The tag row folds its long tail: a library accumulates one-off tags faster
// than anything else, and rendering all of them pushed the documents below
// the fold. Ten most-used tags by default, the rest behind "+N more".
function manyTagDocs(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `t${i}`, title: `Doc ${i}`, body: '', documentType: 'note', projectId: 'p1', updatedAt: '2026-09-01T00:00:00Z',
    // tag0 appears on every doc, tag1 on all but one, … so the order is deterministic.
    tags: Array.from({ length: count - i }, (_, k) => `tag${k}`),
  }));
}

test('tag row folds beyond the ten most-used tags behind a "+N more" pill', () => {
  const html = render({ documents: manyTagDocs(15) });
  assert.match(html, /class="tag-row facet-group"><span class="facet-group__label">Tags<\/span>/);
  for (let i = 0; i < 10; i += 1) assert.match(html, new RegExp(`data-tag="tag${i}"`), `tag${i} (rank ${i + 1}) is shown`);
  for (let i = 10; i < 15; i += 1) assert.doesNotMatch(html, new RegExp(`data-tag="tag${i}"`), `tag${i} (rank ${i + 1}) is folded`);
  assert.match(html, /class="tag-pill tag-pill--more"[^>]*data-action="toggle-lib-tags"[^>]*aria-expanded="false"[^>]*>\+5 more</);
});

test('an active tag beyond the fold stays visible, and expanding shows every tag with a "Show fewer" pill', () => {
  const active = render({ documents: manyTagDocs(15), activeLibraryTags: ['tag14'] });
  assert.match(active, /class="tag-pill is-active"[^>]*data-tag="tag14"/, 'a filter the user cannot see is a filter they cannot clear');
  assert.match(active, />\+4 more</, 'the fold count excludes the pulled-forward active tag');

  const expanded = render({ documents: manyTagDocs(15), libraryTagsExpanded: true });
  for (let i = 0; i < 15; i += 1) assert.match(expanded, new RegExp(`data-tag="tag${i}"`));
  assert.match(expanded, /data-action="toggle-lib-tags"[^>]*aria-expanded="true"[^>]*>Show fewer</);
  assert.doesNotMatch(expanded, /more</);
});

test('a small tag set renders in full with no fold pill either way', () => {
  assert.doesNotMatch(render(), /toggle-lib-tags/);
  assert.doesNotMatch(render({ libraryTagsExpanded: true }), /toggle-lib-tags/);
});

test('Save view pill appears only while tags are active', () => {
  assert.match(render({ activeLibraryTags: ['postgres'] }), /data-action="save-library-view"[^>]*>＋ Save view</);
  assert.doesNotMatch(render(), /data-action="save-library-view"/);
});

// ---------------------------------------------------------------------------
// Keyword mode — grouped card grid
// ---------------------------------------------------------------------------

test('keyword mode renders group labels and doc cards with open-doc actions', () => {
  const html = render();
  assert.match(html, /class="group-label">Runbooks <span class="group-label__count">2<\/span></);
  assert.match(html, /class="group-label">Notes <span class="group-label__count">1<\/span></);
  assert.match(html, /class="doc-grid"/);
  assert.match(html, /class="doc-card"[^>]*data-action="open-doc"[^>]*data-document-id="doc-restore"/);
  assert.match(html, /class="doc-card__title">Restore CloudNativePG</);
  assert.match(html, /class="chip chip--type-runbook"[^>]*>RUNBOOK</);
  assert.match(html, /class="chip chip--type-note"[^>]*>NOTE</);
});

test('doc card excerpt is the first non-empty non-heading body line', () => {
  const html = render();
  assert.match(html, /class="doc-card__excerpt">Check backups nightly before promoting a replica\.</);
  assert.doesNotMatch(html, /doc-card__excerpt"># Restore/);
});

test('doc card renders tag chips and a short updated date', () => {
  const html = render();
  assert.match(html, /class="chip chip--tag"[^>]*>#postgres</);
  assert.match(html, /class="doc-card__updated">2026-05-18</);
});

test('browse cards show their owning project', () => {
  const html = render();
  const homelabCard = html.slice(html.indexOf('data-document-id="doc-restore"'), html.indexOf('data-document-id="doc-dns"'));
  const workCard = html.slice(html.indexOf('data-document-id="doc-ideas"'));
  assert.match(homelabCard, /chip chip--project[^>]*>Homelab</);
  assert.match(workCard, /chip chip--project[^>]*>Work</);
});

test('trust chips render exactly on qualifying cards', () => {
  const html = render({
    documents: [
      { ...DOCS[0], id: 'd-synth', kind: 'synthesized', stale: true },
      { ...DOCS[1], id: 'd-plain', kind: 'source' },
      { ...DOCS[2], id: 'd-trusted', verified: true, status: 'superseded' },
    ],
  });
  assert.equal((html.match(/chip--synth/g) || []).length, 1);
  assert.equal((html.match(/chip--stale/g) || []).length, 1);
  assert.equal((html.match(/chip--verified/g) || []).length, 1);
  assert.equal((html.match(/chip--superseded/g) || []).length, 1);
  assert.match(html, /class="chip chip--synth"[^>]*>SYNTH</);
  assert.match(html, /class="chip chip--stale"[^>]*>STALE</);
  assert.match(html, /class="chip chip--verified"[^>]*>VERIFIED</);
  assert.match(html, /class="chip chip--superseded"[^>]*>SUPERSEDED</);
  // Both chips sit on the synthesized+stale card, before the next card starts.
  const card = html.slice(html.indexOf('d-synth'), html.indexOf('d-plain'));
  assert.match(card, /chip--synth[\s\S]*chip--stale/);
});

test('plain source card renders no trust chips', () => {
  const html = render({ documents: [{ ...DOCS[1], kind: 'source', stale: false }] });
  assert.doesNotMatch(html, /chip--synth|chip--stale|chip--verified|chip--superseded/);
});

// ---------------------------------------------------------------------------
// Semantic states
// ---------------------------------------------------------------------------

test('semantic idle renders the ask-your-library empty state', () => {
  const html = render({
    librarySemantic: true,
    semanticStatus: { available: true, enabled: true },
  });
  assert.match(html, /class="empty"/);
  assert.match(html, /Ask your library a question/);
  assert.match(html, /Semantic search runs against your local index — results are ranked by meaning\./);
  assert.doesNotMatch(html, /class="doc-grid"/);
  assert.doesNotMatch(html, /class="sem-card"/);
});

test('semantic results render rank + snippet cards without fabricated scores', () => {
  const html = render({
    librarySemantic: true,
    libraryQuery: 'what do I do when the database dies',
    semanticStatus: { available: true, enabled: true },
    semanticResults: [
      { id: 'doc-restore', title: 'Restore CloudNativePG', documentType: 'runbook', projectId: 'p1', snippet: 'Check backups nightly before promoting a replica.' },
      { id: 'doc-ideas', title: 'Ideas', documentType: 'note', projectId: 'p2', snippet: 'General notes about the homelab.' },
    ],
  });
  assert.match(html, /class="sem-note">2 documents matched by meaning\.</);
  assert.match(html, /class="sem-list"/);
  assert.match(html, /class="sem-card"[^>]*data-action="open-doc"[^>]*data-document-id="doc-restore"/);
  assert.match(html, /class="sem-card__pct">#1</);
  assert.match(html, /class="sem-card__pct">#2</);
  assert.match(html, /class="sem-card__reason">Check backups nightly before promoting a replica\.</);
  assert.match(html, /sem-card[\s\S]*chip chip--type-runbook/);
  assert.match(html, /sem-card[\s\S]*chip chip--project[^>]*>Homelab</);
  // Fallback path: results carry no similarity, so the score label stays a
  // rank (#N) — no fabricated percentage in the score block.
  assert.doesNotMatch(html, /class="sem-card__pct">\d+%/);
  assert.doesNotMatch(html, /class="doc-grid"/);
});

test('semantic results show the real similarity as a percentage, bar scaled to the top hit', () => {
  const html = render({
    librarySemantic: true,
    libraryQuery: 'database recovery',
    semanticStatus: { available: true, enabled: true },
    semanticResults: [
      { id: 'a', title: 'Restore', documentType: 'runbook', snippet: 'restore', similarity: 0.82 },
      { id: 'b', title: 'Backups', documentType: 'note', snippet: 'backups', similarity: 0.41 },
    ],
  });
  // Real percentages (rounded), not ranks.
  assert.match(html, /class="sem-card__pct">82%</);
  assert.match(html, /class="sem-card__pct">41%</);
  assert.doesNotMatch(html, /class="sem-card__pct">#/);
  // Top hit fills the bar; the weaker one is scaled relative to it (0.41/0.82 = 50%).
  assert.match(html, /width:100%/);
  assert.match(html, /width:50%/);
  assert.match(html, /82% cosine similarity, ranked 1/);
});

test('semantic results report the exact total, expose trust, and offer deliberate pagination', () => {
  const html = render({
    librarySemantic: true,
    libraryQuery: 'database recovery',
    semanticStatus: { available: true, enabled: true },
    semanticResults: [{
      id: 'draft', title: 'Generated recovery note', documentType: 'note', snippet: 'draft',
      similarity: 0.8, kind: 'synthesized', stale: true, verified: false,
    }],
    semanticPage: { offset: 0, limit: 1, returned: 1, total: 3, hasMore: true, nextOffset: 1 },
  });
  assert.match(html, /1 of 3 documents matched by meaning/);
  assert.match(html, /chip--synth/);
  assert.match(html, /chip--stale/);
  assert.match(html, /chip--unverified[^>]*>UNVERIFIED/);
  assert.match(html, /data-action="load-more-semantic"/);
  assert.match(html, /\(1 of 3\)/);
});

test('semantic pagination keeps results usable while loading or after an append failure', () => {
  const base = {
    librarySemantic: true,
    libraryQuery: 'database recovery',
    semanticStatus: { available: true, enabled: true },
    semanticResults: [{ id: 'one', title: 'One', snippet: 'one' }],
    semanticPage: { offset: 0, limit: 1, returned: 1, total: 2, hasMore: true, nextOffset: 1 },
  };
  const loading = render({ ...base, semanticLoadingMore: true });
  assert.match(loading, /Loading more matches/);
  assert.match(loading, />One</);

  const failed = render({ ...base, semanticMoreError: true });
  assert.match(failed, /More matches could not be loaded/);
  assert.match(failed, /data-action="load-more-semantic"[^>]*>Try again/);
  assert.match(failed, />One</);
});

test('semantic results note is singular for one match and handles empty results', () => {
  const one = render({
    librarySemantic: true,
    libraryQuery: 'dns',
    semanticStatus: { available: true, enabled: true },
    semanticResults: [{ id: 'doc-dns', title: 'DNS failover', documentType: 'runbook', snippet: 'Switch resolvers.' }],
  });
  assert.match(one, /class="sem-note">1 document matched by meaning\.</);

  const none = render({
    librarySemantic: true,
    libraryQuery: 'zzz',
    semanticStatus: { available: true, enabled: true },
    semanticResults: [],
  });
  // Empty results are no longer a bare "0 matched" — with nothing embedded they
  // guide the user to re-index (see the dedicated empty-state tests above).
  assert.match(none, /Nothing is embedded yet/);
  assert.doesNotMatch(none, /class="sem-card"/);
});

// ---------------------------------------------------------------------------
// No-results + archive
// ---------------------------------------------------------------------------

test('keyword no-results renders empty state with clear filters and semantic hint', () => {
  const withSemantic = render({
    libraryQuery: 'zzz-no-match',
    semanticStatus: { available: true, enabled: true },
  });
  assert.match(withSemantic, /class="empty__title">No documents match</);
  assert.match(withSemantic, /flip on Semantic to search by meaning/);
  assert.match(withSemantic, /data-action="clear-lib-filters"[^>]*>Clear filters</);

  const withoutSemantic = render({ libraryQuery: 'zzz-no-match', semanticStatus: { available: false } });
  assert.match(withoutSemantic, /No documents match/);
  assert.match(withoutSemantic, /data-action="clear-lib-filters"/);
  assert.doesNotMatch(withoutSemantic, /Semantic/);
});

test('archive mode renders dim plain rows with restore and delete actions', () => {
  const html = render({
    libraryView: 'archive',
    documents: [{ ...DOCS[0], archivedAt: '2026-06-30T00:00:00.000Z' }],
  });
  assert.match(html, /class="rows"/);
  assert.match(html, /class="plain-row is-dim"/);
  assert.match(html, /class="plain-row__open"[^>]*type="button"[^>]*data-action="open-doc"[^>]*data-document-id="doc-restore"/);
  assert.match(html, /class="plain-row__title">Restore CloudNativePG</);
  assert.match(html, /plain-row[\s\S]*chip chip--type-runbook/);
  assert.match(html, /plain-row[\s\S]*chip chip--project[^>]*>Homelab</);
  assert.match(html, /class="btn-outline"[^>]*data-action="restore-document"[^>]*data-document-id="doc-restore"[^>]*>Restore</);
  assert.match(html, /class="btn-outline btn-outline--danger"[^>]*data-action="delete-document"[^>]*data-document-id="doc-restore"[^>]*>Delete</);
  assert.doesNotMatch(html, /class="doc-grid"/);
});

test('archive mode renders its empty state when nothing is archived', () => {
  const html = render({ libraryView: 'archive', documents: [] });
  assert.match(html, /No archived documents/);
  assert.doesNotMatch(html, /class="rows"/);
});

test('an empty library (no docs, no filters) shows the welcome, not the no-match dead end', () => {
  assert.equal(build({ documents: [] }).welcome, true);
  const html = render({ documents: [] });
  assert.match(html, /class="empty__title">Your library is empty</);
  assert.match(html, /data-action="new-document"/);
  assert.match(html, /data-action="import-documents"/);
  assert.doesNotMatch(html, /No documents match/);
  assert.doesNotMatch(html, /Clear filters/);
});

test('welcome does NOT show once a query, tag, semantic mode, or archive is active', () => {
  assert.equal(build({ documents: [], libraryQuery: 'x' }).welcome, false);
  assert.equal(build({ documents: [], activeLibraryTags: ['ops'] }).welcome, false);
  assert.equal(build({ documents: [], librarySemantic: true }).welcome, false);
  assert.equal(build({ documents: [], libraryView: 'archive' }).welcome, false);
  // And never when documents exist.
  assert.equal(build({}).welcome, false);
});

// ---------------------------------------------------------------------------
// XSS escaping
// ---------------------------------------------------------------------------

test('doc titles and tags are escaped', () => {
  const html = render({
    documents: [{
      id: 'doc-evil',
      title: '<script>alert("x")</script>',
      body: 'Body <script>alert("b")</script> line.',
      documentType: 'note',
      tags: ['<script>bad</script>'],
      updatedAt: '2026-06-01T00:00:00.000Z',
    }],
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(html, /#&lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(html, /Body &lt;script&gt;alert\(&quot;b&quot;\)&lt;\/script&gt; line\./);
});

test('semantic snippets and archive titles are escaped', () => {
  const sem = render({
    librarySemantic: true,
    libraryQuery: 'evil',
    semanticStatus: { available: true, enabled: true },
    semanticResults: [{ id: 'r1', title: '<script>t</script>', documentType: 'note', snippet: '<script>s</script>' }],
  });
  assert.doesNotMatch(sem, /<script>/);
  assert.match(sem, /class="sem-card__reason">&lt;script&gt;s&lt;\/script&gt;</);

  const archive = render({
    libraryView: 'archive',
    documents: [{ id: 'a1', title: '<script>a</script>', body: '', documentType: 'note', tags: [] }],
  });
  assert.doesNotMatch(archive, /<script>/);
  assert.match(archive, /class="plain-row__title">&lt;script&gt;a&lt;\/script&gt;</);
});

// ---- type + trust + project facets -------------------------------------------

test('facet row shows Type pills with counts while browsing', () => {
  const html = render();
  assert.match(html, /class="facet-row"/);
  assert.match(html, /facet-group__label">Type</);
  assert.match(html, /data-action="toggle-lib-type" data-facet="runbook"[^>]*>Runbooks <span class="facet-pill__count">2</);
  assert.match(html, /data-action="toggle-lib-type" data-facet="note"[^>]*>Notes <span class="facet-pill__count">1</);
});

test('Project facets show ownership counts and mark the selected project', () => {
  const html = render({ libraryProjects: ['p2'] });
  assert.match(html, /facet-group__label">Project</);
  assert.match(html, /data-action="toggle-lib-project" data-facet="p1"[^>]*>Homelab <span class="facet-pill__count">2</);
  assert.match(html, /class="facet-pill is-active"[^>]*data-action="toggle-lib-project" data-facet="p2"[^>]*aria-pressed="true"[^>]*>Work <span class="facet-pill__count">1</);
});

test('Project filtering is OR within its axis and AND with type/trust axes', () => {
  assert.deepEqual(build({ libraryProjects: ['p2'] }).groups.flatMap(group => group.docs).map(doc => doc.id), ['doc-ideas']);
  assert.equal(build({ libraryProjects: ['p1', 'p2'] }).visibleCount, 3);
  assert.deepEqual(
    build({ libraryProjects: ['p1'], libraryTypes: ['runbook'] }).groups.flatMap(group => group.docs).map(doc => doc.id),
    ['doc-restore', 'doc-dns'],
  );
});

test('the Trust group is omitted when no document carries a trust flag', () => {
  const html = render();
  assert.doesNotMatch(html, /facet-group__label">Trust</);
});

test('Trust facets appear (with counts) once documents carry the flags, and mark active', () => {
  const docs = [
    { id: 'v', title: 'V', documentType: 'note', tags: [], verified: true },
    { id: 's', title: 'S', documentType: 'note', tags: [], stale: true },
    { id: 'p', title: 'P', documentType: 'note', tags: [] },
  ];
  const html = render({ documents: docs, libraryTrust: ['verified'] });
  assert.match(html, /facet-group__label">Trust</);
  assert.match(html, /class="facet-pill is-active"[^>]*data-facet="verified"[^>]*aria-pressed="true"[^>]*>Verified <span class="facet-pill__count">1</);
  assert.match(html, /data-facet="stale"[^>]*aria-pressed="false"[^>]*>Stale <span class="facet-pill__count">1</);
  assert.doesNotMatch(html, /data-facet="superseded"/); // none superseded
});

test('the Agent-written trust facet appears (with count) when a doc is synthesized or agent-edited', () => {
  const docs = [
    { id: 'synth', title: 'S', documentType: 'note', tags: [], kind: 'synthesized', updatedBy: 'agent' },
    { id: 'human', title: 'H', documentType: 'note', tags: [], kind: 'source', updatedBy: 'user' },
  ];
  const html = render({ documents: docs, libraryTrust: ['agent'] });
  assert.match(html, /class="facet-pill is-active"[^>]*data-facet="agent"[^>]*aria-pressed="true"[^>]*>Agent-written <span class="facet-pill__count">1</);
});

test('selecting one type facet filters the visible docs to that type', () => {
  assert.equal(build().visibleCount, 3);
  assert.deepEqual(build({ libraryTypes: ['note'] }).groups.flatMap(g => g.docs).map(d => d.id), ['doc-ideas']);
  // both types selected = no narrowing (like "all")
  assert.equal(build({ libraryTypes: ['note', 'runbook'] }).visibleCount, 3);
});

test('trust facet narrows to matching docs (AND across type + trust axes)', () => {
  const docs = [
    { id: 'vr', title: 'VR', documentType: 'runbook', tags: [], verified: true },
    { id: 'vn', title: 'VN', documentType: 'note', tags: [], verified: true },
    { id: 'pr', title: 'PR', documentType: 'runbook', tags: [] },
  ];
  assert.deepEqual(build({ documents: docs, libraryTrust: ['verified'] }).groups.flatMap(g => g.docs).map(d => d.id), ['vr', 'vn']);
  // AND with type: verified runbooks only
  assert.deepEqual(build({ documents: docs, libraryTrust: ['verified'], libraryTypes: ['runbook'] }).groups.flatMap(g => g.docs).map(d => d.id), ['vr']);
});

test('facet row is hidden in archive and semantic modes', () => {
  assert.doesNotMatch(render({ libraryView: 'archive' }), /facet-row/);
  assert.doesNotMatch(render({ librarySemantic: true, semanticStatus: { available: true, enabled: true } }), /facet-row/);
});

test('semantic results disclose incomplete indexing even when matches exist', () => {
  const html = render({librarySemantic:true,libraryQuery:'recovery',semanticStatus:{available:true,enabled:true},semanticResults:[{id:'one',title:'One',snippet:'Current match'}],semanticIndex:{total:10,embedded:2,pending:8}});
  assert.match(html,/2 of 10 documents are current; 8 pending/);
  assert.match(html,/Re-index/);
});

// ---- table mode + review queue (year-one shell spec, item 7) ------------------

const AGENT_DOCS = [
  { id: 'a1', title: 'CNPG restore fails without listBuckets', documentType: 'known-issue', projectId: 'p1', tags: ['postgres'], updatedBy: 'agent', updatedByAgent: 'claude', verified: false, updatedAt: '2026-07-05T10:00:00.000Z' },
  { id: 'a2', title: 'Talos drain order', documentType: 'runbook', projectId: 'p1', tags: ['talos'], kind: 'synthesized', updatedByAgent: 'codex', verified: false, stale: true, updatedAt: '2026-07-04T10:00:00.000Z' },
  { id: 'a3', title: 'Verified memory', documentType: 'note', projectId: 'p2', tags: [], updatedBy: 'agent', updatedByAgent: 'claude', verified: true, updatedAt: '2026-07-03T10:00:00.000Z' },
  { id: 'a4', title: 'Superseded memory', documentType: 'note', projectId: 'p2', tags: [], updatedBy: 'agent', status: 'superseded', verified: false, updatedAt: '2026-07-02T10:00:00.000Z' },
  { id: 'a5', title: 'Archived memory', documentType: 'note', projectId: 'p2', tags: [], updatedBy: 'agent', verified: false, archivedAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T10:00:00.000Z' },
];

test('the review queue is unverified agent-written documents, minus superseded and archived', () => {
  assert.deepEqual(reviewQueue([...DOCS, ...AGENT_DOCS]).map(d => d.id), ['a1', 'a2']);
  assert.equal(isReviewQueueDoc(DOCS[0]), false, 'a human document is not queued');
  assert.equal(isReviewQueueDoc(null), false);
  assert.deepEqual(reviewQueueSummary([...DOCS, ...AGENT_DOCS]), {
    total: 2, stale: 1, byAgent: [{ agent: 'claude', count: 1 }, { agent: 'codex', count: 1 }],
  });
  assert.deepEqual(reviewQueueSummary([{ id: 'x', updatedBy: 'agent' }]).byAgent, [{ agent: 'agent', count: 1 }], 'no agent id falls back to "agent"');
});

test('the review view narrows the model to the queue, forces the table layout, and keeps facets applying', () => {
  const state = makeState({ documents: [...DOCS, ...AGENT_DOCS], libraryView: 'review' });
  const model = buildLibraryModel(state);
  assert.equal(model.review, true);
  assert.equal(model.layout, 'table');
  assert.deepEqual(model.groups.flatMap(g => g.docs).map(d => d.id).sort(), ['a1', 'a2']);
  assert.equal(model.queueCount, 2);
  assert.equal(model.reviewSummary.total, 2);
  assert.equal(model.welcome, false);
  const typed = buildLibraryModel(makeState({ documents: [...DOCS, ...AGENT_DOCS], libraryView: 'review', libraryTypes: ['runbook'] }));
  assert.deepEqual(typed.groups.flatMap(g => g.docs).map(d => d.id), ['a2']);
  assert.equal(buildLibraryModel(makeState({ documents: DOCS, libraryView: 'review' })).visibleCount, 0);
});

test('renderLibraryHtml in the review view: sub-line, banner with counts, table with Review buttons, no layout toggle', () => {
  const html = render({ documents: [...DOCS, ...AGENT_DOCS], libraryView: 'review' });
  assert.match(html, /class="page-head__sub">Review queue</);
  assert.match(html, /class="review-banner" role="status"/);
  assert.match(html, /chip chip--unverified">2 to review</);
  assert.match(html, /class="review-banner__agents">claude 1 · codex 1 · 1 stale</);
  assert.match(html, /data-action="select-visible-docs">Select shown</);
  assert.match(html, /class="btn-primary" type="button" data-action="review-next">Review next</);
  assert.match(html, /class="doc-table doc-table--review" role="table" aria-label="Review queue"/);
  assert.match(html, /data-action="review-doc" data-document-id="a1"/);
  assert.match(html, /class="doc-table__by">claude</);
  assert.match(html, /chip--unverified">UNVERIFIED</);
  assert.match(html, /chip--stale">STALE</);
  assert.doesNotMatch(html, /doc-card/);
  assert.doesNotMatch(html, /layout-toggle/);
  assert.doesNotMatch(html, /data-document-id="a3"/, 'verified documents are not in the queue');
});

test('an empty review queue distinguishes "clear" from "filtered out"', () => {
  const clear = render({ documents: DOCS, libraryView: 'review' });
  assert.match(clear, /The queue is clear/);
  assert.doesNotMatch(clear, /review-banner/);
  const filtered = render({ documents: [...DOCS, ...AGENT_DOCS], libraryView: 'review', libraryTypes: ['post-mortem'] });
  assert.match(filtered, /No queued documents match/);
  assert.match(filtered, /data-action="clear-lib-filters"/);
});

test('table layout in the browse view: a flat table of the visible documents, select-all, and Review only on unverified rows', () => {
  const html = render({ documents: [...DOCS, ...AGENT_DOCS.slice(0, 3)], libraryLayout: 'table' });
  assert.match(html, /class="doc-table" role="table" aria-label="Documents"/);
  assert.match(html, /class="doc-table__check" data-action="select-visible-docs" aria-pressed="false" aria-label="Select all 6 shown"/);
  assert.match(html, /class="doc-table__title" data-action="open-doc" data-document-id="doc-restore">Restore CloudNativePG</);
  assert.match(html, /class="doc-table__by">you</);
  assert.match(html, /data-document-id="a3"[^>]*>[\s\S]*?chip--verified">VERIFIED/);
  assert.doesNotMatch(html, /data-action="review-doc" data-document-id="a3"/, 'verified rows get no Review');
  assert.match(html, /data-action="review-doc" data-document-id="a1"/);
  assert.doesNotMatch(html, /doc-card/);
  assert.doesNotMatch(html, /review-banner/);
  // The toggle marks table active; cards stays the default.
  assert.match(html, /class="layout-toggle__btn is-active" data-action="set-library-layout" data-layout="table" aria-pressed="true"/);
  assert.match(render(), /class="layout-toggle__btn is-active" data-action="set-library-layout" data-layout="cards"/);
  assert.match(render(), /doc-card/);
  assert.doesNotMatch(render({ libraryView: 'archive' }), /layout-toggle/, 'archive keeps its rows');
});

test('selection: rows mark is-selected, select-all flips to clear, and the bulk bar offers Archive', () => {
  const docs = [...DOCS];
  const html = renderDocTable(docs, makeState({ librarySelectedDocIds: ['doc-ideas'] }));
  assert.match(html, /class="doc-table__row is-selected" role="row" data-document-id="doc-ideas"/);
  assert.match(html, /class="doc-table__check is-on" data-action="toggle-doc-selection" data-document-id="doc-ideas" aria-pressed="true" aria-label="Deselect Ideas"/);
  assert.match(html, /aria-label="Select Restore CloudNativePG"/);
  const all = renderDocTable(docs, makeState({ librarySelectedDocIds: docs.map(d => d.id) }));
  assert.match(all, /data-action="select-visible-docs" aria-pressed="true" aria-label="Clear selection">✓</);
  assert.equal(renderDocBulkBarHtml(makeState()), '');
  const bar = renderDocBulkBarHtml(makeState({ librarySelectedDocIds: ['a', 'b'] }));
  assert.match(bar, /aria-label="Bulk document actions"/);
  assert.match(bar, /class="bulkbar__count">2 selected</);
  assert.match(bar, /data-action="bulk-archive-docs">Archive</);
  assert.match(bar, /data-action="clear-doc-selection"/);
  assert.doesNotMatch(bar, /verify/i, 'verification never happens blind');
  assert.match(render({ librarySelectedDocIds: ['doc-ideas'] }), /bulkbar/, 'the page carries the bar');
});

test('the ⋯ overflow lists the review queue with its count', () => {
  const html = render({ documents: [...DOCS, ...AGENT_DOCS], libraryMenuOpen: true });
  assert.match(html, /data-action="open-review-queue" aria-pressed="false">\s*Review queue <span class="menu__count">2</);
  assert.doesNotMatch(render({ libraryMenuOpen: true }), /menu__count/, 'no badge when the queue is empty');
});
