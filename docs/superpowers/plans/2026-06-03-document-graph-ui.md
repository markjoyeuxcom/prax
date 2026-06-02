# Document graph UI surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the document graph visible in the console UI: read-only Links section
in the detail panel, inline `SYNTH` / `STALE` chips in the library list, and a new
Library Maintenance section in the Admin panel.

**Architecture:** One additive backend contract field (`stale: boolean` on the doc
list response) computed via a `left join lateral`. New frontend wiring fetches the
existing `/links?direction=both` and `/maintenance/stale|orphans` endpoints, plumbs
the data through `state.js` + `main.js`, and renders chips, the Links section, and
the Maintenance tables. CSS adds chip styles using the existing palette tokens
(`--accent` for `SYNTH`, `--accent-amber` for `STALE`).

**Tech Stack:** Node + Fastify + plain `pg` (backend), plain ES modules + template
literals (frontend, no bundler for the touched files), Node's built-in test runner,
existing `tests/frontend/` jsdom-free string-HTML pattern.

**Spec:** [`docs/superpowers/specs/2026-06-03-document-graph-ui-design.md`](../specs/2026-06-03-document-graph-ui-design.md)

**Target release:** v0.12.0 (single PR).

---

## File map

**Modify:**
- `server/libraryRepository.js` — `buildListDocuments` SQL gains a `left join lateral`
  computing `stale`. `normalizeDocumentRow` exposes `stale: row.stale ?? false`.
- `tests/contract/libraryFormat.test.js` — `FROZEN_DOC_KEYS` gains `stale`.
- `public/js/libraryApi.js` — new functions: `fetchDocumentLinks(id, direction)`,
  `fetchStaleDocuments(project)`, `fetchOrphanDocuments(project)`.
- `public/js/renderLibrary.js` — `renderDocumentRows` renders `SYNTH` / `STALE`
  chips; `renderDocumentDetail` header gets the `kind` badge; new helper
  `renderDocumentLinks` renders the Links section below the body.
- `public/js/renderAdminPanel.js` — `renderAdminPanelHtml` gains a "Library
  Maintenance" section showing stale + orphan tables.
- `public/js/state.js` — state shape gains `documentLinks` (per-doc), `staleDocs`,
  `orphanDocs`.
- `public/js/main.js` — on doc select, fetch links; on admin panel open, fetch
  stale/orphan; pass through to renderers.
- `public/styles.css` — new chip styles (`.chip-synth`, `.chip-stale`), Links
  section spacing, Maintenance tables.
- `scripts/demo-server.js` — `createMemoryLibraryRepository.listDocuments` computes
  `stale` per row using the in-memory link store.

**Create (tests):**
- `tests/backend/libraryRepository.stale.test.js` — builder + normalizer unit tests
  for `stale`.
- `tests/frontend/renderLibrary.stale.test.js` — list-row chip rendering.
- `tests/frontend/renderLibrary.detailLinks.test.js` — kind badge + updated_by +
  Links section.
- `tests/frontend/renderAdminPanel.maintenance.test.js` — Maintenance section
  rendering (empty + populated states).

---

## Task 1 — Backend: `stale` on the doc list response

**Files:**
- Modify: `server/libraryRepository.js`
- Modify: `tests/contract/libraryFormat.test.js`
- Create: `tests/backend/libraryRepository.stale.test.js`

- [ ] **Step 1: Write failing contract + builder tests**

Edit `tests/contract/libraryFormat.test.js` — extend `FROZEN_DOC_KEYS`:

```javascript
const FROZEN_DOC_KEYS = [
  'archivedAt', 'body', 'contentHash', 'createdAt', 'documentType', 'id',
  'kind', 'projectId', 'sourceFilename', 'stale', 'tags', 'title', 'updatedAt', 'updatedBy',
].sort();
```

Create `tests/backend/libraryRepository.stale.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDocumentRow } from '../../server/libraryRepository.js';

test('normalizeDocumentRow exposes stale=false when column absent', () => {
  const row = {
    id: 'id', title: 't', body: 'b', document_type: 'note',
    project_id: 'pid', tags: [], source_filename: null,
    archived_at: null, created_at: 'c', updated_at: 'u',
    content_hash: 'h', updated_by: 'user', kind: 'source',
  };
  assert.equal(normalizeDocumentRow(row).stale, false);
});

test('normalizeDocumentRow exposes stale=true when column true', () => {
  const row = {
    id: 'id', title: 't', body: 'b', document_type: 'note',
    project_id: 'pid', tags: [], source_filename: null,
    archived_at: null, created_at: 'c', updated_at: 'u',
    content_hash: 'h', updated_by: 'user', kind: 'source', stale: true,
  };
  assert.equal(normalizeDocumentRow(row).stale, true);
});

test('normalizeDocumentRow exposes stale=false when column false', () => {
  const row = {
    id: 'id', title: 't', body: 'b', document_type: 'note',
    project_id: 'pid', tags: [], source_filename: null,
    archived_at: null, created_at: 'c', updated_at: 'u',
    content_hash: 'h', updated_by: 'user', kind: 'source', stale: false,
  };
  assert.equal(normalizeDocumentRow(row).stale, false);
});
```

- [ ] **Step 2: Run failing tests**

Run: `npm test -- tests/backend/libraryRepository.stale.test.js tests/contract/libraryFormat.test.js`
Expected: FAIL — `normalizeDocumentRow` does not return `stale`.

- [ ] **Step 3: Update `normalizeDocumentRow`**

Edit `server/libraryRepository.js`. In `normalizeDocumentRow`, add a `stale` field:

