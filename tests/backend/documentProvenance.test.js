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

test('archive and restore by a person keep an agent note the agent\'s, and in the review queue', async () => {
  const server = await app();
  const created = (await server.inject({ method: 'POST', url: '/api/library/documents', headers: AGENT, payload: { project: 'homelab', title: 'Agent note', body: 'Something an agent learned.', documentType: 'note' } })).json();
  assert.equal((await server.inject({ method: 'DELETE', url: `/api/library/documents/${created.id}` })).statusCode, 200);
  const restored = (await server.inject({ method: 'PATCH', url: `/api/library/documents/${created.id}/restore` })).json();
  assert.equal(restored.updatedBy, 'agent');
  assert.equal(restored.updatedByAgent, 'codex');
  assert.equal(restored.verified, false);
  assert.equal(isReviewQueueDoc(restored), true, 'a lifecycle round trip is not a review');
  assert.equal(restored.archivedBy, null, 'restore clears the archive attribution');
  const archived = (await server.inject({ method: 'DELETE', url: `/api/library/documents/${created.id}`, headers: AGENT })).json();
  assert.equal(archived.archivedBy, 'agent');
  assert.equal(archived.archivedByAgent, 'codex');
  assert.equal(archived.updatedBy, 'agent');
  await server.close();
});

test('a human patch that repeats the stored title and body (the editor\'s full form) does not take authorship', async () => {
  const server = await app();
  const created = (await server.inject({ method: 'POST', url: '/api/library/documents', headers: AGENT, payload: { project: 'homelab', title: 'Agent runbook', body: 'Step one.', documentType: 'runbook', tags: ['a'] } })).json();
  const same = (await server.inject({ method: 'PATCH', url: `/api/library/documents/${created.id}`, payload: { title: 'Agent runbook', body: 'Step one.', tags: ['a', 'b'] } })).json();
  assert.deepEqual(same.tags, ['a', 'b']);
  assert.equal(same.updatedBy, 'agent', 'nothing the agent wrote changed');
  assert.equal(isReviewQueueDoc(same), true);
  const changed = (await server.inject({ method: 'PATCH', url: `/api/library/documents/${created.id}`, payload: { title: 'Agent runbook', body: 'Step one. Step two.' } })).json();
  assert.equal(changed.updatedBy, 'user');
  await server.close();
});

test('a human supersede, then unlinking it, keeps the agent as author and returns the document to the review queue', async () => {
  const server = await app();
  const old = (await server.inject({ method: 'POST', url: '/api/library/documents', headers: AGENT, payload: { project: 'homelab', title: 'Talos upgrade 1.7', body: 'Upgrade steps for 1.7.', documentType: 'runbook' } })).json();
  const replacement = (await server.inject({ method: 'POST', url: '/api/library/documents', payload: { project: 'homelab', title: 'Talos upgrade 1.8', body: 'Upgrade steps for 1.8.', documentType: 'runbook' } })).json();
  const superseded = (await server.inject({ method: 'POST', url: `/api/library/documents/${old.id}/supersede`, payload: { supersededBy: replacement.id } })).json();
  assert.equal(superseded.status, 'superseded');
  assert.equal(superseded.retiredBy, 'user', 'who retired it is recorded on its own field');
  assert.equal(superseded.updatedBy, 'agent', 'a supersession is not an edit');
  assert.equal(superseded.updatedByAgent, 'codex');
  assert.equal(superseded.revision, old.revision);
  const unlink = await server.inject({ method: 'DELETE', url: `/api/library/documents/${replacement.id}/links/${old.id}?relation=supersedes` });
  assert.ok([200, 204].includes(unlink.statusCode), unlink.body);
  const revived = (await server.inject({ method: 'GET', url: `/api/library/documents/${old.id}` })).json();
  assert.equal(revived.status, 'active');
  assert.equal(revived.retiredBy, null);
  assert.equal(revived.updatedBy, 'agent');
  assert.equal(revived.updatedByAgent, 'codex');
  assert.equal(revived.verified, false);
  assert.equal(isReviewQueueDoc(revived), true, 'still owes its review');
  await server.close();
});

test('restoring a superseder re-retires its target with the original retirement actor, and content authorship still stays', async () => {
  const server = await app();
  const old = (await server.inject({ method: 'POST', url: '/api/library/documents', headers: AGENT, payload: { project: 'homelab', title: 'Ceph upgrade 18', body: 'Upgrade steps for 18.', documentType: 'runbook' } })).json();
  const next = (await server.inject({ method: 'POST', url: '/api/library/documents', payload: { project: 'homelab', title: 'Ceph upgrade 19', body: 'Upgrade steps for 19.', documentType: 'runbook' } })).json();
  await server.inject({ method: 'POST', url: `/api/library/documents/${old.id}/supersede`, headers: { 'x-prax-origin': 'agent', 'x-prax-agent': 'claude' }, payload: { supersededBy: next.id } });
  const read = async () => (await server.inject({ method: 'GET', url: `/api/library/documents/${old.id}` })).json();
  assert.deepEqual([(await read()).status, (await read()).retiredBy, (await read()).retiredByAgent], ['superseded', 'agent', 'claude']);
  // Archiving the last live superseder revives the target: nobody retires it now.
  assert.ok([200, 204].includes((await server.inject({ method: 'DELETE', url: `/api/library/documents/${next.id}` })).statusCode), 'archived');
  let doc = await read();
  assert.deepEqual([doc.status, doc.retiredBy, doc.retiredByAgent], ['active', null, null]);
  // Restoring it re-retires the target, attributed to whoever made the edge.
  assert.equal((await server.inject({ method: 'PATCH', url: `/api/library/documents/${next.id}/restore` })).statusCode, 200, 'restored');
  doc = await read();
  assert.deepEqual([doc.status, doc.retiredBy, doc.retiredByAgent], ['superseded', 'agent', 'claude']);
  // The target restored under a live edge (the 0018 path) is attributed the same way.
  assert.ok([200, 204].includes((await server.inject({ method: 'DELETE', url: `/api/library/documents/${old.id}` })).statusCode), 'archived');
  assert.equal((await server.inject({ method: 'PATCH', url: `/api/library/documents/${old.id}/restore` })).statusCode, 200, 'restored');
  doc = await read();
  assert.deepEqual([doc.status, doc.retiredBy, doc.retiredByAgent], ['superseded', 'agent', 'claude']);
  assert.deepEqual([doc.updatedBy, doc.updatedByAgent, doc.revision], ['agent', 'codex', old.revision], 'content authorship never moved');
  await server.close();
});
