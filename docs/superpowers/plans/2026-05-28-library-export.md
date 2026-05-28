# Library Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-doc `.md` download to the Library editor toolbar and a bulk ZIP-of-`.md` download to the Admin panel, both emitting the same YAML-front-matter-prefixed `.md` shape.

**Architecture:** A pure backend module (`server/libraryExport.js`) renders documents to `.md` strings and computes filenames; a new repository method lists active docs with project slug joined; a new `GET /api/library/export` route streams a ZIP via `archiver`. A mirror pure browser module (`public/js/libraryExport.js`) builds the same `.md` bytes for the single-doc download and triggers a browser download. Two UI touchpoints: an `[x] export` button on the document editor toolbar and a new `Library` section on the Admin panel with per-project and all-projects buttons.

**Tech Stack:** Node 20, Fastify, Postgres via `pg`, plain-JS frontend, Node built-in test runner (`node --test`). New dependency: `archiver@^7`.

**Spec:** [docs/superpowers/specs/2026-05-28-library-export-design.md](../specs/2026-05-28-library-export-design.md)

---

## Task 1: Backend pure module — `server/libraryExport.js`

**Files:**
- Create: `server/libraryExport.js`
- Test: `tests/backend/libraryExport.test.js`

Pure functions for rendering a document to its `.md` form and computing filenames. No I/O. All edge-case logic lives here so tests don't need Fastify or `archiver`.

- [ ] **Step 1: Write the failing tests**

Create `tests/backend/libraryExport.test.js` with the full fixture set:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatFrontMatter,
  renderDocumentMarkdown,
  documentFilename,
  dedupeFilenames,
  libraryArchiveFilename,
} from '../../server/libraryExport.js';

const BASE_DOC = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Postgres restore',
  body: '# Postgres restore\n\nSteps...\n',
  documentType: 'runbook',
  projectId: 'pid',
  tags: ['postgres', 'dr'],
  sourceFilename: null,
  archivedAt: null,
  createdAt: '2026-04-12T10:33:21.000Z',
  updatedAt: '2026-05-20T08:11:09.000Z',
};

test('formatFrontMatter emits all six fields with block-sequence tags', () => {
  const fm = formatFrontMatter(BASE_DOC, 'homelab');
  assert.match(fm, /^---\n/);
  assert.match(fm, /\n---\n$/);
  assert.match(fm, /\ntitle: Postgres restore\n/);
  assert.match(fm, /\ntype: runbook\n/);
  assert.match(fm, /\nproject: homelab\n/);
  assert.match(fm, /\ntags:\n  - postgres\n  - dr\n/);
  assert.match(fm, /\ncreated_at: 2026-04-12T10:33:21\.000Z\n/);
  assert.match(fm, /\nupdated_at: 2026-05-20T08:11:09\.000Z\n/);
});

test('formatFrontMatter renders empty tag list as tags: []', () => {
  const fm = formatFrontMatter({ ...BASE_DOC, tags: [] }, 'homelab');
  assert.match(fm, /\ntags: \[\]\n/);
  assert.doesNotMatch(fm, /\n  - /);
});

test('formatFrontMatter double-quotes titles with YAML-significant chars', () => {
  const cases = [
    { title: 'Has: colon', expect: '"Has: colon"' },
    { title: 'Has "quote"', expect: '"Has \\"quote\\""' },
    { title: 'Back\\slash', expect: '"Back\\\\slash"' },
    { title: '- leading dash', expect: '"- leading dash"' },
  ];
  for (const { title, expect } of cases) {
    const fm = formatFrontMatter({ ...BASE_DOC, title }, 'homelab');
    assert.match(fm, new RegExp(`\\ntitle: ${expect.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`));
  }
});

test('formatFrontMatter falls back to "unknown" when project slug is missing', () => {
  const fm = formatFrontMatter(BASE_DOC, '');
  assert.match(fm, /\nproject: unknown\n/);
});

test('renderDocumentMarkdown writes front-matter, blank line, body, single trailing newline', () => {
  const out = renderDocumentMarkdown(BASE_DOC, 'homelab');
  assert.ok(out.startsWith('---\n'));
  assert.ok(out.includes('\n---\n\n# Postgres restore\n'));
  assert.ok(out.endsWith('\n'));
  assert.ok(!out.endsWith('\n\n'));
});

test('renderDocumentMarkdown preserves body containing literal --- lines', () => {
  const body = 'before\n---\nafter\n';
  const out = renderDocumentMarkdown({ ...BASE_DOC, body }, 'homelab');
  assert.ok(out.endsWith('before\n---\nafter\n'));
});

test('renderDocumentMarkdown appends a trailing newline if body lacks one', () => {
  const out = renderDocumentMarkdown({ ...BASE_DOC, body: 'no newline' }, 'homelab');
  assert.ok(out.endsWith('no newline\n'));
});

test('documentFilename uses sanitized source_filename when present', () => {
  const name = documentFilename({ ...BASE_DOC, sourceFilename: 'runbooks/restore.md' });
  assert.equal(name, 'restore.md');
});

test('documentFilename appends .md when source_filename lacks the extension', () => {
  assert.equal(documentFilename({ ...BASE_DOC, sourceFilename: 'restore' }), 'restore.md');
});