```javascript
export function normalizeDocumentRow(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    documentType: row.document_type,
    projectId: row.project_id,
    tags: row.tags || [],
    sourceFilename: row.source_filename,
    archivedAt: toIso(row.archived_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    contentHash: row.content_hash ?? null,
    updatedBy: row.updated_by,
    kind: row.kind,
    stale: row.stale ?? false,
    ...(row.project_slug !== undefined ? { projectSlug: row.project_slug } : {}),
  };
}
```

- [ ] **Step 4: Add the lateral-join SQL to `listDocuments`**

Edit `server/libraryRepository.js`. In `createLibraryRepository.listDocuments` (the
method, not the export-for-list builder), change the SQL from `select * from markdown_documents …` to include the join:

```javascript
const result = await db.query(`
  select d.*, coalesce(s.is_stale, false) as stale
  from markdown_documents d
  left join lateral (
    select true as is_stale
    from document_links dl
    join markdown_documents tgt
      on tgt.id = dl.target_document_id and tgt.archived_at is null
    where dl.source_document_id = d.id
      and dl.relation = 'derived-from'
      and dl.target_hash is not null
      and tgt.content_hash is distinct from dl.target_hash
    limit 1
  ) s on true
  ${where ? where.replace('where ', 'where d.') /* see step below */ : ''}
  order by d.project_id, d.document_type, d.updated_at desc, d.title
`, values);
```

**Important nuance about the existing `where` builder:** the current method
constructs `clauses` like `project_id = $N`, `document_type = $N`, `kind = $N`, etc.,
without table aliases. The new lateral-join query introduces aliases (`d.` for the
documents table). The cleanest minimal change is to keep the per-clause SQL alias-
free and reference it as `d.<col>` instead — i.e. update the existing clause
builders to use the alias.

Concretely, rewrite the entire `listDocuments` method body:

```javascript
async listDocuments(filters = {}) {
  const clauses = [];
  const values = [];

  if (filters.projectId) {
    values.push(filters.projectId);
    clauses.push(`d.project_id = $${values.length}`);
  }
  if (filters.documentType) {
    values.push(filters.documentType);
    clauses.push(`d.document_type = $${values.length}`);
  }
  if (filters.kind) {
    values.push(filters.kind);
    clauses.push(`d.kind = $${values.length}`);
  }
  if (filters.q) {
    const terms = String(filters.q).toLowerCase().match(/[a-z0-9]+/g) || [];
    if (terms.length) {
      values.push(terms.map(term => `${term}:*`).join(' & '));
      clauses.push(`to_tsvector('english', coalesce(d.title, '') || ' ' || coalesce(d.body, '')) @@ to_tsquery('english', $${values.length})`);
    }
  }
  if (filters.archived === true || filters.archived === 'true') {
    clauses.push('d.archived_at is not null');
  } else if (filters.archived !== 'all') {
    clauses.push('d.archived_at is null');
  }

  const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
  const result = await db.query(`
    select d.*, coalesce(s.is_stale, false) as stale
    from markdown_documents d
    left join lateral (
      select true as is_stale
      from document_links dl
      join markdown_documents tgt
        on tgt.id = dl.target_document_id and tgt.archived_at is null
      where dl.source_document_id = d.id
        and dl.relation = 'derived-from'
        and dl.target_hash is not null
        and tgt.content_hash is distinct from dl.target_hash
      limit 1
    ) s on true
    ${where}
    order by d.project_id, d.document_type, d.updated_at desc, d.title
  `, values);
  return result.rows.map(normalizeDocumentRow);
},
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/backend/libraryRepository.stale.test.js tests/contract/libraryFormat.test.js`
Expected: PASS.

Run: `npm test`
Expected: full suite PASS. (`normalizeDocumentRow` returns `stale: false` for every
existing test fixture row that doesn't include a `stale` column — backward
compatible.)

- [ ] **Step 6: Commit**

```bash
git add server/libraryRepository.js tests/backend/libraryRepository.stale.test.js \
        tests/contract/libraryFormat.test.js
git commit -m "Backend: stale boolean on doc list response

GET /api/library/documents now returns a per-row \`stale\` field
computed via a left-join lateral over derived-from links whose target
content_hash has moved past the snapshot. normalizeDocumentRow exposes
the field with a false fallback so by-id paths (which don't run the
join) stay valid. Contract lock updated.
"
```

---

## Task 2 — Library API client: new fetchers

**Files:**
- Modify: `public/js/libraryApi.js`
- Modify: `tests/frontend/libraryApi.test.js`

- [ ] **Step 1: Write failing API client tests**

Read `tests/frontend/libraryApi.test.js` first to see how existing fetch mocks are
set up (look for `global.fetch` replacement). Then append three new tests:

```javascript
test('fetchDocumentLinks calls the links endpoint with direction', async () => {
  let captured;
  global.fetch = async (url) => {
    captured = url;
    return { ok: true, json: async () => [] };
  };
  await fetchDocumentLinks('doc-1', 'both');
  assert.equal(captured, '/api/library/documents/doc-1/links?direction=both');
});

test('fetchStaleDocuments calls the maintenance endpoint with project', async () => {
  let captured;
  global.fetch = async (url) => {
    captured = url;
    return { ok: true, json: async () => [] };
  };
  await fetchStaleDocuments('homelab');
  assert.equal(captured, '/api/library/maintenance/stale?project=homelab');
});

test('fetchOrphanDocuments omits empty project', async () => {
  let captured;
  global.fetch = async (url) => {
    captured = url;
    return { ok: true, json: async () => [] };
  };
  await fetchOrphanDocuments('');
  assert.equal(captured, '/api/library/maintenance/orphans');
});
```

…and add the new functions to the import line at the top.

- [ ] **Step 2: Run failing tests**

Run: `npm test -- tests/frontend/libraryApi.test.js`
Expected: FAIL — the three new functions don't exist.

- [ ] **Step 3: Add the new functions to `libraryApi.js`**

