# Library `.md` front-matter v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the library `.md` export front-matter to carry the document graph
(`derived-from` / `supersedes`), provenance (`content_hash`, `updated_by`), and `kind`.
Hybrid `{ id, ref }` identifier per link. Export-only, no YAML version field.

**Architecture:** Pure-function front-matter formatters (server + browser, byte-identical
under the existing dual-write invariant) gain a third `links` argument. A new repository
method bulk-fetches outbound links for the export route. The bulk route threads link data
plus a computed `ref` string through to the renderer. A new single-doc export route
moves single-doc rendering to the server so the browser only triggers the download.

**Tech Stack:** Node.js + Fastify + plain `pg`, archiver 8.0.0 (ESM `ZipArchive`), Node's
built-in test runner via `npm test`, plain JS in the browser (no bundler for the modules
touched here).

**Spec:** [`docs/superpowers/specs/2026-06-02-library-export-v2-design.md`](../specs/2026-06-02-library-export-v2-design.md)

**Target release:** v0.11.0 (single PR).

---

## File map

**Create:**
- `tests/backend/libraryExport.linksAndProvenance.test.js` — pure-function tests for the
  server-side `formatFrontMatter`/`renderDocumentMarkdown` v2 surface.
- `tests/frontend/libraryExportV2.test.js` — pure-function tests for the browser-side
  `buildExportedMarkdown` v2 surface.
- `tests/backend/documentLinksRepository.export.test.js` — repository test for the new
  bulk outbound-links query.
- `tests/backend/librarySingleExportRoute.test.js` — Fastify route test for the new
  single-doc export endpoint.

**Modify:**
- `server/libraryExport.js` — extend `formatFrontMatter` to accept `links`, emit the
  v2 fields, add an exported `computeLinkRef` helper.
- `public/js/libraryExport.js` — mirror server changes; byte-identical output.
- `server/documentLinksRepository.js` — add `buildListOutboundLinksForDocuments` and
  the `listOutboundLinksForDocuments` repository method.
- `server/libraryRoutes.js` — bulk export route wires link fetch + ref computation +
  passes links to the renderer; add the new `GET /api/library/documents/:id/export`
  route.
- `public/js/library.js` (or wherever the single-doc download is wired today — confirm
  via grep) — switch the UI from "fetch JSON + render locally" to triggering the new
  export URL.
- `scripts/demo-server.js` — mirror the bulk-outbound query + bulk export wiring + new
  single-doc export route.
- `tests/contract/libraryFormat.test.js` — update `GOLDEN_MARKDOWN`, extend the
  dual-write invariant fixture set.
- `docs/contract.md` — Format 2 section gains v2 fields, links subsection, new route
  row.

---

## Task 1 — Server-side front-matter v2 (pure module)

**Files:**
- Modify: `server/libraryExport.js`
- Create: `tests/backend/libraryExport.linksAndProvenance.test.js`

- [ ] **Step 1: Write failing tests for the v2 front-matter shape**

Create `tests/backend/libraryExport.linksAndProvenance.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatFrontMatter,
  renderDocumentMarkdown,
  computeLinkRef,
} from '../../server/libraryExport.js';

const HASH = '47421290090a9c1fbe1c5d3a7c2f9d8e4b1a6c3e8d5f2a9b7c4e1d8a5b2f9c6e3d';

const BASE_DOC = {
  title: 'Postgres restore',
  documentType: 'runbook',
  tags: ['postgres', 'dr'],
  createdAt: '2026-04-12T10:33:21.000Z',
  updatedAt: '2026-05-20T08:11:09.000Z',
  kind: 'source',
  contentHash: HASH,
  updatedBy: 'user',
  body: '# Postgres restore\n\nSteps...\n',
};

const EMPTY_LINKS = { 'derived-from': [], supersedes: [] };

test('SHAPE: v2 front-matter places kind/content_hash/updated_by between updated_at and links', () => {
  const out = formatFrontMatter(BASE_DOC, 'homelab', EMPTY_LINKS);
  const lines = out.split('\n');
  const idx = (key) => lines.findIndex((l) => l.startsWith(`${key}:`));
  assert.ok(idx('updated_at') < idx('kind'));
  assert.ok(idx('kind') < idx('content_hash'));
  assert.ok(idx('content_hash') < idx('updated_by'));
  assert.ok(idx('updated_by') < idx('links'));
});

test('SHAPE: empty links emit inline derived-from: [] / supersedes: []', () => {
  const out = formatFrontMatter(BASE_DOC, 'homelab', EMPTY_LINKS);
  assert.match(out, /links:\n  derived-from: \[\]\n  supersedes: \[\]\n---/);
});

test('SHAPE: a single derived-from entry emits an id/ref block sequence', () => {
  const links = {
    'derived-from': [
      { id: 'c58d3108-4f93-4a50-ac42-0c1d61e61b08', ref: 'homelab/cloudnativepg-restore.md' },
    ],
    supersedes: [],
  };
  const out = formatFrontMatter(BASE_DOC, 'homelab', links);
  assert.match(out, /links:\n  derived-from:\n    - id: c58d3108-4f93-4a50-ac42-0c1d61e61b08\n      ref: homelab\/cloudnativepg-restore.md\n  supersedes: \[\]/);
});

test('SHAPE: derived-from list order is preserved', () => {
  const links = {
    'derived-from': [
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ref: 'homelab/a.md' },
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ref: 'homelab/b.md' },
    ],
    supersedes: [],
  };
  const out = formatFrontMatter(BASE_DOC, 'homelab', links);
  const aIdx = out.indexOf('aaaaaaaa');
  const bIdx = out.indexOf('bbbbbbbb');
  assert.ok(aIdx > 0 && bIdx > aIdx);
});

test('SHAPE: both relations populated, derived-from emits before supersedes', () => {
  const links = {
    'derived-from': [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ref: 'a.md' }],
    supersedes: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ref: 'b.md' }],
  };
  const out = formatFrontMatter(BASE_DOC, 'homelab', links);
  const dfIdx = out.indexOf('derived-from:');
  const supIdx = out.indexOf('supersedes:');
  assert.ok(dfIdx > 0 && supIdx > dfIdx);
});

test('SHAPE: kind, content_hash, updated_by are unquoted', () => {
  const out = formatFrontMatter(BASE_DOC, 'homelab', EMPTY_LINKS);
  assert.match(out, new RegExp(`kind: source\\n`));
  assert.match(out, new RegExp(`content_hash: ${HASH}\\n`));
  assert.match(out, new RegExp(`updated_by: user\\n`));
});

test('SHAPE: links default to empty when omitted (back-compat for callers without graph data)', () => {
  const out = formatFrontMatter(BASE_DOC, 'homelab');
  assert.match(out, /links:\n  derived-from: \[\]\n  supersedes: \[\]/);
});

test('SHAPE: renderDocumentMarkdown threads links through and appends body', () => {
  const links = {
    'derived-from': [{ id: 'c58d3108-4f93-4a50-ac42-0c1d61e61b08', ref: 'homelab/x.md' }],
    supersedes: [],
  };
  const out = renderDocumentMarkdown(BASE_DOC, 'homelab', links);
  assert.match(out, /c58d3108-4f93-4a50-ac42-0c1d61e61b08/);
  assert.ok(out.endsWith('# Postgres restore\n\nSteps...\n'));
});

test('computeLinkRef: all-projects export emits <projectSlug>/<filename>', () => {
  const ref = computeLinkRef({
    scope: 'all',
    currentDocProjectSlug: 'work',
    targetProjectSlug: 'homelab',
    targetSourceFilename: null,
    targetTitle: 'Postgres restore',
  });
  assert.equal(ref, 'homelab/postgres-restore.md');
});

test('computeLinkRef: single-project export, same project, bare filename', () => {
  const ref = computeLinkRef({
    scope: 'single-project',
    currentDocProjectSlug: 'homelab',
    targetProjectSlug: 'homelab',
    targetSourceFilename: null,
    targetTitle: 'Postgres restore',
  });
  assert.equal(ref, 'postgres-restore.md');
});

test('computeLinkRef: single-project export, cross-project target dangles', () => {
  const ref = computeLinkRef({
    scope: 'single-project',
    currentDocProjectSlug: 'work',
    targetProjectSlug: 'homelab',
    targetSourceFilename: null,
    targetTitle: 'Postgres restore',
  });
  assert.equal(ref, 'homelab/postgres-restore.md');
});

test('computeLinkRef: prefers sourceFilename basename when present', () => {
  const ref = computeLinkRef({
    scope: 'all',
    currentDocProjectSlug: 'work',
    targetProjectSlug: 'homelab',
    targetSourceFilename: 'runbooks/restore.md',
    targetTitle: 'Whatever',
  });
  assert.equal(ref, 'homelab/restore.md');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/backend/libraryExport.linksAndProvenance.test.js`
