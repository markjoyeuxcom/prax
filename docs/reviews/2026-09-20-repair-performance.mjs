// In-process comparison, not a browser/production latency gate.
// node this-file.mjs <checkout-root> <label> <output-json>
// Uses the target checkout's large fixture and code in a disposable database.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, platform, arch } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const root = resolve(process.argv[2] || '.');
const label = process.argv[3] || 'working-tree';
const output = process.argv[4];
const load = path => import(pathToFileURL(join(root, path)));
const { createQualityFixture } = await load('scripts/create-quality-fixture.js');
const { buildApp } = await load('server/index.js');
const { loadConfig } = await load('server/config.js');
const { createLibraryRepository } = await load('server/libraryRepository.js');
const { collectionFingerprint } = await load('public/js/externalRefresh.js');
const { state, setState } = await load('public/js/state.js');
const folder = mkdtempSync(join(tmpdir(), 'prax-review-performance-'));
const samples = 51; const warmups = 10;
async function measure(operation, cleanup = () => {}) {
  const times = [];
  for (let i = 0; i < samples + warmups; i++) {
    const start = performance.now();
    await operation(i);
    const ms = performance.now() - start;
    await cleanup();
    if (i >= warmups) times.push(ms);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const rounded = n => Number(n.toFixed(4));
  return { p50Ms: rounded(sorted[Math.ceil(samples * 0.5) - 1]), p95Ms: rounded(sorted[Math.ceil(samples * 0.95) - 1]), samplesMs: times.map(rounded) };
}
let app;
try {
  const fixture = await createQualityFixture({ databaseFile: join(folder, 'fixture.db'), profile: 'large', embeddings: false });
  app = await buildApp({ config: loadConfig({ PRAX_DB_FILE: fixture.databaseFile, EMBEDDING_BACKEND: 'none' }) });
  const inject = async (method, url, payload) => {
    const response = await app.inject({ method, url, payload });
    assert.ok(response.statusCode < 400, `${response.statusCode} ${response.body}`);
    return response.json();
  };
  const documents = await inject('GET', '/api/library/documents?archived=all');
  const tasks = await inject('GET', '/api/tasks?archived=all');
  const metrics = {};
  metrics.listDocuments = await measure(() => inject('GET', '/api/library/documents?archived=all'));
  metrics.fingerprintWorkspace = await measure(() => {
    collectionFingerprint(documents); collectionFingerprint(tasks);
  });
  metrics.thousandDraftStateChanges = await measure(i => {
    for (let n = 0; n < 1000; n++) setState({ documentDraftBody: `input ${i}-${n}`, isDocumentDirty: true });
    assert.equal(state.isDocumentDirty, true);
  });
  const repository = createLibraryRepository(app.db);
  const projectId = documents[0].projectId;
  const doc = await repository.createDocument({ title: 'Update benchmark', body: 'baseline', documentType: 'note', projectId });
  const updatePath = `/api/library/documents/${doc.id}/update`;
  const probe = await app.inject({ method: 'POST', url: updatePath, payload: { operationId: randomUUID(), body: 'probe' } });
  assert.ok([200, 404].includes(probe.statusCode));
  const receipts = probe.statusCode === 200;
  metrics.updateDocument = await measure(i => inject(receipts ? 'POST' : 'PATCH', receipts ? updatePath : `/api/library/documents/${doc.id}`,
    { body: `measured update ${i}`, ...(receipts ? { operationId: randomUUID() } : {}) }));
  // Valid insertion requiring traversal of a 750-document replacement chain.
  const chain = [];
  for (let i = 0; i <= 750; i++) chain.push(await repository.createDocument({ title: `Chain ${i}`, body: 'fixture', documentType: 'note', projectId }));
  for (let i = 0; i < 749; i++) await inject('POST', `/api/library/documents/${chain[i].id}/links`, { targetId: chain[i + 1].id, relation: 'supersedes' });
  const source = chain[750].id; const target = chain[0].id;
  metrics.linkAcross750Documents = await measure(
    () => inject('POST', `/api/library/documents/${source}/links`, { targetId: target, relation: 'supersedes' }),
    () => inject('DELETE', `/api/library/documents/${source}/links/${target}?relation=supersedes`),
  );
  const report = { label, node: process.version, platform: platform(), arch: arch(),
    mode: 'in-process Fastify/SQLite and JS; no browser, network or model latency',
    samples, warmups, counts: { tasks: tasks.length, documents: documents.length }, receipts, metrics };
  const json = JSON.stringify(report, null, 2) + '\n';
  if (output) writeFileSync(resolve(output), json);
  console.log(JSON.stringify({ ...report, metrics: Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, { p50Ms: value.p50Ms, p95Ms: value.p95Ms }])) }, null, 2));
} finally {
  await app?.close();
  rmSync(folder, { recursive: true, force: true });
}