Append to `public/js/libraryApi.js`:

```javascript
export async function fetchDocumentLinks(id, direction = 'both') {
  const response = await fetch(`/api/library/documents/${id}/links?direction=${encodeURIComponent(direction)}`);
  if (!response.ok) throw new Error('Failed to load document links');
  return response.json();
}

export async function fetchStaleDocuments(project = '') {
  const qs = project ? `?project=${encodeURIComponent(project)}` : '';
  const response = await fetch(`/api/library/maintenance/stale${qs}`);
  if (!response.ok) throw new Error('Failed to load stale documents');
  return response.json();
}

export async function fetchOrphanDocuments(project = '') {
  const qs = project ? `?project=${encodeURIComponent(project)}` : '';
  const response = await fetch(`/api/library/maintenance/orphans${qs}`);
  if (!response.ok) throw new Error('Failed to load orphan documents');
  return response.json();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/frontend/libraryApi.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/js/libraryApi.js tests/frontend/libraryApi.test.js
git commit -m "Library API client: fetchers for links + stale + orphan

Three new exports: fetchDocumentLinks(id, direction),
fetchStaleDocuments(project), fetchOrphanDocuments(project). Wraps the
existing HTTP endpoints with the same error-handling shape as the
sibling fetchers.
"
```

---

## Task 3 — List row: SYNTH + STALE chips

**Files:**
- Modify: `public/js/renderLibrary.js`
- Create: `tests/frontend/renderLibrary.stale.test.js`

- [ ] **Step 1: Write failing render tests**

Create `tests/frontend/renderLibrary.stale.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLibraryHtml } from '../../public/js/renderLibrary.js';

function row(overrides) {
  return {
    id: overrides.id || 'd1',
    title: overrides.title || 'Doc',
    documentType: 'note',
    sourceFilename: null,
    tags: [],
    kind: overrides.kind || 'source',
    stale: overrides.stale ?? false,
  };
}

test('SYNTH chip renders only on synthesized rows', () => {
  const html = renderLibraryHtml({ documents: [
    row({ id: 'a', title: 'src', kind: 'source' }),
    row({ id: 'b', title: 'syn', kind: 'synthesized' }),
  ]});
  // Naive proxy: count occurrences of chip-synth class.
  const matches = html.match(/chip-synth/g) || [];
  assert.equal(matches.length, 1, 'exactly one synthesized row should render the chip');
  assert.ok(html.includes('SYNTH'), 'chip label appears');
});

test('STALE pill renders only on stale rows', () => {
  const html = renderLibraryHtml({ documents: [
    row({ id: 'a', title: 'fresh', stale: false }),
    row({ id: 'b', title: 'old', stale: true }),
  ]});
  const matches = html.match(/chip-stale/g) || [];
  assert.equal(matches.length, 1, 'exactly one stale row should render the pill');
  assert.ok(html.includes('STALE'), 'pill label appears');
});

test('source non-stale row renders neither chip', () => {
  const html = renderLibraryHtml({ documents: [row({ id: 'a', title: 'clean' })] });
  assert.equal(html.includes('chip-synth'), false);
  assert.equal(html.includes('chip-stale'), false);
});
```

- [ ] **Step 2: Run failing tests**

Run: `npm test -- tests/frontend/renderLibrary.stale.test.js`
Expected: FAIL — chips not rendered.

- [ ] **Step 3: Update `renderDocumentRows` in `renderLibrary.js`**

Edit `public/js/renderLibrary.js`. Replace `renderDocumentRows`:

```javascript
function renderDocumentRows(documents, activeDocumentId) {
  return documents.map((document) => {
    const isSelected = document.id === activeDocumentId;
    const isSynthesized = document.kind === 'synthesized';
    const isStale = document.stale === true;
    return `
      <button class="document-row${isSelected ? ' is-selected' : ''}" type="button" data-library-document-id="${escapeHtml(document.id)}"${isSelected ? ' aria-current="true"' : ''}>
        <span>
          <strong>${escapeHtml(document.title || 'Untitled document')}${isSynthesized ? ' <span class="chip chip-synth" aria-label="Agent synthesized">SYNTH</span>' : ''}${isStale ? ' <span class="chip chip-stale" aria-label="Derived source has changed">STALE</span>' : ''}</strong>
          <small>${escapeHtml(labelFromValue(document.documentType || 'note'))} &middot; ${escapeHtml(document.sourceFilename || 'Created in Moomora Console')}</small>
        </span>
        <span class="document-tags">${renderTags(document.tags)}</span>
      </button>`;
  }).join('');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/frontend/renderLibrary.stale.test.js`
Expected: PASS.

Run: `npm test`
Expected: full suite PASS. (Existing `renderLibrary.test.js` fixtures don't set
`kind: 'synthesized'` or `stale: true`, so no chips render — no regression.)

- [ ] **Step 5: Commit**

```bash
git add public/js/renderLibrary.js tests/frontend/renderLibrary.stale.test.js
git commit -m "Library list: SYNTH chip on synthesized rows, STALE pill on stale

renderDocumentRows conditionally appends a <span class=\"chip chip-synth\">
for kind=synthesized rows and <span class=\"chip chip-stale\"> for
stale=true rows, inline with the title. Source non-stale rows render
unchanged. Chips carry aria-label for screen readers.
"
```

---

## Task 4 — Detail panel: kind badge, updated_by, Links section

**Files:**
- Modify: `public/js/renderLibrary.js`
- Create: `tests/frontend/renderLibrary.detailLinks.test.js`

- [ ] **Step 1: Write failing detail-panel tests**