Expected: FAIL — `formatFrontMatter` does not accept the third argument and does not
emit kind/content_hash/updated_by/links; `computeLinkRef` is not exported.

- [ ] **Step 3: Implement the v2 server-side front-matter and `computeLinkRef`**

Edit `server/libraryExport.js`. Keep the YAML-quoting helper, replace the formatter,
add the helper:

```javascript
const YAML_QUOTE_TRIGGER = /[:"\\\n#]|^-|^\s|\s$/

function yamlString(value) {
  const str = String(value ?? '')
  if (str === '') return '""'
  if (!YAML_QUOTE_TRIGGER.test(str)) return str
  return `"${str.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')}"`
}

function renderLinksBlock(links) {
  const groups = links || { 'derived-from': [], supersedes: [] }
  const relationOrder = ['derived-from', 'supersedes']
  const lines = ['links:']
  for (const relation of relationOrder) {
    const entries = Array.isArray(groups[relation]) ? groups[relation] : []
    if (entries.length === 0) {
      lines.push(`  ${relation}: []`)
      continue
    }
    lines.push(`  ${relation}:`)
    for (const entry of entries) {
      lines.push(`    - id: ${entry.id}`)
      lines.push(`      ref: ${yamlString(entry.ref || '')}`)
    }
  }
  return lines.join('\n')
}

export function formatFrontMatter(doc, projectSlug, links) {
  const tags = Array.isArray(doc.tags) ? doc.tags : []
  const tagsBlock = tags.length === 0
    ? 'tags: []'
    : `tags:\n${tags.map(tag => `  - ${yamlString(tag)}`).join('\n')}`
  const slug = projectSlug && String(projectSlug).trim() ? String(projectSlug) : 'unknown'
  const linksBlock = renderLinksBlock(links)

  return [
    '---',
    `title: ${yamlString(doc.title || '')}`,
    `type: ${yamlString(doc.documentType || 'note')}`,
    `project: ${yamlString(slug)}`,
    tagsBlock,
    `created_at: ${doc.createdAt || ''}`,
    `updated_at: ${doc.updatedAt || ''}`,
    `kind: ${doc.kind || 'source'}`,
    `content_hash: ${doc.contentHash || ''}`,
    `updated_by: ${doc.updatedBy || 'user'}`,
    linksBlock,
    '---',
    '',
  ].join('\n')
}

export function renderDocumentMarkdown(doc, projectSlug, links) {
  const frontMatter = formatFrontMatter(doc, projectSlug, links)
  const body = String(doc.body ?? '')
  if (body === '') return frontMatter
  const bodyWithNewline = body.endsWith('\n') ? body : `${body}\n`
  return `${frontMatter}\n${bodyWithNewline}`
}

function basename(value) {
  return String(value || '').split(/[\\/]/).pop() || ''
}

function stripLeadingDots(value) {
  return value.replace(/^\.+/, '')
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function documentFilename(doc) {
  const raw = stripLeadingDots(basename(doc?.sourceFilename || '').trim())
  if (raw) {
    return /\.md$/i.test(raw) ? raw : `${raw}.md`
  }
  const slug = slugify(doc?.title || '')
  return slug ? `${slug}.md` : 'untitled.md'
}

export function computeLinkRef({ scope, currentDocProjectSlug, targetProjectSlug, targetSourceFilename, targetTitle }) {
  const filename = documentFilename({ sourceFilename: targetSourceFilename, title: targetTitle })
  if (scope === 'single-project' && currentDocProjectSlug === targetProjectSlug) {
    return filename
  }
  return `${targetProjectSlug || 'unknown'}/${filename}`
}

export function dedupeFilenames(entries) {
  const seen = new Map()
  for (const entry of entries) {
    const claimed = seen.get(entry.path) || new Set()
    seen.set(entry.path, claimed)
    if (!claimed.has(entry.filename)) {
      claimed.add(entry.filename)
      continue
    }
    const ext = entry.filename.match(/\.md$/i)?.[0] || ''
    const stem = entry.filename.slice(0, entry.filename.length - ext.length)
    let n = 2
    let candidate
    do {
      candidate = `${stem}-${n}${ext}`
      n += 1
    } while (claimed.has(candidate))
    entry.filename = candidate
    claimed.add(candidate)
  }
}

export function libraryArchiveFilename(scope, date = new Date()) {
  const safe = String(scope || 'all')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'all'
  const day = date.toISOString().slice(0, 10)
  return `moomora-console-library-${safe}-${day}.zip`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/backend/libraryExport.linksAndProvenance.test.js`
