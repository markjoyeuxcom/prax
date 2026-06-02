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