Create `tests/frontend/renderLibrary.detailLinks.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLibraryHtml } from '../../public/js/renderLibrary.js';

const baseDoc = {
  id: 'doc-1',
  title: 'Postgres restore',
  body: '# r',
  documentType: 'runbook',
  projectId: 'p1',
  tags: ['postgres'],
  sourceFilename: null,
  archivedAt: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  kind: 'source',
  updatedBy: 'user',
  stale: false,
};

test('detail header shows the kind badge', () => {
  const html = renderLibraryHtml({
    documents: [{ ...baseDoc, kind: 'synthesized' }],
    selectedDocumentId: 'doc-1',
  });
  assert.ok(html.includes('chip-kind'));
  assert.ok(html.includes('SYNTHESIZED'));
});

test('detail header shows updated_by line', () => {
  const html = renderLibraryHtml({
    documents: [{ ...baseDoc, updatedBy: 'agent' }],
    selectedDocumentId: 'doc-1',
  });
  assert.match(html, /Updated by[\s\S]*agent/);
});

test('Links section renders outbound and inbound entries', () => {
  const html = renderLibraryHtml({
    documents: [baseDoc],
    selectedDocumentId: 'doc-1',
    documentLinks: [
      { documentId: 't1', title: 'Source A', relation: 'derived-from', direction: 'outbound' },
      { documentId: 't2', title: 'Derivation B', relation: 'derived-from', direction: 'inbound' },
    ],
  });
  assert.ok(html.includes('Derived from'));
  assert.ok(html.includes('Backlinks'));
  assert.ok(html.includes('Source A'));
  assert.ok(html.includes('Derivation B'));
});

test('Links section renders empty state when no links', () => {
  const html = renderLibraryHtml({
    documents: [baseDoc],
    selectedDocumentId: 'doc-1',
    documentLinks: [],
  });
  assert.ok(html.includes('No links'));
});
```

- [ ] **Step 2: Run failing tests**

Run: `npm test -- tests/frontend/renderLibrary.detailLinks.test.js`
Expected: FAIL — no kind badge / updated_by / Links section yet, plus
`documentLinks` isn't a known option of `renderLibraryHtml`.

- [ ] **Step 3: Add the `kind` badge + `updated_by` to `renderDocumentDetail`**

Edit `public/js/renderLibrary.js`. In `renderDocumentDetail`, update the header.
Find the `<header class="detail-header">` block and replace it:

```javascript
  return `
    <aside class="detail-panel library-detail${isFocusMode ? ' is-focus-mode' : ''}" aria-labelledby="selected-document-title">
      <header class="detail-header">
        ${options.isLibraryDocOpen ? `<button class="detail-back bracket-button bracket-button--quiet" type="button" data-action="close-library-doc" aria-label="Back">← back</button>` : ''}
        <span class="detail-kicker">${escapeHtml(labelFromValue(document.documentType || 'note'))}</span>
        <h2 id="selected-document-title">${escapeHtml(document.title || 'Untitled document')} ${renderKindBadge(document.kind)}</h2>
        <p>${escapeHtml(document.sourceFilename || 'Created in Moomora Console')}</p>
        <p class="detail-meta">Updated by ${escapeHtml(document.updatedBy || 'user')}</p>
        <div class="document-tags">${renderTags(document.tags)}</div>
        <div class="detail-actions">
          ${isArchived ? '' : renderModes(editorMode)}
          ${isArchived ? '' : '<button class="bracket-button" type="button" data-action="edit-document-info">[i] info</button>'}
          ${isArchived ? `
          <button class="bracket-button" type="button" data-action="restore-document">[r] restore</button>
          <button class="bracket-button bracket-button--danger" type="button" data-action="delete-archived-document">[!] delete</button>` : `
          <button class="bracket-button bracket-button--danger" type="button" data-action="archive-document">[d] archive</button>`}
        </div>
      </header>
      ${isInfoEditing ? renderDocumentInfoForm(document, { error: options.infoError, isSaving: options.isSaving }) : `
      <div class="document-workspace document-workspace--${escapeHtml(editorMode)}${isFocusMode ? ' document-workspace--focused' : ''}">${editorVisible ? renderEditorPane(body, { isDirty, saveStatus: options.saveStatus, isFocusMode, documentId: document.id, isArchived }) : ''}${previewVisible ? renderPreviewPane(body) : ''}
      </div>`}
      ${renderDocumentLinks(options.documentLinks)}
    </aside>`;
```

Add the two new helpers above `renderDocumentDetail` (anywhere in the file is fine —
keep them near `renderDocumentDetail`):

```javascript
function renderKindBadge(kind) {
  const safeKind = kind === 'synthesized' ? 'synthesized' : 'source';
  const label = safeKind === 'synthesized' ? 'SYNTHESIZED' : 'SOURCE';
  return `<span class="chip chip-kind chip-kind--${safeKind}" aria-label="Document kind: ${safeKind}">${label}</span>`;
}

function renderDocumentLinks(links) {
  if (links === undefined) return ''; // not loaded yet — render nothing
  const list = Array.isArray(links) ? links : [];
  if (list.length === 0) {
    return `<section class="document-links" aria-labelledby="document-links-heading">
      <h3 id="document-links-heading">Links</h3>
      <p class="document-links-empty">No links.</p>
    </section>`;
  }
  const outbound = list.filter((l) => l.direction === 'outbound');
  const inbound = list.filter((l) => l.direction === 'inbound');
  const derivedFrom = outbound.filter((l) => l.relation === 'derived-from');
  const supersedes = outbound.filter((l) => l.relation === 'supersedes');

  const groupHtml = (label, entries, showRelation) => entries.length === 0 ? '' : `
    <div class="document-links-group">
      <h4>${label}</h4>
      <ul>${entries.map((e) => `
        <li>
          <button class="text-action document-link-open" type="button" data-action="open-library-doc" data-library-document-id="${escapeHtml(e.documentId)}">${escapeHtml(e.title || 'Untitled')}</button>
          ${showRelation ? `<small>(${escapeHtml(e.relation)})</small>` : ''}
        </li>`).join('')}
      </ul>
    </div>`;

  return `<section class="document-links" aria-labelledby="document-links-heading">
    <h3 id="document-links-heading">Links</h3>
    ${groupHtml('Derived from', derivedFrom, false)}
    ${groupHtml('Supersedes', supersedes, false)}
    ${groupHtml('Backlinks', inbound, true)}
  </section>`;
}
```

