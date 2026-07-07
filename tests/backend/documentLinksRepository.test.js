import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCUMENT_LINK_RELATIONS,
  buildLinkDocuments,
  buildUnlinkDocuments,
  buildListDocumentLinks,
  normalizeLinkRow,
  createDocumentLinksRepository,
  buildListStaleDocuments,
  buildListOrphanDocuments,
  normalizeStaleRow,
} from '../../server/documentLinksRepository.js';

const SRC = '11111111-1111-4111-8111-111111111111';
const TGT = '22222222-2222-4222-8222-222222222222';

test('DOCUMENT_LINK_RELATIONS is the frozen MVP set', () => {
  assert.deepEqual(DOCUMENT_LINK_RELATIONS, ['derived-from', 'supersedes']);
});

test('buildLinkDocuments: derived-from upserts target_hash, supersedes stays do-nothing', () => {
  const derived = buildLinkDocuments(SRC, TGT, 'derived-from');
  assert.match(derived.text, /insert into document_links/);
  assert.match(derived.text, /target_hash/);
  assert.match(derived.text, /do update set target_hash = excluded\.target_hash/);
  assert.match(derived.text, /returning source_document_id/);
  assert.deepEqual(derived.values, [SRC, TGT, 'derived-from']);

  const sup = buildLinkDocuments(SRC, TGT, 'supersedes');
  assert.match(sup.text, /on conflict .* do nothing/);
  assert.doesNotMatch(sup.text, /target_hash/);
});

test('buildListDocumentLinks selects outbound, inbound, or both', () => {
  assert.match(buildListDocumentLinks(SRC, 'outbound').text, /source_document_id = \$1/);
  assert.doesNotMatch(buildListDocumentLinks(SRC, 'outbound').text, /union all/);
  assert.match(buildListDocumentLinks(SRC, 'inbound').text, /target_document_id = \$1/);
  assert.match(buildListDocumentLinks(SRC, 'both').text, /union all/);
});

test('normalizeLinkRow maps a row to the public link shape', () => {
  const row = { id: TGT, title: 'Restore', document_type: 'runbook', project_id: 'pid', relation: 'derived-from', direction: 'outbound' };
  assert.deepEqual(normalizeLinkRow(row), {
    documentId: TGT, title: 'Restore', documentType: 'runbook', projectId: 'pid',
    relation: 'derived-from', direction: 'outbound',
  });
});

test('linkDocuments(derived-from) returns linked vs alreadyLinked via the pre-upsert probe', async () => {
  // First query is the exists probe, second is the guarded upsert.
  const fresh = { calls: 0, async query() { this.calls += 1; return this.calls === 1 ? { rows: [] } : { rows: [{ source_document_id: SRC }] }; } };
  assert.deepEqual(await createDocumentLinksRepository(fresh).linkDocuments(SRC, TGT, 'derived-from'), { linked: true });

  const refreshed = { calls: 0, async query() { this.calls += 1; return this.calls === 1 ? { rows: [{ 1: 1 }] } : { rows: [{ source_document_id: SRC }] }; } };
  assert.deepEqual(await createDocumentLinksRepository(refreshed).linkDocuments(SRC, TGT, 'derived-from'), { linked: true, alreadyLinked: true });

  const missing = { query: async () => ({ rows: [] }) };
  assert.deepEqual(await createDocumentLinksRepository(missing).linkDocuments(SRC, TGT, 'derived-from'), { linked: false });
});

test('linkDocuments(supersedes) returns linked / alreadyLinked / not-linked via the exists probe', async () => {
  const inserted = { query: async () => ({ rows: [{ source_document_id: SRC }] }) };
  assert.deepEqual(await createDocumentLinksRepository(inserted).linkDocuments(SRC, TGT, 'supersedes'), { linked: true });

  let call = 0;
  const existing = { query: async () => (call++ === 0 ? { rows: [] } : { rows: [{ 1: 1 }] }) };
  assert.deepEqual(await createDocumentLinksRepository(existing).linkDocuments(SRC, TGT, 'supersedes'), { linked: true, alreadyLinked: true });

  const missing = { query: async () => ({ rows: [] }) };
  assert.deepEqual(await createDocumentLinksRepository(missing).linkDocuments(SRC, TGT, 'supersedes'), { linked: false });
});

test('buildListStaleDocuments compares target.content_hash to the edge snapshot, optional project filter', () => {
  const all = buildListStaleDocuments();
  assert.match(all.text, /relation = 'derived-from'/);
  assert.match(all.text, /content_hash is distinct from/);
  assert.match(all.text, /target_hash is not null/);
  assert.deepEqual(all.values, []);
  const scoped = buildListStaleDocuments('pid');
  assert.match(scoped.text, /project_id = \$1/);
  assert.deepEqual(scoped.values, ['pid']);
});

test('buildListOrphanDocuments finds docs with no inbound or outbound links', () => {
  const q = buildListOrphanDocuments();
  assert.match(q.text, /not exists/);
  assert.match(q.text, /source_document_id = d\.id/);
  assert.match(q.text, /target_document_id = d\.id/);
});

test('normalizeStaleRow maps the aggregated row', () => {
  const row = { id: SRC, title: 'Derived', document_type: 'note', project_id: 'p', updated_by: 'user', kind: 'source', stale_sources: [{ documentId: TGT, title: 'Source' }] };
  assert.deepEqual(normalizeStaleRow(row), {
    documentId: SRC, title: 'Derived', documentType: 'note', projectId: 'p', updatedBy: 'user', kind: 'source',
    staleSources: [{ documentId: TGT, title: 'Source' }],
  });
});

test('unlinkDocuments reports whether a row was removed', async () => {
  const removed = { query: async () => ({ rows: [{ source_document_id: SRC }] }) };
  assert.equal(await createDocumentLinksRepository(removed).unlinkDocuments(SRC, TGT, 'derived-from'), true);
  const none = { query: async () => ({ rows: [] }) };
  assert.equal(await createDocumentLinksRepository(none).unlinkDocuments(SRC, TGT, 'derived-from'), false);
});

test('listDocumentLinks maps rows and defaults direction to both', async () => {
  const calls = [];
  const db = { query: async (text, values) => { calls.push({ text, values }); return { rows: [{ id: TGT, title: 'R', document_type: 'note', project_id: 'p', relation: 'supersedes', direction: 'inbound' }] }; } };
  const out = await createDocumentLinksRepository(db).listDocumentLinks(SRC);
  assert.match(calls[0].text, /union all/);
  assert.deepEqual(out, [{ documentId: TGT, title: 'R', documentType: 'note', projectId: 'p', relation: 'supersedes', direction: 'inbound' }]);
});
