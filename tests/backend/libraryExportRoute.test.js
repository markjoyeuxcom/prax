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
    async deleteDocument() { throw new Error('not used'); },
    async listActiveDocumentsForExport({ projectId } = {}) {
      return docs
        .filter(d => !d.archivedAt)
        .filter(d => !projectId || d.projectId === projectId)
        .sort((a, b) => a.projectSlug.localeCompare(b.projectSlug) || a.title.localeCompare(b.title));
    },
  };
}

function createFakeDocumentLinks(outboundMap = new Map()) {
  return {
    async listDocumentLinks() { return []; },
    async linkDocuments() { return { linked: true, alreadyLinked: false }; },
    async unlinkDocuments() { return true; },
    async listStaleDocuments() { return []; },
    async listOutboundLinksForDocuments() { return outboundMap; },
  };
}

async function buildTestApp(docs, outboundMap = new Map()) {
  return buildApp({
    skipDb: true,
    libraryRepository: createFakeLibrary(docs),
    projectsRepository: createFakeProjects(),
    documentLinksRepository: createFakeDocumentLinks(outboundMap),
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
  assert.match(response.headers['content-disposition'], /filename="prax-library-all-\d{4}-\d{2}-\d{2}\.zip"/);

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
  assert.match(response.headers['content-disposition'], /filename="prax-library-homelab-\d{4}-\d{2}-\d{2}\.zip"/);

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

test('GET /api/library/export propagates listActiveDocumentsForExport errors as 500', async () => {
  const failingLibrary = {
    async listDocuments() { return []; },
    async createDocument() { throw new Error('not used'); },
    async updateDocument() { throw new Error('not used'); },
    async archiveDocument() { throw new Error('not used'); },
    async restoreDocument() { throw new Error('not used'); },
    async deleteDocument() { throw new Error('not used'); },
    async listActiveDocumentsForExport() { throw new Error('database is down'); },
  };
  const app = await buildApp({
    logger: false,
    skipDb: true,
    libraryRepository: failingLibrary,
    projectsRepository: createFakeProjects(),
    documentLinksRepository: createFakeDocumentLinks(),
  });
  const response = await app.inject({ method: 'GET', url: '/api/library/export?project=all' });
  await app.close();

  assert.equal(response.statusCode, 500);
  // Fastify's default error response is JSON with a `message` field; the body should NOT be a ZIP
  assert.doesNotMatch(response.headers['content-type'] || '', /application\/zip/);
});

const DOC_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DOC_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LINK_DOCS = [
  {
    id: DOC_A_ID,
    title: 'Cloudflare plan',
    body: '# Cloudflare plan\n',
    documentType: 'note',
    projectId: PROJECT_HOMELAB,
    projectSlug: 'homelab',
    tags: [],
    sourceFilename: null,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    kind: 'source',
    contentHash: 'a'.repeat(64),
    updatedBy: 'user',
  },
  {
    id: DOC_B_ID,
    title: 'Postgres restore',
    body: '# Postgres restore\n',
    documentType: 'runbook',
    projectId: PROJECT_HOMELAB,
    projectSlug: 'homelab',
    tags: [],
    sourceFilename: null,
    archivedAt: null,
    createdAt: '2026-01-03T00:00:00.000Z',
    updatedAt: '2026-01-04T00:00:00.000Z',
    kind: 'synthesized',
    contentHash: 'b'.repeat(64),
    updatedBy: 'agent',
  },
];

test('GET /api/library/export emits v2 front-matter with links for linked docs', async () => {
  const outboundMap = new Map([
    [DOC_B_ID, {
      'derived-from': [{
        targetId: DOC_A_ID,
        targetProjectSlug: 'homelab',
        targetSourceFilename: null,
        targetTitle: 'Cloudflare plan',
      }],
      supersedes: [],
    }],
  ]);
  const app = await buildTestApp(LINK_DOCS, outboundMap);
  const response = await app.inject({ method: 'GET', url: '/api/library/export?project=homelab' });
  await app.close();

  assert.equal(response.statusCode, 200);

  const entries = readZipEntries(response.rawPayload);
  const docA = entries.find(e => e.name === 'cloudflare-plan.md');
  const docB = entries.find(e => e.name === 'postgres-restore.md');
  assert.ok(docA, 'cloudflare-plan.md should be present in ZIP');
  assert.ok(docB, 'postgres-restore.md should be present in ZIP');

  // Doc A has no outbound links — must emit the always-empty form
  assert.match(docA.body, /links:\n  derived-from: \[\]\n  supersedes: \[\]/);

  // Doc B is derived-from A — single-project export → bare filename ref
  assert.match(docB.body, new RegExp(`- id: ${DOC_A_ID}\\n      ref: cloudflare-plan\\.md`));
});

test('C16: link refs resolve to the final (collision-suffixed) zip entry names', async () => {
  const A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const C = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const mk = (id, title) => ({
    id, title, body: `# ${title}\n`, documentType: 'note', projectId: PROJECT_HOMELAB, projectSlug: 'homelab',
    tags: [], sourceFilename: null, archivedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
    kind: 'source', contentHash: 'a'.repeat(64), updatedBy: 'user',
  });
  const docs = [mk(A, 'Same!'), mk(B, 'Same?'), mk(C, 'Third')];
  const outboundMap = new Map([
    [C, { 'derived-from': [{ targetId: B, targetProjectSlug: 'homelab', targetSourceFilename: null, targetTitle: 'Same?' }], supersedes: [] }],
    [A, { 'derived-from': [], supersedes: [{ targetId: B, targetProjectSlug: 'homelab', targetSourceFilename: null, targetTitle: 'Same?' }] }],
  ]);
  const app = await buildTestApp(docs, outboundMap);
  const single = await app.inject({ method: 'GET', url: '/api/library/export?project=homelab' });
  const all = await app.inject({ method: 'GET', url: '/api/library/export?project=all' });
  await app.close();

  const entries = readZipEntries(single.rawPayload);
  assert.deepEqual(entries.map((e) => e.name).sort(), ['same-2.md', 'same.md', 'third.md']);
  const third = entries.find((e) => e.name === 'third.md');
  assert.match(third.body, new RegExp(`- id: ${B}\\n      ref: same-2\\.md`), 'the derived-from ref names the suffixed entry');
  const first = entries.find((e) => e.name === 'same.md');
  assert.match(first.body, new RegExp(`- id: ${B}\\n      ref: same-2\\.md`), 'the supersedes ref names the suffixed entry');

  const allEntries = readZipEntries(all.rawPayload);
  const thirdAll = allEntries.find((e) => e.name === 'homelab/third.md');
  assert.match(thirdAll.body, new RegExp(`- id: ${B}\\n      ref: homelab/same-2\\.md`));
});

test('case-only filename collisions get distinct entries and refs follow the deduped names', async () => {
  const IMPORTED = 'f1111111-1111-4111-8111-111111111111';
  const TITLED = 'f2222222-2222-4222-8222-222222222222';
  const LINKER = 'f3333333-3333-4333-8333-333333333333';
  const mk = (id, title, sourceFilename) => ({
    id, title, body: `# ${title} body\n`, documentType: 'note', projectId: PROJECT_HOMELAB, projectSlug: 'homelab',
    tags: [], sourceFilename, archivedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
    kind: 'source', contentHash: 'a'.repeat(64), updatedBy: 'user',
  });
  // Sorted by title: 'Imported setup' (Setup.md) is claimed before 'Setup' (setup.md).
  const docs = [mk(IMPORTED, 'Imported setup', 'Setup.md'), mk(TITLED, 'Setup', null), mk(LINKER, 'Zed', null)];
  const outboundMap = new Map([
    [LINKER, {
      'derived-from': [
        { targetId: IMPORTED, targetProjectSlug: 'homelab', targetSourceFilename: 'Setup.md', targetTitle: 'Imported setup' },
        { targetId: TITLED, targetProjectSlug: 'homelab', targetSourceFilename: null, targetTitle: 'Setup' },
      ],
      supersedes: [],
    }],
  ]);
  const app = await buildTestApp(docs, outboundMap);
  const single = await app.inject({ method: 'GET', url: '/api/library/export?project=homelab' });
  const all = await app.inject({ method: 'GET', url: '/api/library/export?project=all' });
  await app.close();

  const entries = readZipEntries(single.rawPayload);
  const names = entries.map((e) => e.name).sort();
  assert.deepEqual(names, ['Setup.md', 'setup-2.md', 'zed.md']);
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length, 'names stay distinct on a case-insensitive file system');
  assert.match(entries.find((e) => e.name === 'Setup.md').body, /# Imported setup body/);
  assert.match(entries.find((e) => e.name === 'setup-2.md').body, /# Setup body/);
  const linker = entries.find((e) => e.name === 'zed.md');
  assert.match(linker.body, new RegExp(`- id: ${IMPORTED}\\n      ref: Setup\\.md`));
  assert.match(linker.body, new RegExp(`- id: ${TITLED}\\n      ref: setup-2\\.md`));

  const allEntries = readZipEntries(all.rawPayload);
  assert.deepEqual(allEntries.map((e) => e.name).sort(), ['homelab/Setup.md', 'homelab/setup-2.md', 'homelab/zed.md']);
  const linkerAll = allEntries.find((e) => e.name === 'homelab/zed.md');
  assert.match(linkerAll.body, new RegExp(`- id: ${TITLED}\\n      ref: homelab/setup-2\\.md`));
});
