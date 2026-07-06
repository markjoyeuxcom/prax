import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLibraryModel, renderLibraryHtml } from '../../public/js/renderLibrary.js';

const NOW = new Date('2026-07-06T12:00:00.000Z');

const DOCS = [
  {
    id: 'doc-restore',
    title: 'Restore CloudNativePG',
    body: '# Restore CloudNativePG\n\nCheck backups nightly before promoting a replica.',
    documentType: 'runbook',
    tags: ['postgres', 'backup'],
    updatedAt: '2026-05-18T10:00:00.000Z',
  },
  {
    id: 'doc-ideas',
    title: 'Ideas',
    body: 'General notes about the homelab.',
    documentType: 'note',
    tags: ['homelab'],
    updatedAt: '2026-06-02T11:00:00.000Z',
  },
  {
    id: 'doc-dns',
    title: 'DNS failover',
    body: '# DNS\n\nSwitch resolvers when upstream dies.',
    documentType: 'runbook',
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
    librarySortBy: 'updated',
    libraryView: 'active',
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

test('model flags archive mode from state.libraryView', () => {
  assert.equal(build({}).archive, false);
  assert.equal(build({ libraryView: 'archive' }).archive, true);
});

// ---------------------------------------------------------------------------
// renderLibraryHtml — header, search row, tag row
// ---------------------------------------------------------------------------

test('header renders title and import/export/archive/new actions', () => {
  const html = render();
  assert.match(html, /class="page-head__title">Library</);
  assert.match(html, /data-action="import-documents"[^>]*>Import \.md</);
  assert.match(html, /data-action="export-library"[^>]*>Export all</);
  assert.match(html, /data-action="toggle-library-view"[^>]*>Archive</);
  assert.match(html, /class="btn-primary"[^>]*data-action="new-document"[^>]*>＋ New doc</);
});

test('archive view flips the toggle label to Active', () => {
  const html = render({ libraryView: 'archive' });
  assert.match(html, /data-action="toggle-library-view"[^>]*aria-pressed="true"[^>]*>Active</);
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
      { id: 'doc-restore', title: 'Restore CloudNativePG', documentType: 'runbook', snippet: 'Check backups nightly before promoting a replica.' },
      { id: 'doc-ideas', title: 'Ideas', documentType: 'note', snippet: 'General notes about the homelab.' },
    ],
  });
  assert.match(html, /class="sem-note">2 documents matched by meaning\.</);
  assert.match(html, /class="sem-list"/);
  assert.match(html, /class="sem-card"[^>]*data-action="open-doc"[^>]*data-document-id="doc-restore"/);
  assert.match(html, /class="sem-card__pct">#1</);
  assert.match(html, /class="sem-card__pct">#2</);
  assert.match(html, /class="sem-card__reason">Check backups nightly before promoting a replica\.</);
  assert.match(html, /sem-card[\s\S]*chip chip--type-runbook/);
  // The API returns no similarity score — nothing in the page may show one.
  assert.doesNotMatch(html, /%/);
  assert.doesNotMatch(html, /class="doc-grid"/);
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
  assert.match(none, /class="sem-note">0 documents matched by meaning\.</);
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
  assert.match(html, /class="plain-row is-dim"[^>]*data-action="open-doc"[^>]*data-document-id="doc-restore"/);
  assert.match(html, /class="plain-row__title">Restore CloudNativePG</);
  assert.match(html, /plain-row[\s\S]*chip chip--type-runbook/);
  assert.match(html, /class="btn-outline"[^>]*data-action="restore-document"[^>]*data-document-id="doc-restore"[^>]*>Restore</);
  assert.match(html, /class="btn-outline btn-outline--danger"[^>]*data-action="delete-archived-document"[^>]*data-document-id="doc-restore"[^>]*>Delete</);
  assert.doesNotMatch(html, /class="doc-grid"/);
});

test('archive mode renders its empty state when nothing is archived', () => {
  const html = render({ libraryView: 'archive', documents: [] });
  assert.match(html, /No archived documents/);
  assert.doesNotMatch(html, /class="rows"/);
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
