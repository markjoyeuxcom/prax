// Authorship follows content (Library review, 2026-10-13): a metadata-only
// patch (tags, project, type) never changes who wrote a document, so tag
// housekeeping cannot evict an agent's unreviewed note from the review queue
// or make a person's document read as agent-written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';
import { isReviewQueueDoc } from '../../public/js/libraryFilters.js';

const AGENT = { 'x-prax-origin': 'agent', 'x-prax-agent': 'codex' };

async function app() {
  return buildApp({ config: loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none', CHAT_BACKEND: 'none' }), librarianSweep: false });
}

test('a human retag of an agent-written document keeps the agent as its author and keeps it in the review queue', async () => {
  const server = await app();
  const created = (await server.inject({ method: 'POST', url: '/api/library/documents', headers: AGENT, payload: { project: 'homelab', title: 'Kubernetes upgrade 03', body: 'Drain, upgrade, uncordon.', documentType: 'runbook', tags: ['kubernetes'] } })).json();
  assert.equal(created.updatedBy, 'agent');
  assert.equal(isReviewQueueDoc(created), true);
  const retagged = (await server.inject({ method: 'PATCH', url: `/api/library/documents/${created.id}`, payload: { tags: ['k8s'] } })).json();
  assert.deepEqual(retagged.tags, ['k8s']);
  assert.equal(retagged.updatedBy, 'agent', 'tags are not content');
  assert.equal(retagged.updatedByAgent, 'codex');
  assert.equal(retagged.verified, false);
  assert.equal(isReviewQueueDoc(retagged), true, 'still waiting for a person');
  // A human edit of the BODY is content: authorship moves.
  const edited = (await server.inject({ method: 'PATCH', url: `/api/library/documents/${created.id}`, payload: { body: 'Drain, upgrade, uncordon, verify.' } })).json();
  assert.equal(edited.updatedBy, 'user');
  assert.equal(edited.updatedByAgent, null);
  await server.close();
});

test('an agent retag of a verified human document keeps the person as author and keeps the verification', async () => {
  const server = await app();
  const doc = (await server.inject({ method: 'POST', url: '/api/library/documents', payload: { project: 'homelab', title: 'Backups', body: 'Nightly to B2.', documentType: 'runbook', tags: ['backup'] } })).json();
  await server.inject({ method: 'POST', url: `/api/library/documents/${doc.id}/verify`, payload: { verified: true, as: 'Mark', revision: doc.revision } });
  const retagged = (await server.inject({ method: 'PATCH', url: `/api/library/documents/${doc.id}`, headers: AGENT, payload: { tags: ['backups', 'b2'] } })).json();
  assert.equal(retagged.updatedBy, 'user');
  assert.equal(retagged.updatedByAgent, null);
  assert.equal(retagged.verified, true, 'a retag changes nothing the person blessed');
  assert.equal(isReviewQueueDoc(retagged), false);
  await server.close();
});