Expected: PASS (all 11 tests).

Run: `npm test`
Expected: most of the suite PASS. The existing `tests/contract/libraryFormat.test.js`
fails because `GOLDEN_MARKDOWN` is now stale (it expects the v1 shape) and because the
dual-write invariant runs against the still-v1 browser file. This is expected — we fix
it in Tasks 2 and 8. Do not "fix" by reverting.

- [ ] **Step 5: Commit**

```bash
git add server/libraryExport.js tests/backend/libraryExport.linksAndProvenance.test.js
git commit -m "Library export v2: server formatter emits links/kind/provenance

formatFrontMatter and renderDocumentMarkdown accept a third \`links\`
argument (defaults to empty derived-from/supersedes). Front-matter
gains kind, content_hash, updated_by, and a links: block. Add
computeLinkRef as the pure helper for computing per-target ref strings.

Existing v1 golden / dual-write tests are intentionally left red until
the browser mirror lands (Task 2) and the contract golden updates
(Task 8).
"
```

---

## Task 2 — Browser-side front-matter v2 (mirror)

**Files:**
- Modify: `public/js/libraryExport.js`
- Create: `tests/frontend/libraryExportV2.test.js`

- [ ] **Step 1: Write failing tests for the browser-side v2 shape**

Create `tests/frontend/libraryExportV2.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExportedMarkdown } from '../../public/js/libraryExport.js';

const HASH = '47421290090a9c1fbe1c5d3a7c2f9d8e4b1a6c3e8d5f2a9b7c4e1d8a5b2f9c6e3d';

const BASE_DOC = {
  title: 'Postgres restore',
  documentType: 'runbook',
  tags: ['postgres', 'dr'],
  createdAt: '2026-04-12T10:33:21.000Z',
  updatedAt: '2026-05-20T08:11:09.000Z',
  kind: 'source',
  contentHash: HASH,
  updatedBy: 'user',
  body: '# Postgres restore\n\nSteps...\n',
};

const EMPTY_LINKS = { 'derived-from': [], supersedes: [] };

test('SHAPE (browser): v2 front-matter contains all five new keys', () => {
  const out = buildExportedMarkdown(BASE_DOC, 'homelab', EMPTY_LINKS);
  assert.match(out, /kind: source/);
  assert.match(out, new RegExp(`content_hash: ${HASH}`));
  assert.match(out, /updated_by: user/);
  assert.match(out, /links:\n  derived-from: \[\]\n  supersedes: \[\]/);
});

test('SHAPE (browser): non-empty derived-from emits id/ref entries', () => {
  const links = {
    'derived-from': [{ id: 'c58d3108-4f93-4a50-ac42-0c1d61e61b08', ref: 'homelab/x.md' }],
    supersedes: [],
  };
  const out = buildExportedMarkdown(BASE_DOC, 'homelab', links);
  assert.match(out, /- id: c58d3108-4f93-4a50-ac42-0c1d61e61b08\n      ref: homelab\/x.md/);
});

test('SHAPE (browser): links default to empty when omitted', () => {
  const out = buildExportedMarkdown(BASE_DOC, 'homelab');
  assert.match(out, /links:\n  derived-from: \[\]\n  supersedes: \[\]/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/frontend/libraryExportV2.test.js`
Expected: FAIL — `buildExportedMarkdown` does not yet emit v2 fields.

- [ ] **Step 3: Update `public/js/libraryExport.js` to mirror the server**

Edit `public/js/libraryExport.js`. The file currently mirrors the v1 server code with
trailing semicolons; preserve that style. Replace the front-matter formatter (the
top of the file, around `formatFrontMatter`) and ensure the same exported names:

```javascript
const YAML_QUOTE_TRIGGER = /[:"\\\n#]|^-|^\s|\s$/;

function yamlString(value) {
  const str = String(value ?? '');
  if (str === '') return '""';
  if (!YAML_QUOTE_TRIGGER.test(str)) return str;
  return `"${str.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')}"`;
}

function renderLinksBlock(links) {
  const groups = links || { 'derived-from': [], supersedes: [] };
  const relationOrder = ['derived-from', 'supersedes'];
  const lines = ['links:'];
  for (const relation of relationOrder) {
    const entries = Array.isArray(groups[relation]) ? groups[relation] : [];
    if (entries.length === 0) {
      lines.push(`  ${relation}: []`);
      continue;
    }
    lines.push(`  ${relation}:`);
    for (const entry of entries) {
      lines.push(`    - id: ${entry.id}`);
      lines.push(`      ref: ${yamlString(entry.ref || '')}`);
    }
  }
  return lines.join('\n');
}

function formatFrontMatter(doc, projectSlug, links) {
  const tags = Array.isArray(doc.tags) ? doc.tags : [];
  const tagsBlock = tags.length === 0
    ? 'tags: []'
    : `tags:\n${tags.map(tag => `  - ${yamlString(tag)}`).join('\n')}`;
  const slug = projectSlug && String(projectSlug).trim() ? String(projectSlug) : 'unknown';
  const linksBlock = renderLinksBlock(links);

  return [
    '---',
    `title: ${yamlString(doc.title || '')}`,
    `type: ${yamlString(doc.documentType || 'note')}`,
    `project: ${yamlString(slug)}`,
    tagsBlock,
    `created_at: ${doc.createdAt || ''}`,
    `updated_at: ${doc.updatedAt || ''}`,
    `kind: ${doc.kind || 'source'}`,
    `content_hash: ${doc.contentHash || ''}`,
    `updated_by: ${doc.updatedBy || 'user'}`,
    linksBlock,
    '---',
    '',
  ].join('\n');
}

export function buildExportedMarkdown(doc, projectSlug, links) {
  const frontMatter = formatFrontMatter(doc, projectSlug, links);
  const body = String(doc?.body ?? '');
  if (body === '') return frontMatter;
  const bodyWithNewline = body.endsWith('\n') ? body : `${body}\n`;
  return `${frontMatter}\n${bodyWithNewline}`;
}
```