In `renderLibraryHtml` (the export), thread the new `documentLinks` option through
to the detail call. Find the `renderLibraryHtml({ documents = [], ... } = {})`
signature and add `documentLinks = undefined,` to the destructure. Then pass it to
`renderDocumentDetail`:

```javascript
<div class="library-document-stage">${renderDocumentDetail(document, { editorMode: activeMode, draftBody, isDirty, isInfoEditing, infoError, isSaving, saveStatus, isFocusMode, isLibraryDocOpen, documentLinks })}
</div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/frontend/renderLibrary.detailLinks.test.js`
Expected: PASS.

Run: `npm test`
Expected: full suite PASS. The existing `renderLibrary.test.js` may have tests that
match against the old header layout — if any fail, they need updating to allow the
new `chip-kind` span and `detail-meta` paragraph. Keep those updates surgical: add
the new strings to expected output, do not change test intent.

- [ ] **Step 5: Commit**

```bash
git add public/js/renderLibrary.js tests/frontend/renderLibrary.detailLinks.test.js
git commit -m "Library detail: kind badge, updated_by, Links section

renderDocumentDetail header now renders a SOURCE / SYNTHESIZED kind
badge alongside the title, and an \"Updated by\" line in the metadata
block. A new Links section renders below the body, grouped by
direction (Derived from / Supersedes outbound, Backlinks inbound).
\`documentLinks\` flows through renderLibraryHtml as an undefined-by-
default option so existing callers that don't supply it render
nothing (no premature empty state).
"
```

---

## Task 5 — Detail-panel state plumbing: fetch links on selection

**Files:**
- Modify: `public/js/state.js`
- Modify: `public/js/main.js`

The renderer accepts `documentLinks`; main.js needs to fetch and store them when a
document is selected.

- [ ] **Step 1: Add `documentLinks` to state shape**

Read `public/js/state.js` first to learn the existing pattern (look for the
exported initial state object or factory). Then add a `documentLinks` field — a
plain array, initially `null` (meaning "not yet fetched for the current selection").

Concretely, in whichever pattern `state.js` follows:

```javascript
// In the state default object:
documentLinks: null,  // null = not yet fetched; [] = fetched, empty; [...] = entries
```

If the file uses a setter pattern, add a `setDocumentLinks(links)` setter.

- [ ] **Step 2: Wire fetch in `main.js` when a document is selected**

Read `public/js/main.js` around the document-selection handler (search for
`data-library-document-id` or `selectedDocumentId`). The pattern: when the
selection changes, fetch the links, store them in state, re-render the workspace.

Add `fetchDocumentLinks` to the libraryApi import at the top of `main.js`:

```javascript
import { fetchDocumentLinks, /* existing imports */ } from './libraryApi.js';
```

In the selection-change handler (wherever `state.selectedDocumentId` is set),
after the state update, kick off the fetch:

```javascript
async function loadDocumentLinks(documentId) {
  if (!documentId) {
    state.documentLinks = null;  // or setDocumentLinks(null)
    return;
  }
  try {
    const links = await fetchDocumentLinks(documentId, 'both');
    if (state.selectedDocumentId === documentId) {
      state.documentLinks = links;
      renderLibraryWorkspace(...);  // existing re-render call
    }
  } catch (err) {
    console.error('Failed to load document links', err);
  }
}
```

And pass `documentLinks: state.documentLinks` into the `renderLibraryHtml` call in
`renderLibraryWorkspace`:

```javascript
workspace.innerHTML = renderLibraryHtml({
  // ...existing options...
  documentLinks: state.documentLinks,
});
```

Hook `loadDocumentLinks(state.selectedDocumentId)` after every place the selection
changes (e.g. clicking a row, navigating from a link).

- [ ] **Step 3: Reset `documentLinks` when selection changes**