test('documentFilename strips path traversal segments', () => {
  assert.equal(documentFilename({ ...BASE_DOC, sourceFilename: '../../etc/passwd' }), 'passwd.md');
  assert.equal(documentFilename({ ...BASE_DOC, sourceFilename: '..\\foo.md' }), 'foo.md');
});

test('documentFilename slugifies the title when source_filename is missing', () => {
  assert.equal(
    documentFilename({ ...BASE_DOC, sourceFilename: null, title: 'Postgres Restore — Steps' }),
    'postgres-restore-steps.md',
  );
});

test('documentFilename falls back to untitled.md for empty/whitespace input', () => {
  assert.equal(documentFilename({ ...BASE_DOC, sourceFilename: null, title: '   ' }), 'untitled.md');
  assert.equal(documentFilename({ ...BASE_DOC, sourceFilename: '   ', title: '' }), 'untitled.md');
});

test('dedupeFilenames suffixes collisions within the same path prefix', () => {
  const entries = [
    { path: '', filename: 'foo.md' },
    { path: '', filename: 'foo.md' },
    { path: '', filename: 'foo.md' },
    { path: 'work/', filename: 'foo.md' },
  ];
  dedupeFilenames(entries);
  assert.deepEqual(entries.map(e => `${e.path}${e.filename}`), [
    'foo.md', 'foo-2.md', 'foo-3.md', 'work/foo.md',
  ]);
});

test('libraryArchiveFilename emits per-project name with date', () => {
  const date = new Date('2026-05-28T12:00:00.000Z');
  assert.equal(libraryArchiveFilename('homelab', date), 'moomora-console-library-homelab-2026-05-28.zip');
});