Leave the `basename` / `stripLeadingDots` / `slugify` / `documentFilename` /
`triggerDownload` helpers below unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/frontend/libraryExportV2.test.js`
Expected: PASS.

Run: `npm test`
Expected: server v2 + browser v2 tests pass; the contract dual-write fixture set is
still out of date (Task 8) and the golden markdown still mismatches — that's fine.
You should NOT have any new failures beyond what Task 1 already had.

- [ ] **Step 5: Commit**

```bash
git add public/js/libraryExport.js tests/frontend/libraryExportV2.test.js
git commit -m "Library export v2: browser formatter mirrors server v2 fields

buildExportedMarkdown accepts a third \`links\` argument and emits the
same kind/content_hash/updated_by/links block as the server. Maintains
the byte-identical dual-write invariant once the contract fixtures get
updated in Task 8.
"
```

---

## Task 3 — Bulk outbound-link repository method

**Files:**
- Modify: `server/documentLinksRepository.js`
- Create: `tests/backend/documentLinksRepository.export.test.js`

- [ ] **Step 1: Write failing tests for the builder and the repository method**

Create `tests/backend/documentLinksRepository.export.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildListOutboundLinksForDocuments,
  createDocumentLinksRepository,
} from '../../server/documentLinksRepository.js';

test('buildListOutboundLinksForDocuments selects target join columns', () => {
  const q = buildListOutboundLinksForDocuments(['a', 'b']);
  assert.match(q.text, /dl\.source_document_id/);
  assert.match(q.text, /dl\.relation/);
  assert.match(q.text, /t\.id as target_id/);
  assert.match(q.text, /p\.slug as target_project_slug/);
  assert.match(q.text, /t\.source_filename as target_source_filename/);
  assert.match(q.text, /t\.title as target_title/);
  assert.match(q.text, /and t\.archived_at is null/);
  assert.deepEqual(q.values, [['a', 'b']]);
});

test('listOutboundLinksForDocuments returns a Map grouped by source id and relation', async () => {
  const fakeRows = [
    { source_document_id: 'A', relation: 'derived-from', target_id: 'T1', target_project_slug: 'work', target_source_filename: null, target_title: 'Alpha' },
    { source_document_id: 'A', relation: 'supersedes', target_id: 'T2', target_project_slug: 'work', target_source_filename: null, target_title: 'Beta' },
    { source_document_id: 'B', relation: 'derived-from', target_id: 'T3', target_project_slug: 'homelab', target_source_filename: 'runbooks/x.md', target_title: 'Gamma' },
  ];
  const repo = createDocumentLinksRepository({ query: async () => ({ rows: fakeRows }) });
  const out = await repo.listOutboundLinksForDocuments(['A', 'B']);
  assert.ok(out instanceof Map);
  assert.equal(out.size, 2);
  const a = out.get('A');
  assert.deepEqual(a['derived-from'].map((e) => e.targetId), ['T1']);
  assert.deepEqual(a.supersedes.map((e) => e.targetId), ['T2']);
  const b = out.get('B');
  assert.deepEqual(b['derived-from'].map((e) => e.targetId), ['T3']);
  assert.deepEqual(b.supersedes, []);
});

test('listOutboundLinksForDocuments returns an empty Map when no rows', async () => {
  const repo = createDocumentLinksRepository({ query: async () => ({ rows: [] }) });
  const out = await repo.listOutboundLinksForDocuments(['A']);
  assert.ok(out instanceof Map);
  assert.equal(out.size, 0);
});

test('listOutboundLinksForDocuments returns an empty Map for empty input without hitting the db', async () => {
  let called = false;
  const repo = createDocumentLinksRepository({ query: async () => { called = true; return { rows: [] }; } });
  const out = await repo.listOutboundLinksForDocuments([]);
  assert.equal(out.size, 0);
  assert.equal(called, false, 'must short-circuit before calling db.query');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/backend/documentLinksRepository.export.test.js`
Expected: FAIL — neither the builder nor the repository method exists yet.

- [ ] **Step 3: Add the builder and the repository method**

Edit `server/documentLinksRepository.js`. Add the new builder near
`buildListOrphanDocuments`:

```javascript
export function buildListOutboundLinksForDocuments(docIds) {
  return {
    text: `
      select dl.source_document_id,
             dl.relation,
             t.id as target_id,
             p.slug as target_project_slug,
             t.source_filename as target_source_filename,
             t.title as target_title
      from document_links dl
      join markdown_documents t on t.id = dl.target_document_id and t.archived_at is null
      join projects p on p.id = t.project_id
      where dl.source_document_id = any($1)
      order by dl.source_document_id, dl.relation, t.title
    `,
    values: [docIds],
  };
}
```

Add the repository method inside `createDocumentLinksRepository`:

```javascript
    async listOutboundLinksForDocuments(docIds) {
      const grouped = new Map();
      if (!Array.isArray(docIds) || docIds.length === 0) return grouped;
      const query = buildListOutboundLinksForDocuments(docIds);
      const result = await db.query(query.text, query.values);
      for (const row of result.rows) {
        if (!grouped.has(row.source_document_id)) {
          grouped.set(row.source_document_id, { 'derived-from': [], supersedes: [] });
        }
        const bucket = grouped.get(row.source_document_id);
        const entry = {
          targetId: row.target_id,
          targetProjectSlug: row.target_project_slug,
          targetSourceFilename: row.target_source_filename,
          targetTitle: row.target_title,
        };
        if (row.relation === 'derived-from' || row.relation === 'supersedes') {
          bucket[row.relation].push(entry);
        }
      }
      return grouped;
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/backend/documentLinksRepository.export.test.js`
Expected: PASS (all 4 tests).

Run: `npm test`
Expected: no NEW failures beyond the contract golden mismatch.

- [ ] **Step 5: Commit**

```bash
git add server/documentLinksRepository.js tests/backend/documentLinksRepository.export.test.js
git commit -m "Library export v2: bulk outbound-link repository method

listOutboundLinksForDocuments(docIds) returns a Map<sourceId,
{ 'derived-from': [...], supersedes: [...] }> with target metadata
needed to compute export refs. Archived targets are excluded. Empty
input short-circuits without hitting the db.
"
```

---

## Task 4 — Bulk export route wires links + refs

**Files:**
- Modify: `server/libraryRoutes.js`
- Modify: `tests/backend/libraryExportRoute.test.js`

- [ ] **Step 1: Read the existing bulk export test to learn the harness**