When a different doc is selected, immediately set `documentLinks` to `null` (so the
stale data from the previous selection doesn't render), then kick off the new
fetch. The renderer treats `null` (= `undefined`) as "render nothing yet."

- [ ] **Step 4: Manual smoke**

Run: `npm run demo` (background).
Open: `http://127.0.0.1:3100/`
Create two docs, link one derived-from the other (via curl or MCP), reopen the UI,
click each doc. Confirm:
- The doc with no links shows "No links."
- The doc with a derived-from link shows the target under "Derived from".
- The doc that's a target of a derived-from link shows the source under "Backlinks".

Stop the demo when satisfied.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: full suite green.

- [ ] **Step 6: Commit**

```bash
git add public/js/state.js public/js/main.js
git commit -m "Detail panel: fetch document links on selection change

State gains documentLinks. main.js's selection handler kicks off a
fetchDocumentLinks call and re-renders the workspace when the result
arrives. Selection-stale guard: only apply the result if the
selectedDocumentId still matches by the time the promise settles.
"
```

---

## Task 6 — Admin panel: Library Maintenance section + wiring

**Files:**
- Modify: `public/js/renderAdminPanel.js`
- Modify: `public/js/state.js`
- Modify: `public/js/main.js`
- Create: `tests/frontend/renderAdminPanel.maintenance.test.js`

- [ ] **Step 1: Write failing admin-panel render tests**

Create `tests/frontend/renderAdminPanel.maintenance.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAdminPanelHtml } from '../../public/js/renderAdminPanel.js';

test('Maintenance section renders empty states by default', () => {
  const html = renderAdminPanelHtml({});
  assert.ok(html.includes('Library Maintenance'));
  assert.ok(html.includes('No stale documents'));
  assert.ok(html.includes('No orphan documents'));
});

test('Maintenance section renders stale rows', () => {
  const html = renderAdminPanelHtml({
    staleDocs: [
      { documentId: 'd1', title: 'Old summary', documentType: 'note', kind: 'synthesized', updatedBy: 'user', staleSources: [{ title: 'Source' }] },
    ],
  });
  assert.ok(html.includes('Old summary'));
  assert.ok(html.includes('Source'));
  assert.ok(html.match(/data-action="open-library-doc"[^>]*data-library-document-id="d1"/));
});

test('Maintenance section renders orphan rows', () => {
  const html = renderAdminPanelHtml({
    orphanDocs: [
      { documentId: 'd2', title: 'Sprint notes', documentType: 'note', kind: 'source' },
    ],
  });
  assert.ok(html.includes('Sprint notes'));
  assert.ok(html.match(/data-library-document-id="d2"/));
});
```

- [ ] **Step 2: Run failing tests**

Run: `npm test -- tests/frontend/renderAdminPanel.maintenance.test.js`
Expected: FAIL — the section doesn't exist.

- [ ] **Step 3: Add the Maintenance section to `renderAdminPanelHtml`**

Edit `public/js/renderAdminPanel.js`. Extend the destructured options:

```javascript
export function renderAdminPanelHtml({
  activeProject = 'all',
  projects = [],
  taskCount = 0,
  documentCount = 0,
  importMode = 'skip',
  staleDocs = [],
  orphanDocs = [],
} = {}) {
```

Inside `admin-sections`, after the existing `Archive Maintenance` section, append:

```html
<section class="admin-section" aria-labelledby="library-maintenance-title">
  <div>
    <h3 id="library-maintenance-title">Library Maintenance</h3>
    <p>Stale and orphan documents in the library graph.</p>
  </div>

  <div class="admin-subsection">
    <h4>Stale documents</h4>
    <p class="admin-help">Documents whose derived-from source has changed since the link was created.</p>
    ${staleDocs.length === 0 ? '<p class="admin-empty">No stale documents.</p>' : `
    <ul class="admin-doc-list">${staleDocs.map((d) => `
      <li>
        <div>
          <strong>${escapeHtml(d.title || 'Untitled')}</strong>
          <small>${escapeHtml(labelFromValue(d.documentType || 'note'))} · kind: ${escapeHtml(d.kind || 'source')} · updated by ${escapeHtml(d.updatedBy || 'user')}</small>
          ${Array.isArray(d.staleSources) && d.staleSources.length > 0 ? `<small>Stale sources: ${d.staleSources.map((s) => escapeHtml(s.title || '')).join(', ')}</small>` : ''}
        </div>
        <button class="bracket-button bracket-button--quiet" type="button" data-action="open-library-doc" data-library-document-id="${escapeHtml(d.documentId)}">[open]</button>
      </li>`).join('')}
    </ul>`}
  </div>

  <div class="admin-subsection">
    <h4>Orphan documents</h4>
    <p class="admin-help">Documents with no inbound or outbound links.</p>
    ${orphanDocs.length === 0 ? '<p class="admin-empty">No orphan documents.</p>' : `
    <ul class="admin-doc-list">${orphanDocs.map((d) => `
      <li>
        <div>
          <strong>${escapeHtml(d.title || 'Untitled')}</strong>
          <small>${escapeHtml(labelFromValue(d.documentType || 'note'))} · kind: ${escapeHtml(d.kind || 'source')}</small>
        </div>
        <button class="bracket-button bracket-button--quiet" type="button" data-action="open-library-doc" data-library-document-id="${escapeHtml(d.documentId)}">[open]</button>
      </li>`).join('')}
    </ul>`}
  </div>
</section>
```

(`labelFromValue` already exists in `renderAdminPanel.js`.)

- [ ] **Step 4: Wire fetch in `main.js` when admin panel opens**

Add `fetchStaleDocuments, fetchOrphanDocuments` to the libraryApi import in
`main.js`. In `state.js`, add:

```javascript
staleDocs: [],
orphanDocs: [],
```

In `main.js`, find the admin-panel-open handler (search for
`data-action="open-admin"` — already grepped to line 1601). After the panel renders,
kick off both fetches with the current project filter. When they return, re-render
the panel:

```javascript
async function loadMaintenanceLists() {
  const projectId = state.activeProject === 'all' ? '' : state.activeProject;
  try {
    const [stale, orphans] = await Promise.all([
      fetchStaleDocuments(projectId),
      fetchOrphanDocuments(projectId),
    ]);
    state.staleDocs = stale;
    state.orphanDocs = orphans;
    renderAdminPanel();
  } catch (err) {
    console.error('Failed to load maintenance lists', err);
  }
}
```

`renderAdminPanel()` should be the existing function that calls
`renderAdminPanelHtml`; extend its options to include `staleDocs: state.staleDocs,
orphanDocs: state.orphanDocs`. Hook `loadMaintenanceLists()` whenever the admin
panel opens.

- [ ] **Step 5: Wire `data-action="open-library-doc"` from the admin maintenance section**

The existing `open-library-doc` action handler (already used by the detail panel's
"back" → list flow) needs to also work from the admin panel. Confirm by reading
main.js. If the existing handler is generic enough (it should be —
`querySelectorAll('[data-action="open-library-doc"]')`), no change. Otherwise, add
a delegate on the admin panel container.

When clicked: close the admin panel, switch to the library workspace, set
`state.selectedDocumentId` to the clicked doc's id, kick off the doc-links fetch
(Task 5's `loadDocumentLinks`).

- [ ] **Step 6: Run tests + manual smoke**

Run: `npm test`
Expected: full suite green.

Smoke: `npm run demo`, open admin panel, confirm Maintenance section renders with
"No stale documents" / "No orphan documents" by default. Seed a stale + orphan
via curl, reopen admin, confirm the rows appear. Click [open] on a row, confirm
the library workspace opens to that doc.

- [ ] **Step 7: Commit**

```bash
git add public/js/renderAdminPanel.js public/js/state.js public/js/main.js \
        tests/frontend/renderAdminPanel.maintenance.test.js
git commit -m "Admin panel: Library Maintenance section (stale + orphan)

renderAdminPanelHtml gains a Library Maintenance section that lists
stale and orphan docs in two subsections, each with an [open] button
wired to the existing open-library-doc action. main.js fetches both
endpoints when the admin panel opens and re-renders.
"
```

---

## Task 7 — Demo server: `stale` on in-memory list

**Files:**
- Modify: `scripts/demo-server.js`

- [ ] **Step 1: Update the in-memory `listDocuments`**

Read `scripts/demo-server.js` around `createMemoryLibraryRepository.listDocuments`.
The current method returns documents matching filters. Extend each returned doc
with a `stale: boolean` computed by cross-referencing the in-memory `links` store
from `createMemoryDocumentLinksRepository`.

Plumbing concern: the library repo and links repo are constructed separately in the
demo file. The library repo needs visibility into the links array (or a sharing
mechanism).

Two options:

**Option A:** Have the library repo accept a `linksRef` parameter at construction:

```javascript
function createMemoryLibraryRepository(documents, linksRef = null) {
  // ...
  async listDocuments(filters = {}) {
    return documents.filter(/* existing filtering */).map((doc) => {
      let stale = false;
      if (linksRef) {
        for (const l of linksRef) {
          if (l.sourceId !== doc.id) continue;
          if (l.relation !== 'derived-from') continue;
          if (!l.targetHash) continue;
          const target = documents.find((d) => d.id === l.targetId && !d.archivedAt);
          if (!target) continue;
          if (target.contentHash !== l.targetHash) { stale = true; break; }
        }
      }
      return { ...doc, stale };
    });
  }
  // ...
}
```

…and pass the shared links array in when constructing both repos.

**Option B:** Add a setter `setLinksRef(linksRef)` to the library repo that the
demo wires up after both are constructed.

Pick whichever is closer to the existing pattern. Option A is cleaner.

- [ ] **Step 2: Smoke**

Run: `npm run demo &` (background).
Run: `curl -s 'http://127.0.0.1:3100/api/library/documents' | python3 -c 'import json,sys; [print(x["title"], "stale=", x["stale"]) for x in json.load(sys.stdin)]'`

Expected: every doc shows `stale=False` initially. Create a derived-from link via
the POST endpoint, edit the source body, re-list, confirm the derived doc now shows
`stale=True`.

Stop demo.

- [ ] **Step 3: Commit**

```bash
git add scripts/demo-server.js
git commit -m "Demo server: in-memory stale flag on doc list"
```

---

## Task 8 — CSS: chip styles + Links section + Maintenance layout

**Files:**
- Modify: `public/styles.css`

- [ ] **Step 1: Add chip styles**

Append to `public/styles.css` (find a sensible location near the existing
`document-tags` / `library-row` styles):

```css
.chip {
  display: inline-block;
  margin-left: 0.4em;
  padding: 0 0.45em;
  font-size: 0.7em;
  letter-spacing: 0.05em;
  border-radius: 2px;
  border: 1px solid currentColor;
  vertical-align: 1px;
}

.chip-synth {
  color: var(--accent);
}

.chip-stale {
  color: var(--accent-amber);
}

.chip-kind {
  font-size: 0.6em;
  letter-spacing: 0.08em;
}

.chip-kind--source {
  color: var(--muted, var(--accent-cyan));
}

.chip-kind--synthesized {
  color: var(--accent);
}

.detail-meta {
  color: var(--muted, var(--accent-cyan));
  font-size: 0.85em;
  margin: 0.2em 0;
}

.document-links {
  margin-top: 1.5em;
  padding-top: 1em;
  border-top: 1px solid currentColor;
  opacity: 0.95;
}

.document-links h3 {
  margin: 0 0 0.5em 0;
  font-size: 0.85em;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.document-links-group {
  margin-bottom: 0.75em;
}

.document-links-group h4 {
  margin: 0 0 0.3em 0;
  font-size: 0.8em;
  font-weight: normal;
  color: var(--accent-cyan);
}

.document-links-group ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.document-links-group li {
  padding: 0.2em 0;
}

.document-links-empty {
  font-size: 0.85em;
  opacity: 0.7;
  margin: 0;
}

.admin-subsection {
  margin: 1em 0;
}

.admin-subsection h4 {
  margin: 0 0 0.3em 0;
  font-size: 0.9em;
  font-weight: normal;
  letter-spacing: 0.05em;
}

.admin-help {
  font-size: 0.85em;
  opacity: 0.7;
  margin: 0 0 0.5em 0;
}

.admin-empty {
  font-style: italic;
  opacity: 0.6;
  margin: 0;
}

.admin-doc-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.admin-doc-list li {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1em;
  padding: 0.5em 0;
  border-bottom: 1px dashed currentColor;
}

.admin-doc-list li:last-child {
  border-bottom: none;
}

.admin-doc-list li > div {
  display: flex;
  flex-direction: column;
  gap: 0.2em;
}

.admin-doc-list strong {
  font-weight: normal;
}

.admin-doc-list small {
  opacity: 0.7;
  font-size: 0.8em;
}
```

- [ ] **Step 2: Manual visual smoke across palettes**

Run: `npm run demo`. Open the UI. Switch through the four palettes (Console,
Graphite, Daylight, Midnight) via Settings. Confirm the chips and Links section
render legibly on all four. Adjust token references if anything is invisible.

Stop demo.

- [ ] **Step 3: Commit**

```bash
git add public/styles.css
git commit -m "Style chips, Links section, and Maintenance tables

Chip styles (.chip, .chip-synth, .chip-stale, .chip-kind variants) use
existing palette tokens — --accent for SYNTH and SYNTHESIZED, --accent-
amber for STALE (matches the board's overdue indicator). Links section
gets its own block layout below the doc body. Admin Maintenance uses
the same dashed-divider list style as other admin subsections.
"
```

---

## Task 9 — End-to-end verification + final review + PR

- [ ] **Step 1: Run the full suite green**

Run: `npm test` → PASS.
Run: `npm run check` → PASS.

- [ ] **Step 2: Real-Postgres E2E**

```bash
docker compose down -v
docker compose up -d --build
sleep 10
```

Seed:

```bash
PROJECT_ID=$(docker compose exec -T postgres psql -U moomora -d moomora_console -t -A -c "select id from projects where slug='homelab'")

# Source doc
SRC_ID=$(curl -s -X POST 'http://127.0.0.1:3100/api/library/documents' \
  -H 'content-type: application/json' \
  -d "{\"title\":\"Restore runbook\",\"body\":\"# orig\\n\",\"documentType\":\"runbook\",\"project\":\"$PROJECT_ID\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')

# Synthesized derived-from doc
SYN_ID=$(curl -s -X POST 'http://127.0.0.1:3100/api/library/documents' \
  -H 'content-type: application/json' \
  -d "{\"title\":\"Restore summary\",\"body\":\"# sum\\n\",\"documentType\":\"note\",\"project\":\"$PROJECT_ID\",\"kind\":\"synthesized\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')

# Link
curl -s -X POST "http://127.0.0.1:3100/api/library/documents/$SYN_ID/links" \
  -H 'content-type: application/json' \
  -d "{\"targetId\":\"$SRC_ID\",\"relation\":\"derived-from\"}" > /dev/null

# Orphan
curl -s -X POST 'http://127.0.0.1:3100/api/library/documents' \
  -H 'content-type: application/json' \
  -d "{\"title\":\"Orphan\",\"body\":\"# o\\n\",\"documentType\":\"note\",\"project\":\"$PROJECT_ID\"}" > /dev/null

# Edit source to trigger stale
curl -s -X PATCH "http://127.0.0.1:3100/api/library/documents/$SRC_ID" \
  -H 'content-type: application/json' \
  -d '{"body":"# edited\n"}' > /dev/null
```

Verify the list response:

```bash
curl -s 'http://127.0.0.1:3100/api/library/documents' | python3 -c '
import json, sys
for d in json.load(sys.stdin):
    print(f"{d[\"title\"]:30s}  kind={d[\"kind\"]:12s}  stale={d[\"stale\"]}")'
```

Expected: the synthesized doc shows `stale=True`; others show `False`.

Open the UI at `http://127.0.0.1:3100/`. Confirm:
- Library list shows `SYNTH` chip on `Restore summary`, `STALE` pill on it.
- Click `Restore summary` → detail panel shows kind badge `SYNTHESIZED`, "Updated
  by user" line, Links section with "Derived from: Restore runbook".
- Click `Restore runbook` → Backlinks shows "Restore summary".
- Open Admin → Library Maintenance shows the synthesized doc under Stale,
  `Orphan` under Orphan.

Tear down: `docker compose down -v`.

- [ ] **Step 3: Dispatch a final Opus reviewer subagent**

Per `subagent-model-routing.md`: Opus for reviewers. Ask for spec compliance and
code quality across the branch. Address any **Important** findings before opening
the PR.

- [ ] **Step 4: Push branch and open PR**

```bash
git push -u origin feature/document-graph-ui
gh pr create --title "Document graph UI surface: links, kind, stale, maintenance" --body "$(cat <<'EOF'
## Summary

v0.12 makes the document graph visible in the console UI:

- **Detail panel** gains a SOURCE / SYNTHESIZED kind badge, an "Updated by" metadata line, and a Links section below the body (Derived from / Supersedes / Backlinks, grouped).
- **Library list** rows show inline SYNTH and STALE chips so you can scan provenance and grooming state at a glance.
- **Admin → Library Maintenance** lists stale and orphan documents with click-through to open each one.

Backend adds one additive contract field — `stale: boolean` on the doc list response — computed via a left-join lateral. No new HTTP endpoints, no new MCP tools, no migration.

Spec: \`docs/superpowers/specs/2026-06-03-document-graph-ui-design.md\`.

## Test plan

- [x] \`npm test\` green
- [x] \`npm run check\` green
- [x] Real-Postgres smoke: seeded source + synthesized + orphan + stale, verified list chips, detail Links, and Maintenance tables.
- [x] Visual smoke across all four palettes (Console / Graphite / Daylight / Midnight).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Release (post-merge)

Cuts as **v0.12.0**. Standard ritual:

1. Branch `release-v0.12.0` from main.
2. `npm version 0.12.0 --no-git-tag-version`.
3. Update `compose.image.yaml` and the README image-tag callout to `v0.12.0`.
4. Roll `[Unreleased]` to `[0.12.0] - <today>` in `CHANGELOG.md` with an `### Added`
   entry naming the three surfaces (list chips, detail Links, Maintenance section)
   and the contract addition.
5. Add `v0.11.1...v0.12.0` compare link.
6. Commit, PR, merge, `git tag -a v0.12.0 -m "v0.12.0" && git push origin v0.12.0`.
7. Watch the release workflow.
