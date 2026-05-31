import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCUMENT_LINK_RELATIONS,
  buildLinkDocuments,
  buildUnlinkDocuments,
  buildListDocumentLinks,
  normalizeLinkRow,
  createDocumentLinksRepository,
} from '../../server/documentLinksRepository.js';

const SRC = '11111111-1111-4111-8111-111111111111';
const TGT = '22222222-2222-4222-8222-222222222222';

test('DOCUMENT_LINK_RELATIONS is the frozen MVP set', () => {
  assert.deepEqual(DOCUMENT_LINK_RELATIONS, ['derived-from', 'supersedes']);
});

test('buildLinkDocuments guards both endpoints are live and is idempotent', () => {
  const q = buildLinkDocuments(SRC, TGT, 'derived-from');
  assert.match(q.text, /insert into document_links/);
  assert.match(q.text, /archived_at is null/);
  assert.match(q.text, /on conflict .* do nothing/);
  assert.deepEqual(q.values, [SRC, TGT, 'derived-from']);
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

test('linkDocuments returns linked / alreadyLinked / not-linked', async () => {
  const inserted = { query: async () => ({ rows: [{ source_document_id: SRC }] }) };
  assert.deepEqual(await createDocumentLinksRepository(inserted).linkDocuments(SRC, TGT, 'derived-from'), { linked: true });

  let call = 0;
  const existing = { query: async () => (call++ === 0 ? { rows: [] } : { rows: [{ '?column?': 1 }] }) };
  assert.deepEqual(await createDocumentLinksRepository(existing).linkDocuments(SRC, TGT, 'derived-from'), { linked: true, alreadyLinked: true });

  const missing = { query: async () => ({ rows: [] }) };
  assert.deepEqual(await createDocumentLinksRepository(missing).linkDocuments(SRC, TGT, 'derived-from'), { linked: false });
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