Run: `cat tests/backend/libraryExportRoute.test.js | head -50`

Note how the existing tests build the app (likely `buildApp` from `server/index.js`),
seed library + project stubs, and parse the ZIP response. Follow that pattern.

- [ ] **Step 2: Write a failing assertion that bulk export emits the v2 links block**

Append to `tests/backend/libraryExportRoute.test.js` (or, if the file is already
large, place in a sibling `tests/backend/libraryExportRoute.linksAndProvenance.test.js`
following the same buildApp pattern):

```javascript
test('GET /api/library/export emits v2 front-matter with links for linked docs', async () => {
  // Use the same buildApp + repository stubs the existing tests use.
  // Seed two docs in 'homelab':
  //   doc A: title 'Cloudflare plan', no links
  //   doc B: title 'Postgres restore', derived-from A
  // Stub libraryRepository.listActiveDocumentsForExport to return both with projectSlug='homelab'.
  // Stub documentLinksRepository.listOutboundLinksForDocuments to return a Map with B -> derived-from -> A's target metadata.
  // Inject GET /api/library/export.
  // Parse the ZIP entry for 'cloudflare-plan.md' and 'postgres-restore.md'.
  // Assert doc A's front-matter contains `links:\n  derived-from: []\n  supersedes: []`.
  // Assert doc B's front-matter contains `- id: <A's id>\n      ref: cloudflare-plan.md`
  //   (single-project export → bare filename).
});
```

(Implementer: copy the exact harness from the existing route tests; the comment block
above is the assertion intent.)

- [ ] **Step 3: Run test to verify it fails**

Run the new test. Expected: FAIL — the route doesn't fetch outbound links nor pass them
to the renderer.

- [ ] **Step 4: Wire link fetching + ref computation into the bulk export route**

Edit `server/libraryRoutes.js`. At the top, add `computeLinkRef` to the
`libraryExport` import:

```javascript
import {
  documentFilename,
  renderDocumentMarkdown,
  dedupeFilenames,
  libraryArchiveFilename,
  computeLinkRef,
} from './libraryExport.js';
```

Replace the body of the `/api/library/export` handler. After `dedupeFilenames(entries)`:

```javascript
app.get('/api/library/export', async (request, reply) => {
  const projectParam = request.query.project;
  let projectId;
  let scope = 'all';

  if (projectParam && projectParam !== 'all') {
    const resolved = await projectsRepository.resolveProject(String(projectParam));
    if (!resolved) {
      reply.code(400);
      return { message: 'project is invalid' };
    }
    projectId = resolved.id;
    scope = resolved.slug;
  }

  const documents = await repository.listActiveDocumentsForExport({ projectId });
  const isAll = scope === 'all';

  const entries = documents.map((doc) => ({
    doc,
    path: isAll ? `${doc.projectSlug || 'unknown'}/` : '',
    filename: documentFilename(doc),
  }));
  dedupeFilenames(entries);

  const docIds = entries.map((e) => e.doc.id);
  const outboundByDocId = await documentLinksRepository.listOutboundLinksForDocuments(docIds);
  const refScope = isAll ? 'all' : 'single-project';

  const filename = libraryArchiveFilename(scope);
  reply.header('Content-Type', 'application/zip');
  reply.header('Content-Disposition', `attachment; filename="${filename}"`);

  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on('error', (err) => {
    request.log.error({ err }, 'library export archive error');
  });

  for (const entry of entries) {
    const groups = outboundByDocId.get(entry.doc.id) || { 'derived-from': [], supersedes: [] };
    const links = {
      'derived-from': groups['derived-from'].map((e) => ({
        id: e.targetId,
        ref: computeLinkRef({
          scope: refScope,
          currentDocProjectSlug: entry.doc.projectSlug,
          targetProjectSlug: e.targetProjectSlug,
          targetSourceFilename: e.targetSourceFilename,
          targetTitle: e.targetTitle,
        }),
      })),
      supersedes: groups.supersedes.map((e) => ({
        id: e.targetId,
        ref: computeLinkRef({
          scope: refScope,
          currentDocProjectSlug: entry.doc.projectSlug,
          targetProjectSlug: e.targetProjectSlug,
          targetSourceFilename: e.targetSourceFilename,
          targetTitle: e.targetTitle,
        }),
      })),
    };
    const content = renderDocumentMarkdown(entry.doc, entry.doc.projectSlug, links);
    archive.append(content, { name: `${entry.path}${entry.filename}` });
  }
  archive.finalize().catch((err) => {
    request.log.error({ err }, 'library export archive finalize rejected');
  });

  return reply.send(archive);
});
```

- [ ] **Step 5: Run tests to verify**

Run: `npm test -- tests/backend/libraryExportRoute.test.js`
Expected: the new v2 test passes; existing route tests continue to pass.

Run: `npm test`
Expected: same as before — the contract golden (Task 8) is still red.

- [ ] **Step 6: Commit**

```bash
git add server/libraryRoutes.js tests/backend/libraryExportRoute.test.js
git commit -m "Library export v2: bulk route fetches and emits outbound links

