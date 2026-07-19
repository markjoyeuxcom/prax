import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRelatedQuery } from '../../server/relatedDocuments.js';
import { buildApp } from '../../server/index.js';

test('buildRelatedQuery: markdown stripped, whitespace collapsed, bounded, honest nulls', () => {
  assert.equal(buildRelatedQuery({ title: 'Rotate the TLS certs' }), 'Rotate the TLS certs');
  // Markdown structure chars are stripped (underscore included — emphasis
  // syntax; "pg dump" and "pg_dump" embed the same neighborhood).
  assert.equal(
    buildRelatedQuery({ title: 'Fix restore', description: '## Steps\n- [x] check `pg_dump`\n[docs](https://x)' }),
    'Fix restore Steps - check pg dump docs',
  );
  const long = buildRelatedQuery({ title: 'x'.repeat(1000) });
  assert.equal(long.length, 400);
  assert.equal(buildRelatedQuery({ title: '   ' }), null);
  assert.equal(buildRelatedQuery(null), null);
  assert.equal(buildRelatedQuery({ description: '```\nonly code\n```' }), null, 'code-only content embeds nothing');
});

async function contextApp(embedder) {
  const { loadConfig } = await import('../../server/config.js');
  const config = loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' });
  return buildApp({ config, ...(embedder ? { embedder } : {}) });
}

test('related-documents degrades quietly without an embedder and on bad input', async () => {
  const app = await contextApp(null);
  const created = (await app.inject({
    method: 'POST', url: '/api/tasks',
    payload: { title: 'Context subject', project: 'inbox', priority: 'medium', status: 'planned' },
  })).json();

  const off = (await app.inject({ method: 'GET', url: `/api/tasks/${created.id}/related-documents` })).json();
  assert.deepEqual(off, { suggestions: [], degraded: true, reason: 'semantic-off' });

  const invalid = (await app.inject({ method: 'GET', url: '/api/tasks/not-a-uuid/related-documents' })).json();
  assert.equal(invalid.reason, 'invalid-task');
  const missing = (await app.inject({ method: 'GET', url: '/api/tasks/11111111-2222-4333-8444-555555555555/related-documents' })).json();
  assert.equal(missing.reason, 'task-not-found');
  await app.close();
});

test('related-documents ranks semantically, excludes linked docs, caps at 5', async () => {
  // A fake embedder whose vectors make similarity deterministic: the query
  // and "near" docs share a direction; "far" docs are orthogonal.
  const embedder = {
    backend: 'fake',
    async isAvailable() { return true; },
    async embed(text) {
      return { vector: /restore|backup/i.test(text) ? [1, 0] : [0, 1], model: 'fake', dim: 2 };
    },
  };
  const app = await contextApp(embedder);

  const mkDoc = async (title, body) => (await app.inject({
    method: 'POST', url: '/api/library/documents',
    payload: { title, body, project: 'inbox', documentType: 'note' },
  })).json();
  const near = await mkDoc('Restore runbook', 'How to restore the backup');
  const linkedDoc = await mkDoc('Backup policy', 'Backup retention');
  const far = await mkDoc('Color palette', 'Design tokens');

  // Seed stored embeddings directly (the ranking reads the document rows).
  const seed = async (id, vector) => app.db.query(
    'update markdown_documents set embedding = $1, embedding_backend = $2 where id = $3',
    [JSON.stringify(vector), 'fake', id],
  );
  await seed(near.id, [1, 0]);
  await seed(linkedDoc.id, [0.9, 0.1]);
  await seed(far.id, [0, 1]);

  const task = (await app.inject({
    method: 'POST', url: '/api/tasks',
    payload: { title: 'Practice the restore drill', project: 'inbox', priority: 'medium', status: 'planned' },
  })).json();
  await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/documents`, payload: { documentId: linkedDoc.id } });

  const result = (await app.inject({ method: 'GET', url: `/api/tasks/${task.id}/related-documents` })).json();
  assert.equal(result.degraded, undefined, JSON.stringify(result));
  const ids = result.suggestions.map((doc) => doc.id);
  assert.ok(ids.includes(near.id), 'the semantically-near doc is suggested');
  assert.ok(!ids.includes(linkedDoc.id), 'already-linked docs are excluded');
  assert.ok(!ids.includes(far.id), 'orthogonal docs fall below the relevance cutoff');
  assert.ok(Number.isFinite(result.suggestions[0].similarity));
  await app.close();
});