test('libraryArchiveFilename emits all-projects name with date', () => {
  const date = new Date('2026-05-28T12:00:00.000Z');
  assert.equal(libraryArchiveFilename('all', date), 'moomora-console-library-all-2026-05-28.zip');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/backend/libraryExport.test.js`
Expected: FAIL — `Cannot find package '../../server/libraryExport.js'` or `Cannot find module`.

- [ ] **Step 3: Implement the module**

Create `server/libraryExport.js`:

```js
const YAML_QUOTE_TRIGGER = /[:"\\\n]|^-|^\s|\s$/;

function yamlString(value) {
  const str = String(value ?? '');
  if (str === '') return '""';
  if (!YAML_QUOTE_TRIGGER.test(str)) return str;
  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function formatFrontMatter(doc, projectSlug) {
  const tags = Array.isArray(doc.tags) ? doc.tags : [];
  const tagsBlock = tags.length === 0
    ? 'tags: []'
    : `tags:\n${tags.map(tag => `  - ${yamlString(tag)}`).join('\n')}`;
  const slug = projectSlug && String(projectSlug).trim() ? String(projectSlug) : 'unknown';

  return [
    '---',
    `title: ${yamlString(doc.title || '')}`,
    `type: ${doc.documentType || 'note'}`,
    `project: ${slug}`,
    tagsBlock,
    `created_at: ${doc.createdAt || ''}`,
    `updated_at: ${doc.updatedAt || ''}`,
    '---',
    '',
  ].join('\n');
}

export function renderDocumentMarkdown(doc, projectSlug) {
  const frontMatter = formatFrontMatter(doc, projectSlug);
  const body = String(doc.body ?? '');
  const bodyWithNewline = body.endsWith('\n') ? body : `${body}\n`;
  return `${frontMatter}\n${bodyWithNewline}`;
}

function basename(value) {
  return String(value || '').split(/[\\/]/).pop() || '';
}

function stripLeadingDots(value) {
  return value.replace(/^\.+/, '');
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function documentFilename(doc) {
  const raw = stripLeadingDots(basename(doc?.sourceFilename || '').trim());
  if (raw) {
    return /\.md$/i.test(raw) ? raw : `${raw}.md`;
  }
  const slug = slugify(doc?.title || '');
  return slug ? `${slug}.md` : 'untitled.md';
}

export function dedupeFilenames(entries) {
  const counts = new Map();
  for (const entry of entries) {
    const key = `${entry.path}${entry.filename}`;
    const n = counts.get(key) || 0;
    counts.set(key, n + 1);
    if (n > 0) {
      const ext = entry.filename.match(/\.md$/i)?.[0] || '';
      const stem = entry.filename.slice(0, entry.filename.length - ext.length);
      entry.filename = `${stem}-${n + 1}${ext}`;
    }
  }
}

export function libraryArchiveFilename(scope, date = new Date()) {
  const safe = String(scope || 'all')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'all';
  const day = date.toISOString().slice(0, 10);
  return `moomora-console-library-${safe}-${day}.zip`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/backend/libraryExport.test.js`
Expected: PASS, all assertions green.

- [ ] **Step 5: Commit**

```bash
git add server/libraryExport.js tests/backend/libraryExport.test.js
git commit -m "feat: add libraryExport pure module for .md serialization and filenames"
```

---

## Task 2: Repository — `listActiveDocumentsForExport`

**Files:**
- Modify: `server/libraryRepository.js`
- Modify: `scripts/demo-server.js` (in-memory mirror)
- Test: `tests/backend/libraryRepository.test.js` (extend)

Adds one query to the repository that returns active docs joined with their project slug, optionally scoped to a single project id.

- [ ] **Step 1: Write the failing tests**

Append to `tests/backend/libraryRepository.test.js`:

```js
import {
  buildListActiveDocumentsForExport,
} from '../../server/libraryRepository.js';

test('buildListActiveDocumentsForExport joins projects and filters archived', () => {
  const query = buildListActiveDocumentsForExport({});
  assert.match(query.text, /from markdown_documents d/);
  assert.match(query.text, /join projects p on p\.id = d\.project_id/);
  assert.match(query.text, /d\.archived_at is null/);
  assert.match(query.text, /order by p\.slug, d\.title/);
  assert.deepEqual(query.values, []);
});

test('buildListActiveDocumentsForExport scopes to a single project id', () => {
  const query = buildListActiveDocumentsForExport({ projectId: PROJECT_UUID });
  assert.match(query.text, /d\.project_id = \$1/);
  assert.deepEqual(query.values, [PROJECT_UUID]);
});

test('createLibraryRepository.listActiveDocumentsForExport normalizes rows with project_slug', async () => {
  const captured = [];
  const fakeDb = {
    async query(text, values) {
      captured.push({ text, values });
      return {
        rows: [{
          id: DOCUMENT_ID,
          title: 'Restore',
          body: '# Restore',
          document_type: 'runbook',
          project_id: PROJECT_UUID,
          tags: ['postgres'],
          source_filename: 'restore.md',
          archived_at: null,
          created_at: '2026-05-18T10:00:00.000Z',
          updated_at: '2026-05-18T10:00:00.000Z',
          project_slug: 'homelab',
        }],
      };
    },
  };
  const repository = createLibraryRepository(fakeDb);
  const rows = await repository.listActiveDocumentsForExport({ projectId: PROJECT_UUID });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].projectSlug, 'homelab');
  assert.equal(rows[0].title, 'Restore');
  assert.equal(rows[0].documentType, 'runbook');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/backend/libraryRepository.test.js`
Expected: FAIL — `buildListActiveDocumentsForExport is not a function` / `listActiveDocumentsForExport is not a function`.

- [ ] **Step 3: Implement the builder and repo method**

In `server/libraryRepository.js`, add the builder after `buildDeleteArchivedDocument` and the repo method inside `createLibraryRepository`:

```js
export function buildListActiveDocumentsForExport({ projectId } = {}) {
  const values = [];
  let where = 'where d.archived_at is null';
  if (projectId) {
    values.push(projectId);
    where += ` and d.project_id = $${values.length}`;
  }
  return {
    text: `
      select d.*, p.slug as project_slug
      from markdown_documents d
      join projects p on p.id = d.project_id
      ${where}
      order by p.slug, d.title
    `,
    values,
  };
}
```

Update `normalizeDocumentRow` to pass through `project_slug` when present:

```js
export function normalizeDocumentRow(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    documentType: row.document_type,
    projectId: row.project_id,
    tags: row.tags || [],
    sourceFilename: row.source_filename,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.project_slug !== undefined ? { projectSlug: row.project_slug } : {}),
  };
}
```

Inside `createLibraryRepository`, add:

```js
    async listActiveDocumentsForExport(filters = {}) {
      const query = buildListActiveDocumentsForExport(filters);
      const result = await db.query(query.text, query.values);
      return result.rows.map(normalizeDocumentRow);
    },
```

- [ ] **Step 4: Mirror in the demo server**

In `scripts/demo-server.js`, add `listActiveDocumentsForExport` to the `createMemoryLibraryRepository` returned object. The function needs the projects array to attach `projectSlug`; the simplest reuse is to look up via `sharedProjects` (visible in module scope alongside `sharedDocuments`).

Insert after `deleteArchivedDocument` in the returned object:

```js
    async listActiveDocumentsForExport(filters = {}) {
      const filtered = documents.filter((document) => {
        if (document.archivedAt) return false;
        if (filters.projectId && document.projectId !== filters.projectId) return false;
        return true;
      });
      return filtered
        .map((doc) => {
          const project = sharedProjects.find(p => p.id === doc.projectId);
          return { ...doc, projectSlug: project?.slug || 'unknown' };
        })
        .sort((a, b) => {
          const slugCompare = (a.projectSlug || '').localeCompare(b.projectSlug || '');
          return slugCompare !== 0 ? slugCompare : (a.title || '').localeCompare(b.title || '');
        });
    },
```

(`sharedProjects` is already defined earlier in `scripts/demo-server.js` and used by `createMemoryProjectsRepository`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/backend/libraryRepository.test.js`
Expected: PASS.

Also run the full backend suite to confirm no regression in route or repo tests:

Run: `npm test -- tests/backend`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/libraryRepository.js scripts/demo-server.js tests/backend/libraryRepository.test.js
git commit -m "feat: add listActiveDocumentsForExport with project slug join"
```

---

## Task 3: Add `archiver` dependency

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install the dependency**

Run: `npm install archiver@^7`
Expected: package-lock updates, `archiver` listed under `dependencies` in `package.json`.

- [ ] **Step 2: Sanity-check the version**

Run: `node -e "import('archiver').then(m => console.log(typeof m.default))"`
Expected: `function` (archiver is a callable factory).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add archiver dep for library ZIP export"
```

---

## Task 4: `GET /api/library/export` route

**Files:**
- Modify: `server/libraryRoutes.js`
- Test: `tests/backend/libraryExportRoute.test.js`

Streams a ZIP of `.md` files via `archiver`. Per-project = flat entries; all = `<project-slug>/` prefix. Skips archived docs. Returns 400 for an unresolvable project slug; returns 200 with an empty ZIP otherwise.

- [ ] **Step 1: Write the failing tests**

Create `tests/backend/libraryExportRoute.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { buildApp } from '../../server/index.js';

const PROJECT_HOMELAB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT_WORK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function readZipEntries(buffer) {
  const entries = [];
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('no EOCD found');
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  let p = cdOffset;
  while (p < cdOffset + cdSize) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central dir entry');
    const method = buffer.readUInt16LE(p + 10);
    const compSize = buffer.readUInt32LE(p + 20);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const localOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.slice(p + 46, p + 46 + nameLen).toString('utf8');
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buffer.slice(dataStart, dataStart + compSize);
    const body = method === 0 ? compressed : zlib.inflateRawSync(compressed);
    entries.push({ name, body: body.toString('utf8') });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function createFakeProjects() {
  return {
    async resolveProject(value) {
      if (value === 'homelab' || value === PROJECT_HOMELAB) return { id: PROJECT_HOMELAB, slug: 'homelab', status: 'active' };
      if (value === 'work' || value === PROJECT_WORK) return { id: PROJECT_WORK, slug: 'work', status: 'active' };
      return null;
    },
  };
}

function createFakeLibrary(docs) {
  return {
    async listDocuments() { return docs.filter(d => !d.archivedAt); },
    async createDocument() { throw new Error('not used'); },
    async updateDocument() { throw new Error('not used'); },
    async archiveDocument() { throw new Error('not used'); },
    async restoreDocument() { throw new Error('not used'); },
    async deleteArchivedDocument() { throw new Error('not used'); },
    async listActiveDocumentsForExport({ projectId } = {}) {
      return docs
        .filter(d => !d.archivedAt)
        .filter(d => !projectId || d.projectId === projectId)
        .sort((a, b) => a.projectSlug.localeCompare(b.projectSlug) || a.title.localeCompare(b.title));
    },
  };
}

async function buildTestApp(docs) {
  return buildApp({
    config: { host: '127.0.0.1', port: 0 },
    logger: false,
    skipDb: true,
    libraryRepository: createFakeLibrary(docs),
    projectsRepository: createFakeProjects(),
  });
}

const FIXTURE_DOCS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Postgres restore',
    body: '# Restore steps\n',
    documentType: 'runbook',
    projectId: PROJECT_HOMELAB,
    projectSlug: 'homelab',
    tags: ['postgres'],
    sourceFilename: 'restore.md',
    archivedAt: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-02T00:00:00.000Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Standup notes',
    body: 'Notes body\n',
    documentType: 'note',
    projectId: PROJECT_WORK,
    projectSlug: 'work',
    tags: [],
    sourceFilename: null,
    archivedAt: null,
    createdAt: '2026-05-03T00:00:00.000Z',
    updatedAt: '2026-05-04T00:00:00.000Z',
  },
];

test('GET /api/library/export?project=all returns a ZIP grouped by project slug', async () => {
  const app = await buildTestApp(FIXTURE_DOCS);
  const response = await app.inject({ method: 'GET', url: '/api/library/export?project=all' });
  await app.close();

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/zip');
  assert.match(response.headers['content-disposition'], /filename="moomora-console-library-all-\d{4}-\d{2}-\d{2}\.zip"/);

  const entries = readZipEntries(response.rawPayload);
  const names = entries.map(e => e.name).sort();
  assert.deepEqual(names, ['homelab/restore.md', 'work/standup-notes.md']);

  const restore = entries.find(e => e.name === 'homelab/restore.md');
  assert.match(restore.body, /^---\n/);
  assert.match(restore.body, /\ntitle: Postgres restore\n/);
  assert.match(restore.body, /\nproject: homelab\n/);
  assert.ok(restore.body.endsWith('# Restore steps\n'));
});

test('GET /api/library/export?project=homelab returns flat entries for that project only', async () => {
  const app = await buildTestApp(FIXTURE_DOCS);
  const response = await app.inject({ method: 'GET', url: '/api/library/export?project=homelab' });
  await app.close();

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-disposition'], /filename="moomora-console-library-homelab-\d{4}-\d{2}-\d{2}\.zip"/);

  const entries = readZipEntries(response.rawPayload);
  assert.deepEqual(entries.map(e => e.name), ['restore.md']);
});

test('GET /api/library/export?project=does-not-exist returns 400', async () => {
  const app = await buildTestApp(FIXTURE_DOCS);
  const response = await app.inject({ method: 'GET', url: '/api/library/export?project=does-not-exist' });
  await app.close();

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.payload), { message: 'project is invalid' });
});

test('GET /api/library/export on empty library returns a valid empty ZIP', async () => {
  const app = await buildTestApp([]);
  const response = await app.inject({ method: 'GET', url: '/api/library/export?project=all' });
  await app.close();

  assert.equal(response.statusCode, 200);
  const entries = readZipEntries(response.rawPayload);
  assert.equal(entries.length, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/backend/libraryExportRoute.test.js`
Expected: FAIL — `404 Not Found` for the route (no such endpoint yet).

- [ ] **Step 3: Implement the route**

In `server/libraryRoutes.js`, add the import at the top:

```js
import archiver from 'archiver';
import {
  documentFilename,
  renderDocumentMarkdown,
  dedupeFilenames,
  libraryArchiveFilename,
} from './libraryExport.js';
```

Add the route inside `registerLibraryRoutes`, before the existing `app.get('/api/library/documents', ...)`:

```js
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

    const filename = libraryArchiveFilename(scope);
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => {
      request.log.error({ err }, 'library export archive error');
      reply.raw.destroy(err);
    });

    for (const entry of entries) {
      const content = renderDocumentMarkdown(entry.doc, entry.doc.projectSlug);
      archive.append(content, { name: `${entry.path}${entry.filename}` });
    }
    archive.finalize();

    return reply.send(archive);
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/backend/libraryExportRoute.test.js`
Expected: PASS.

Also run the full backend suite:

Run: `npm test -- tests/backend`
Expected: PASS.

- [ ] **Step 5: Run check**

Run: `npm run check`
Expected: PASS (syntax check on entry points).

- [ ] **Step 6: Commit**

```bash
git add server/libraryRoutes.js tests/backend/libraryExportRoute.test.js
git commit -m "feat: GET /api/library/export streams ZIP of .md files"
```

---

## Task 5: Browser pure module — `public/js/libraryExport.js`

**Files:**
- Create: `public/js/libraryExport.js`
- Test: `tests/frontend/libraryExport.test.js`

Mirror implementation of `renderDocumentMarkdown`/`documentFilename` in browser-safe JS, plus a `triggerDownload` DOM helper. Same fixtures as the backend tests pin the two implementations together byte-for-byte.

- [ ] **Step 1: Write the failing tests**

Create `tests/frontend/libraryExport.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExportedMarkdown,
  documentFilename,
  triggerDownload,
} from '../../public/js/libraryExport.js';
import { renderDocumentMarkdown } from '../../server/libraryExport.js';

const BASE_DOC = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Postgres restore',
  body: '# Postgres restore\n\nSteps...\n',
  documentType: 'runbook',
  projectId: 'pid',
  tags: ['postgres', 'dr'],
  sourceFilename: null,
  archivedAt: null,
  createdAt: '2026-04-12T10:33:21.000Z',
  updatedAt: '2026-05-20T08:11:09.000Z',
};

test('buildExportedMarkdown produces byte-identical output to server renderDocumentMarkdown', () => {
  const fixtures = [
    { doc: BASE_DOC, slug: 'homelab' },
    { doc: { ...BASE_DOC, tags: [] }, slug: 'homelab' },
    { doc: { ...BASE_DOC, title: 'Has: colon' }, slug: 'homelab' },
    { doc: { ...BASE_DOC, title: 'Has "quote"' }, slug: 'homelab' },
    { doc: { ...BASE_DOC, body: 'no newline' }, slug: 'homelab' },
    { doc: { ...BASE_DOC, body: 'before\n---\nafter\n' }, slug: 'homelab' },
    { doc: BASE_DOC, slug: '' },
  ];
  for (const { doc, slug } of fixtures) {
    assert.equal(buildExportedMarkdown(doc, slug), renderDocumentMarkdown(doc, slug));
  }
});

test('documentFilename matches server filename rules', () => {
  const cases = [
    { doc: { sourceFilename: 'runbooks/restore.md', title: 'x' }, expect: 'restore.md' },
    { doc: { sourceFilename: 'restore', title: 'x' }, expect: 'restore.md' },
    { doc: { sourceFilename: '../../etc/passwd', title: 'x' }, expect: 'passwd.md' },
    { doc: { sourceFilename: null, title: 'Postgres Restore — Steps' }, expect: 'postgres-restore-steps.md' },
    { doc: { sourceFilename: null, title: '   ' }, expect: 'untitled.md' },
  ];
  for (const { doc, expect } of cases) {
    assert.equal(documentFilename(doc), expect);
  }
});

test('triggerDownload creates an anchor, clicks it, and revokes the URL', () => {
  const events = [];
  const fakeAnchor = {
    set href(v) { events.push(`href:${v}`); },
    set download(v) { events.push(`download:${v}`); },
    click() { events.push('click'); },
  };
  const documentRef = {
    createElement(tag) { events.push(`create:${tag}`); return fakeAnchor; },
    body: { appendChild() { events.push('append'); }, removeChild() { events.push('remove'); } },
  };
  const URL = { createObjectURL: () => 'blob:fake', revokeObjectURL: (u) => events.push(`revoke:${u}`) };
  const blob = { fake: true };

  triggerDownload('foo.md', blob, { documentRef, URLRef: URL });

  assert.deepEqual(events, [
    'create:a',
    'href:blob:fake',
    'download:foo.md',
    'append',
    'click',
    'remove',
    'revoke:blob:fake',
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/frontend/libraryExport.test.js`
Expected: FAIL — cannot find `public/js/libraryExport.js`.

- [ ] **Step 3: Implement the browser module**

Create `public/js/libraryExport.js`:

```js
const YAML_QUOTE_TRIGGER = /[:"\\\n]|^-|^\s|\s$/;

function yamlString(value) {
  const str = String(value ?? '');
  if (str === '') return '""';
  if (!YAML_QUOTE_TRIGGER.test(str)) return str;
  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function formatFrontMatter(doc, projectSlug) {
  const tags = Array.isArray(doc.tags) ? doc.tags : [];
  const tagsBlock = tags.length === 0
    ? 'tags: []'
    : `tags:\n${tags.map(tag => `  - ${yamlString(tag)}`).join('\n')}`;
  const slug = projectSlug && String(projectSlug).trim() ? String(projectSlug) : 'unknown';

  return [
    '---',
    `title: ${yamlString(doc.title || '')}`,
    `type: ${doc.documentType || 'note'}`,
    `project: ${slug}`,
    tagsBlock,
    `created_at: ${doc.createdAt || ''}`,
    `updated_at: ${doc.updatedAt || ''}`,
    '---',
    '',
  ].join('\n');
}

export function buildExportedMarkdown(doc, projectSlug) {
  const body = String(doc?.body ?? '');
  const bodyWithNewline = body.endsWith('\n') ? body : `${body}\n`;
  return `${formatFrontMatter(doc, projectSlug)}\n${bodyWithNewline}`;
}

function basename(value) {
  return String(value || '').split(/[\\/]/).pop() || '';
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function documentFilename(doc) {
  const raw = basename(doc?.sourceFilename || '').replace(/^\.+/, '').trim();
  if (raw) return /\.md$/i.test(raw) ? raw : `${raw}.md`;
  const slug = slugify(doc?.title || '');
  return slug ? `${slug}.md` : 'untitled.md';
}

export function triggerDownload(filename, blob, options = {}) {
  const documentRef = options.documentRef || document;
  const URLRef = options.URLRef || URL;
  const url = URLRef.createObjectURL(blob);
  const anchor = documentRef.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  documentRef.body.appendChild(anchor);
  anchor.click();
  documentRef.body.removeChild(anchor);
  URLRef.revokeObjectURL(url);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/frontend/libraryExport.test.js`
Expected: PASS — including the cross-implementation byte-equality test against the server module.

- [ ] **Step 5: Commit**

```bash
git add public/js/libraryExport.js tests/frontend/libraryExport.test.js
git commit -m "feat: add browser libraryExport module mirroring server output"
```

---

## Task 6: Single-doc export — editor toolbar + handler

**Files:**
- Modify: `public/js/renderLibrary.js` (editor pane toolbar)
- Modify: `public/js/main.js` (handler wiring)
- Test: `tests/frontend/renderLibrary.test.js` (extend)

Render an `[x] export` bracket-button on the editor toolbar (active docs only — not in the archive view). Wire the handler in `main.js` to call `buildExportedMarkdown` + `triggerDownload`.

- [ ] **Step 1: Write the failing render tests**

Append to `tests/frontend/renderLibrary.test.js` (or add to the relevant `describe` block — check the existing structure first; if the file is purely flat `test(...)` calls, just append):

```js
test('renderLibraryHtml shows [x] export on the editor toolbar for active docs', () => {
  const html = renderLibraryHtml({
    documents: [{
      id: 'd1',
      title: 'Restore',
      body: '# r',
      documentType: 'runbook',
      projectId: 'p1',
      tags: [],
      sourceFilename: null,
      archivedAt: null,
      createdAt: 'now',
      updatedAt: 'now',
    }],
    selectedDocumentId: 'd1',
    editorMode: 'edit',
  });
  assert.match(html, /data-action="export-document"[^>]*data-document-id="d1"[^>]*>\[x\] export/);
});

test('renderLibraryHtml hides [x] export when the editor pane is not visible', () => {
  const html = renderLibraryHtml({
    documents: [{
      id: 'd1',
      title: 'Restore',
      body: '',
      documentType: 'note',
      projectId: 'p1',
      tags: [],
      sourceFilename: null,
      archivedAt: null,
      createdAt: 'now',
      updatedAt: 'now',
    }],
    selectedDocumentId: 'd1',
    editorMode: 'preview',
  });
  assert.doesNotMatch(html, /data-action="export-document"/);
});
```

Note on the second test: the export button is rendered inside `renderEditorPane`, which appears only when the editor is visible (`editorMode === 'edit' || 'split'`). So the assertion that it's hidden in `preview` mode is by virtue of where it lives.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/frontend/renderLibrary.test.js`
Expected: FAIL — `[x] export` button is missing.

- [ ] **Step 3: Add the button to the editor pane**

In `public/js/renderLibrary.js`, modify `renderEditorPane` — extend the `document-pane-actions` div to include the export button alongside the existing focus/save buttons. The function currently takes `(body, options = {})`; thread the document id through.

Update the call site in `renderDocumentDetail` (around line 313) from:

```js
${editorVisible ? renderEditorPane(body, { isDirty, saveStatus: options.saveStatus, isFocusMode }) : ''}
```

to:

```js
${editorVisible ? renderEditorPane(body, { isDirty, saveStatus: options.saveStatus, isFocusMode, documentId: document.id }) : ''}
```

And in `renderEditorPane`, change the actions block:

```js
        <div class="document-pane-actions">
          <button class="bracket-button" type="button" data-action="toggle-document-focus" aria-label="Focus writing mode" aria-pressed="${Boolean(options.isFocusMode)}">[f] focus</button>
          <button class="bracket-button" type="button" data-action="export-document" data-document-id="${escapeHtml(options.documentId || '')}" aria-label="Export document as Markdown">[x] export</button>
          <button class="bracket-button bracket-button--primary" type="button" data-action="save-document-draft"${options.isDirty ? '' : ' disabled'}>[s] save</button>
        </div>
```

- [ ] **Step 4: Run render tests to verify they pass**

Run: `npm test -- tests/frontend/renderLibrary.test.js`
Expected: PASS.

- [ ] **Step 5: Wire the click handler in `main.js`**

Add the import at the top of `public/js/main.js` (group with existing same-folder imports):

```js
import { buildExportedMarkdown, documentFilename as libraryDocumentFilename, triggerDownload as libraryTriggerDownload } from './libraryExport.js';
```

Find the function that binds library detail-panel events (search for `data-action="save-document-draft"` to locate it). Add a handler that delegates to a new `exportLibraryDocument(id)` function. Pattern, anchored to the existing save handler in the same scope:

```js
function exportLibraryDocument(documentId) {
  const doc = state.documents.find(d => d.id === documentId);
  if (!doc) return;
  const project = state.projects.find(p => p.id === doc.projectId);
  const slug = project?.slug || 'unknown';
  const markdown = buildExportedMarkdown(doc, slug);
  const blob = new Blob([markdown], { type: 'text/markdown' });
  libraryTriggerDownload(libraryDocumentFilename(doc), blob);
}
```

In the bind function near `[data-action="save-document-draft"]` (around `public/js/main.js:1086` — the local variable is `workspace`), add immediately after the focus-toggle handler:

```js
  workspace.querySelector('[data-action="export-document"]')?.addEventListener('click', (event) => {
    const id = event.currentTarget.getAttribute('data-document-id');
    if (id) exportLibraryDocument(id);
  });
```

- [ ] **Step 6: Run the full check + smoke**

Run: `npm run check`
Expected: PASS.

Run: `npm test`
Expected: PASS (entire suite green).

- [ ] **Step 7: Commit**

```bash
git add public/js/renderLibrary.js public/js/main.js tests/frontend/renderLibrary.test.js
git commit -m "feat: single-doc .md export from library editor toolbar"
```

---

## Task 7: Bulk export — Admin panel Library section

**Files:**
- Modify: `public/js/renderAdminPanel.js`
- Modify: `public/js/main.js`
- Test: `tests/frontend/renderAdminPanel.test.js` (extend)

Adds a `Library` section above the existing Tasks `Backup` section. Two bracket-buttons: per-project and all-projects. Click handlers navigate to the streaming export URL (browser handles the download via `Content-Disposition`).

- [ ] **Step 1: Write the failing render tests**

Append to `tests/frontend/renderAdminPanel.test.js`:

```js
test('admin panel renders a Library section with per-project and all-projects export buttons', () => {
  const html = renderAdminPanelHtml({
    activeProject: 'p1',
    projects: TEST_PROJECTS,
    taskCount: 0,
    documentCount: 4,
    importMode: 'skip',
  });
  assert.match(html, /Library/);
  assert.match(html, /4 documents/);
  assert.match(html, /data-action="export-library-project"[^>]*>\[x\] export Homelab/);
  assert.match(html, /data-action="export-library-all"[^>]*>\[X\] export all/);
});

test('admin panel Library section uses "all projects" label when activeProject is all', () => {
  const html = renderAdminPanelHtml({
    activeProject: 'all',
    projects: TEST_PROJECTS,
    taskCount: 0,
    documentCount: 0,
    importMode: 'skip',
  });
  assert.match(html, /data-action="export-library-project"[^>]*>\[x\] export all projects/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/frontend/renderAdminPanel.test.js`
Expected: FAIL — Library section missing.

- [ ] **Step 3: Add the Library section to `renderAdminPanelHtml`**

In `public/js/renderAdminPanel.js`, extend the signature default args to accept `documentCount`:

```js
export function renderAdminPanelHtml({
  activeProject = 'all',
  projects = [],
  taskCount = 0,
  documentCount = 0,
  importMode = 'skip',
} = {}) {
```

After `safeTaskCount` define:

```js
  const safeDocumentCount = Number.isFinite(Number(documentCount)) ? Number(documentCount) : 0;
```

Insert a new `<section>` immediately before the existing Backup section (i.e. between the `<div class="admin-sections">` opener and the Backup section):

```js
          <section class="admin-section" aria-labelledby="library-export-title">
            <div>
              <h3 id="library-export-title">Library</h3>
              <p>${safeProjectName} &middot; ${safeDocumentCount} documents &middot; Generated at download time</p>
            </div>
            <div class="admin-actions">
              <button class="bracket-button" type="button" data-action="export-library-project">[x] export ${safeProjectName}</button>
              <button class="bracket-button" type="button" data-action="export-library-all">[X] export all</button>
            </div>
          </section>
```

- [ ] **Step 4: Pass the document count from `renderApp`**

In `public/js/main.js` at the `renderAdminPanelHtml` call (around `main.js:1532`), add `documentCount` next to `taskCount`:

```js
    app.insertAdjacentHTML('beforeend', renderAdminPanelHtml({
      activeProject: state.activeProject,
      projects: state.projects,
      taskCount: state.tasks.length,
      documentCount: (state.documents || []).filter(d => !d.archivedAt && (state.activeProject === 'all' || d.projectId === state.activeProject)).length,
      importMode: state.adminImportMode,
    }));
```

- [ ] **Step 5: Wire the click handlers**

In `bindAdminPanelEvents` (near the existing `export-project` / `export-all` handlers), add:

```js
  panel.querySelector('[data-action="export-library-project"]')?.addEventListener('click', () => {
    const scope = state.activeProject === 'all'
      ? 'all'
      : (state.projects.find(p => p.id === state.activeProject)?.slug || 'all');
    window.location.href = `/api/library/export?project=${encodeURIComponent(scope)}`;
  });

  panel.querySelector('[data-action="export-library-all"]')?.addEventListener('click', () => {
    window.location.href = '/api/library/export?project=all';
  });
```

- [ ] **Step 6: Run the full check + tests**

Run: `npm run check`
Expected: PASS.

Run: `npm test`
Expected: PASS (full suite green).

- [ ] **Step 7: Commit**

```bash
git add public/js/renderAdminPanel.js public/js/main.js tests/frontend/renderAdminPanel.test.js
git commit -m "feat: bulk library ZIP export from admin panel"
```

---

## Task 8: End-to-end verification

**Files:** none modified — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 2: Run the syntax check**

Run: `npm run check`
Expected: No syntax errors.

- [ ] **Step 3: Manual smoke against the demo server**

Run (in one terminal): `npm run demo`

Open `http://127.0.0.1:3100/` in a browser and verify:

1. Library → select a document → switch the editor to `edit` or `split` mode → click `[x] export`. A `.md` file downloads. Open it; confirm it begins with a `---` front-matter block containing `title`, `type`, `project`, `tags`, `created_at`, `updated_at`, followed by a blank line and the body.
2. Open Admin → confirm a new `Library` section is visible above `Backup`, showing the active project name (or "all projects") and document count.
3. Click `[x] export <project>`. A ZIP downloads named `moomora-console-library-<slug>-YYYY-MM-DD.zip`. Open it; entries are flat `.md` files, one per document, each with the front-matter shape above.
4. Click `[X] export all`. A ZIP downloads named `moomora-console-library-all-YYYY-MM-DD.zip`. Entries are grouped under `<project-slug>/...`.
5. With a project that has no active documents selected, click `[x] export <project>`. A ZIP still downloads and is a valid empty archive (extracting it produces no files but no error).

Stop the demo server with Ctrl+C.

- [ ] **Step 4: If any smoke step failed, fix and recommit**

If the smoke turned up a regression, debug, fix, add a regression test where reasonable, and commit. If everything passed, no commit is needed for this task.

---

## Self-review checklist

- [x] **Spec coverage:** file shape (Task 1), filename rules (Task 1), ZIP structure (Task 4), download filenames (Tasks 1+4), backend module (Task 1), repository method (Task 2), route (Task 4), `archiver` dep (Task 3), demo mirror (Task 2), browser module (Task 5), single-doc UI (Task 6), bulk UI (Task 7), error handling (Tasks 4+6+7 — 400 on unknown project, empty ZIP for empty result, archiver error → destroy, slug fallback to "unknown"), filename safety (Task 1 dedupe + sanitize), all test cases listed in spec (Tasks 1, 4, 5, 6, 7).
- [x] **No placeholder steps:** every code step shows the actual code; every command step shows expected output.
- [x] **Type/name consistency:** `formatFrontMatter`, `renderDocumentMarkdown`, `documentFilename`, `dedupeFilenames`, `libraryArchiveFilename` are defined in Task 1 and reused in Tasks 4 and 5 under the same names. `listActiveDocumentsForExport` is defined in Task 2 and used in Task 4. `buildExportedMarkdown`, `documentFilename`, `triggerDownload` are defined in Task 5 and used in Task 6 (the imports use renamed aliases `libraryDocumentFilename` / `libraryTriggerDownload` to avoid collision with anything else in `main.js` — pointed out at the import site). Data-action attributes `export-document`, `export-library-project`, `export-library-all` are introduced in render tasks and bound in the same `main.js` handlers.