The bulk export route fetches outbound links via
listOutboundLinksForDocuments, computes per-target ref strings via
computeLinkRef using the scope (all-projects vs single-project), and
threads the links object into renderDocumentMarkdown. Existing route
tests stay green.
"
```

---

## Task 5 — Single-doc export route

**Files:**
- Modify: `server/libraryRoutes.js`
- Create: `tests/backend/librarySingleExportRoute.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/backend/librarySingleExportRoute.test.js`. Mirror the harness used in
`libraryRoutes.kind.test.js` (`buildApp({ skipDb: true, ... })`).

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const DOC_A = { id: '11111111-1111-4111-8111-111111111111', title: 'Cloudflare plan', body: '# A\n', documentType: 'note', projectId: PROJECT_ID, projectSlug: 'homelab', tags: [], sourceFilename: null, archivedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', kind: 'source', contentHash: 'a'.repeat(64), updatedBy: 'user' };
const DOC_B = { id: '22222222-2222-4222-8222-222222222222', title: 'Postgres restore', body: '# B\n', documentType: 'runbook', projectId: PROJECT_ID, projectSlug: 'homelab', tags: [], sourceFilename: null, archivedAt: null, createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-01-04T00:00:00.000Z', kind: 'synthesized', contentHash: 'b'.repeat(64), updatedBy: 'agent' };

function fakeLibrary() {
  return {
    listDocuments: async () => [],
    getDocument: async (id) => (id === DOC_A.id ? DOC_A : id === DOC_B.id ? DOC_B : null),
    createDocument: async () => null,
    updateDocument: async () => null,
    archiveDocument: async () => null,
    restoreDocument: async () => null,
    deleteArchivedDocument: async () => null,
    listActiveDocumentsForExport: async () => [],
  };
}

function fakeProjects() {
  return { resolveProject: async () => ({ id: PROJECT_ID, slug: 'homelab' }) };
}

function fakeLinks() {
  return {
    listDocumentLinks: async () => [],
    linkDocuments: async () => ({ linked: true }),
    unlinkDocuments: async () => true,
    listStaleDocuments: async () => [],
    listOrphanDocuments: async () => [],
    listOutboundLinksForDocuments: async (ids) => {
      const m = new Map();
      if (ids.includes(DOC_B.id)) {
        m.set(DOC_B.id, {
          'derived-from': [{ targetId: DOC_A.id, targetProjectSlug: 'homelab', targetSourceFilename: null, targetTitle: 'Cloudflare plan' }],
          supersedes: [],
        });
      }
      return m;
    },
  };
}

async function makeApp() {
  return buildApp({
    skipDb: true,
    tasksRepository: { listTasks: async () => [], getTask: async () => null, createTask: async () => null, updateTask: async () => null, archiveTask: async () => null, restoreTask: async () => null, deleteArchivedTask: async () => null, reorderTasks: async () => [], recordActivity: async () => null, listTaskActivity: async () => [], importTasks: async () => [], replaceProjectTasks: async () => [] },
    libraryRepository: fakeLibrary(),
    projectsRepository: fakeProjects(),
    documentLinksRepository: fakeLinks(),
  });
}

test('GET /api/library/documents/:id/export returns rendered v2 markdown', async () => {
  const app = await makeApp();
  const res = await app.inject({ method: 'GET', url: `/api/library/documents/${DOC_B.id}/export` });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /^text\/markdown/);
  assert.match(res.headers['content-disposition'], /attachment; filename="postgres-restore\.md"/);
  assert.match(res.body, /title: Postgres restore/);
  assert.match(res.body, /kind: synthesized/);
  assert.match(res.body, new RegExp(`content_hash: ${'b'.repeat(64)}`));
  assert.match(res.body, /updated_by: agent/);
  assert.match(res.body, new RegExp(`- id: ${DOC_A.id}\\n      ref: cloudflare-plan.md`));
  assert.ok(res.body.endsWith('# B\n'));
  await app.close();
});

test('GET /api/library/documents/:id/export rejects an invalid UUID with 400', async () => {
  const app = await makeApp();
  const res = await app.inject({ method: 'GET', url: '/api/library/documents/not-a-uuid/export' });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test('GET /api/library/documents/:id/export returns 404 for a missing doc', async () => {
  const app = await makeApp();
  const res = await app.inject({ method: 'GET', url: `/api/library/documents/${'9'.repeat(8)}-9999-4999-8999-999999999999/export` });
  assert.equal(res.statusCode, 404);
  await app.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/backend/librarySingleExportRoute.test.js`
Expected: FAIL — the route does not exist.

- [ ] **Step 3: Add the route**

Edit `server/libraryRoutes.js`. Add the route alongside the existing
`GET /api/library/documents/:id` and `:id/links` routes (after the `/links` routes is a
natural spot — keep related routes together). The handler must look up the doc, fetch
its outbound links, compute refs (single-project scope, since it's a one-doc export),
render, and send.

```javascript
app.get('/api/library/documents/:id/export', async (request, reply) => {
  if (!isValidUuid(request.params.id)) { reply.code(400); return { message: 'document id is invalid' }; }
  const doc = await repository.getDocument(request.params.id);
  if (!doc) { reply.code(404); return { message: 'document not found' }; }

  // Resolve projectSlug if the doc row doesn't already carry it (the existing list-for-export query joins it; the by-id query does not).
  if (!doc.projectSlug) {
    const project = await projectsRepository.resolveProject(doc.projectId);
    doc.projectSlug = project ? project.slug : 'unknown';
  }

  const outboundByDocId = await documentLinksRepository.listOutboundLinksForDocuments([doc.id]);
  const groups = outboundByDocId.get(doc.id) || { 'derived-from': [], supersedes: [] };
  const refScope = 'single-project';
  const links = {
    'derived-from': groups['derived-from'].map((e) => ({
      id: e.targetId,
      ref: computeLinkRef({
        scope: refScope,
        currentDocProjectSlug: doc.projectSlug,
        targetProjectSlug: e.targetProjectSlug,
        targetSourceFilename: e.targetSourceFilename,
        targetTitle: e.targetTitle,
      }),
    })),
    supersedes: groups.supersedes.map((e) => ({
      id: e.targetId,
      ref: computeLinkRef({
        scope: refScope,
        currentDocProjectSlug: doc.projectSlug,
        targetProjectSlug: e.targetProjectSlug,
        targetSourceFilename: e.targetSourceFilename,
        targetTitle: e.targetTitle,
      }),
    })),
  };
  const filename = documentFilename(doc);
  const content = renderDocumentMarkdown(doc, doc.projectSlug, links);
  reply.header('Content-Type', 'text/markdown; charset=utf-8');
  reply.header('Content-Disposition', `attachment; filename="${filename}"`);
  return content;
});
```

(Note: `projectsRepository.resolveProject` accepts a UUID per the existing route
patterns; if not, the implementer should follow whatever lookup-by-id helper exists.
Reading `projectsRepository.js` first is the safest path.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/backend/librarySingleExportRoute.test.js`
Expected: PASS (all 3 tests).

Run: `npm test`
Expected: no new failures.

- [ ] **Step 5: Commit**

```bash
git add server/libraryRoutes.js tests/backend/librarySingleExportRoute.test.js
git commit -m "Library export v2: single-doc export route

GET /api/library/documents/:id/export renders a single document as v2
markdown (front-matter + body) with outbound link refs computed in
single-project scope. Returns 400/404 on invalid/missing ids.
"
```

---

## Task 6 — Browser single-doc download switches to the new route

**Files:**
- Modify: whichever file in `public/js/` currently calls `buildExportedMarkdown` to
  trigger the single-doc download (use `grep -rn buildExportedMarkdown public/js/` to
  find it; common candidates: `library.js`, `libraryExport.js`'s callers).
- Modify: the matching test file under `tests/frontend/`.

- [ ] **Step 1: Locate the current single-doc download path**

Run: `grep -rn 'buildExportedMarkdown\|triggerDownload' public/js/`

Identify the call site that builds the markdown and triggers a download. Read it.

- [ ] **Step 2: Write a failing test (or update an existing one) asserting the new behavior**

The new behavior: when the user clicks "Download" on a single doc, the UI navigates the
browser to `GET /api/library/documents/<id>/export` (which the server returns with
`Content-Disposition: attachment`). No more client-side rendering for this path.

Typical assertion strategy: a unit test that calls the download handler with a fake doc
id and a fake `document`/`window` interface, then asserts an `<a href="…/export">`
anchor was created and clicked.

If the existing frontend test was asserting the rendered markdown contents, replace
that assertion with one that asserts the new URL is used.

- [ ] **Step 3: Update the call site**

Replace the JSON-fetch + render + Blob + triggerDownload sequence with:

```javascript
// Single-doc export — server renders the v2 markdown so the browser
// doesn't need to know about outbound links or front-matter v2.
function downloadDocument(documentId) {
  const url = `/api/library/documents/${documentId}/export`;
  const anchor = document.createElement('a');
  anchor.href = url;
  // Setting download lets the browser honor the server's filename via
  // Content-Disposition; leaving it empty is fine.
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}
```

Adjust naming/signatures to match the existing module's style. Keep the
`triggerDownload` helper if other paths still use it (e.g. bulk ZIP export uses a Blob
URL today — confirm via grep).

- [ ] **Step 4: Run tests to verify**

Run: `npm test -- tests/frontend/`
Expected: PASS, including the updated single-doc download test.

Run: `npm test`
Expected: no new failures.

- [ ] **Step 5: Commit**

```bash
git add public/js/<file> tests/frontend/<file>
git commit -m "Library export v2: single-doc UI uses the server export route

The single-doc download now navigates to GET /api/library/documents/:id/export
instead of fetching JSON and rendering markdown in the browser. The
server is the single source of truth for v2 rendering. The browser
formatter (public/js/libraryExport.js) stays in the repo, exercised
only by the dual-write invariant test.
"
```

---

## Task 7 — Demo server mirror

**Files:**
- Modify: `scripts/demo-server.js`

- [ ] **Step 1: Mirror the bulk-outbound-links query**

In `scripts/demo-server.js`, find `createMemoryDocumentLinksRepository`. Add:

```javascript
    async listOutboundLinksForDocuments(docIds) {
      const grouped = new Map();
      if (!Array.isArray(docIds) || docIds.length === 0) return grouped;
      const ids = new Set(docIds);
      for (const l of links) {
        if (!ids.has(l.sourceId)) continue;
        const target = documentsRef.find((d) => d.id === l.targetId && !d.archivedAt);
        if (!target) continue;
        const sourceProject = sharedProjects.find((p) => p.id === target.projectId);
        if (!grouped.has(l.sourceId)) {
          grouped.set(l.sourceId, { 'derived-from': [], supersedes: [] });
        }
        const bucket = grouped.get(l.sourceId);
        bucket[l.relation].push({
          targetId: target.id,
          targetProjectSlug: sourceProject ? sourceProject.slug : 'unknown',
          targetSourceFilename: target.sourceFilename,
          targetTitle: target.title,
        });
      }
      return grouped;
    },
```

(Reuse `sharedProjects` and `documentsRef` references already in scope.)

- [ ] **Step 2: Mirror the bulk export route's link threading**

The demo server registers its own routes (the project doesn't share `libraryRoutes.js`
with the demo — confirm by reading `scripts/demo-server.js`'s bottom half). Update the
`/api/library/export` handler in the demo to: fetch outbound links via the new
in-memory method, compute refs, pass `links` to its renderer call.

If the demo registers `libraryRoutes` from the real server (search for
`registerLibraryRoutes`), no change is needed — the bulk route already threads links.
Verify before assuming.

- [ ] **Step 3: Mirror the single-doc export route**

Add `GET /api/library/documents/:id/export` to the demo. Same logic as Task 5's route
but using the in-memory repositories.

- [ ] **Step 4: Smoke the demo**

```bash
npm run demo &
sleep 3
curl -s -o /tmp/library.zip 'http://127.0.0.1:3100/api/library/export'
unzip -p /tmp/library.zip 'homelab/cloudnativepg-restore.md' | head -20
curl -s "http://127.0.0.1:3100/api/library/documents/$(curl -s 'http://127.0.0.1:3100/api/library/documents' | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["id"])')/export" | head -20
pkill -f 'node scripts/demo-server.js'
```

Expected: both responses include `kind`, `content_hash`, `updated_by`, and
`links:` block.

- [ ] **Step 5: Commit**

```bash
git add scripts/demo-server.js
git commit -m "Library export v2: demo server mirror"
```

---

## Task 8 — Contract tests + docs

**Files:**
- Modify: `tests/contract/libraryFormat.test.js`
- Modify: `docs/contract.md`

- [ ] **Step 1: Update `GOLDEN_MARKDOWN` to the v2 shape**

Edit `tests/contract/libraryFormat.test.js`. Replace `GOLDEN_DOC` to include the new
fields, replace `GOLDEN_MARKDOWN` to match the v2 emission:

```javascript
const GOLDEN_DOC = {
  title: 'Postgres restore',
  body: '# Postgres restore\n\nSteps...\n',
  documentType: 'runbook',
  tags: ['postgres', 'dr'],
  createdAt: '2026-04-12T10:33:21.000Z',
  updatedAt: '2026-05-20T08:11:09.000Z',
  kind: 'source',
  contentHash: '47421290090a9c1fbe1c5d3a7c2f9d8e4b1a6c3e8d5f2a9b7c4e1d8a5b2f9c6e3d',
  updatedBy: 'user',
};

const GOLDEN_MARKDOWN = `---
title: Postgres restore
type: runbook
project: homelab
tags:
  - postgres
  - dr
created_at: 2026-04-12T10:33:21.000Z
updated_at: 2026-05-20T08:11:09.000Z
kind: source
content_hash: 47421290090a9c1fbe1c5d3a7c2f9d8e4b1a6c3e8d5f2a9b7c4e1d8a5b2f9c6e3d
updated_by: user
links:
  derived-from: []
  supersedes: []
---

# Postgres restore

Steps...
`;
```

- [ ] **Step 2: Extend the dual-write invariant fixtures**

Replace the existing dual-write test with v2-aware fixtures:

```javascript
test('SHAPE: browser serializer is byte-identical to server (dual-write invariant)', () => {
  const HASH = '47421290090a9c1fbe1c5d3a7c2f9d8e4b1a6c3e8d5f2a9b7c4e1d8a5b2f9c6e3d';
  const EMPTY = { 'derived-from': [], supersedes: [] };
  const baseDoc = { ...GOLDEN_DOC, sourceFilename: null };
  const fixtures = [
    { doc: baseDoc, slug: 'homelab', links: EMPTY },
    { doc: { ...baseDoc, title: 'Has: colon' }, slug: 'homelab', links: EMPTY },
    { doc: { ...baseDoc, tags: [], body: '' }, slug: 'homelab', links: EMPTY },
    {
      doc: baseDoc, slug: 'homelab',
      links: {
        'derived-from': [{ id: 'c58d3108-4f93-4a50-ac42-0c1d61e61b08', ref: 'homelab/x.md' }],
        supersedes: [],
      },
    },
    {
      doc: { ...baseDoc, kind: 'synthesized', updatedBy: 'agent', contentHash: HASH }, slug: 'homelab',
      links: {
        'derived-from': [
          { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ref: 'homelab/a.md' },
          { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ref: 'work/b.md' },
        ],
        supersedes: [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', ref: 'c.md' }],
      },
    },
  ];
  for (const { doc, slug, links } of fixtures) {
    assert.equal(buildExportedMarkdown(doc, slug, links), renderDocumentMarkdown(doc, slug, links));
  }
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npm test`
Expected: full suite green.

- [ ] **Step 4: Update `docs/contract.md` Format 2**

Replace the existing Format 2 example with the v2 example. Add prose for `kind`,
`content_hash`, `updated_by`, the `links:` block (outbound only, `{ id, ref }`, ref
is a hint, always-emit empty form, ref computation rules), and a new HTTP route row
for `GET /api/library/documents/:id/export`. Re-confirm "no import" under the
"Not currently supported" section.

(Exact prose at the implementer's discretion; the spec
`docs/superpowers/specs/2026-06-02-library-export-v2-design.md` is the source of truth
for what's accurate.)

- [ ] **Step 5: Commit**

```bash
git add tests/contract/libraryFormat.test.js docs/contract.md
git commit -m "Library export v2: contract golden, dual-write fixtures, docs

Update GOLDEN_MARKDOWN to the v2 shape, extend the dual-write invariant
fixture set to cover empty links, single derived-from, multi-relation
mixed scenarios. Refresh docs/contract.md Format 2 with the v2 prose,
links subsection, and the new single-doc export route.
"
```

---

## Task 9 — End-to-end verification + final review + PR

- [ ] **Step 1: Run the full suite green**

Run: `npm test` → PASS.
Run: `npm run check` → PASS.

- [ ] **Step 2: Bring up real Postgres and exercise both export paths**

```bash
docker compose down -v
docker compose up -d --build
sleep 10
```

Create a derived-from link between two seeded docs (or seed via the API). Then:

```bash
# Bulk export
curl -s -o /tmp/lib.zip 'http://127.0.0.1:3100/api/library/export'
file /tmp/lib.zip
unzip -p /tmp/lib.zip <some-file.md> | head -30
# Expect: kind:, content_hash:, updated_by:, links: with derived-from entries.

# Single-doc export
DOC=$(curl -s 'http://127.0.0.1:3100/api/library/documents' | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["id"])')
curl -s "http://127.0.0.1:3100/api/library/documents/$DOC/export" | head -30
# Expect: same v2 front-matter + the body.
```

Tear down:

```bash
docker compose down -v
```

- [ ] **Step 3: Dispatch a final Opus reviewer subagent**

Per `subagent-model-routing.md`: Opus for reviewers. Ask for spec compliance
(every section of `docs/superpowers/specs/2026-06-02-library-export-v2-design.md`
implemented) and code quality across the branch. Address any **Important** findings
before opening the PR.

- [ ] **Step 4: Push branch and open PR**

```bash
git push -u origin feature/library-export-v2
gh pr create --title "Library export v2: links, provenance, kind in front-matter" --body "$(cat <<'EOF'
## Summary

- Front-matter v2: \`.md\` exports now carry \`kind\`, \`content_hash\`, \`updated_by\`,
  and an outbound \`links:\` block (\`derived-from\`, \`supersedes\`) with
  \`{ id, ref }\` per target. \`id\` is the UUID and authoritative; \`ref\` is a
  path-style hint matching the zip layout when the target is present.
- Always-emit empty links (\`derived-from: []\` / \`supersedes: []\`) for parity with
  \`tags: []\`.
- New \`GET /api/library/documents/:id/export\` route renders a single doc as v2
  markdown server-side; the UI now navigates to this URL instead of rendering in
  the browser.
- Bulk export route fetches outbound links via a new
  \`listOutboundLinksForDocuments\` repository method (one round-trip for all docs).
- Export-only: no import path, no YAML version field. v1 readers (Obsidian, generic
  markdown tools) silently accept v2 as YAML ignores unknown keys.

Spec: \`docs/superpowers/specs/2026-06-02-library-export-v2-design.md\`.

## Test plan

- [x] \`npm test\` green
- [x] \`npm run check\` green
- [x] Real-Postgres smoke: \`docker compose up -d --build\`, create a derived-from
      link via the API, export bulk + single-doc, verify v2 front-matter in both.
- [x] Dual-write invariant: server and browser front-matter emit byte-identical
      output across empty/single/multi/cross-project fixtures.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Release (post-merge)

Cuts as **v0.11.0**. Standard ritual:

1. Branch `release-v0.11.0` from main.
2. `npm version 0.11.0 --no-git-tag-version`.
3. Update `compose.image.yaml` image ref to `:v0.11.0`.
4. Update README image-tag callout to `v0.11.0`.
5. Roll `[Unreleased]` to `[0.11.0] - <today>` in `CHANGELOG.md` with an
   `### Added` entry: "Library \`.md\` export front-matter v2: outbound document
   links, content hash, edit origin, and \`kind\`. New
   \`GET /api/library/documents/:id/export\` route serves single-doc rendered
   markdown. Export-only; YAML stays version-less. (#<PR>)"
6. Add `v0.10.0...v0.11.0` compare link.
7. Commit, PR, merge, `git tag -a v0.11.0 -m "v0.11.0" && git push origin v0.11.0`.
8. Watch the release workflow.
