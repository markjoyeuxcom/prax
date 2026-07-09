import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../../server/db.js';
import { runMigrations } from '../../server/migrate.js';
import { buildApp } from '../../server/index.js';

const SILENT = { info() {}, error() {} };

async function seededApp() {
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT });
  const app = await buildApp({ db });
  const mk = (title, body) => app.inject({ method: 'POST', url: '/api/library/documents', payload: { title, body, documentType: 'note', project: 'personal' } });
  await mk('Postgres Failover', 'How to fail over.');
  const inc = (await mk('Incident Playbook', 'On a DB outage, follow the Postgres Failover runbook.')).json();
  return { app, inc };
}

test('GET link-suggestions surfaces an unlinked title mention', async () => {
  const { app } = await seededApp();
  const res = await app.inject({ method: 'GET', url: '/api/library/health/link-suggestions' });
  assert.equal(res.statusCode, 200);
  const list = res.json();
  const one = list.find((s) => s.sourceTitle === 'Incident Playbook' && s.targetTitle === 'Postgres Failover');
  assert.ok(one, `expected a suggestion, got ${JSON.stringify(list)}`);
  assert.equal(one.snippet.hit, 'Postgres Failover');
  await app.close();
});

test('POST wiki-link accepts a suggestion (body updated, verified untouched), then 409s', async () => {
  const { app, inc } = await seededApp();
  const first = await app.inject({ method: 'POST', url: `/api/library/documents/${inc.id}/wiki-link`, payload: { title: 'Postgres Failover' } });
  assert.equal(first.statusCode, 200);
  assert.match(first.json().body, /\[\[Postgres Failover\]\]/);
  assert.equal(first.json().updatedBy, 'user'); // human curation, not agent
  assert.equal(first.json().verified, true);     // unchanged by the edit

  // the mention is now linked — accepting again has nothing to do
  const again = await app.inject({ method: 'POST', url: `/api/library/documents/${inc.id}/wiki-link`, payload: { title: 'Postgres Failover' } });
  assert.equal(again.statusCode, 409);

  // and the suggestion is gone from the list
  const list = (await app.inject({ method: 'GET', url: '/api/library/health/link-suggestions' })).json();
  assert.ok(!list.some((s) => s.sourceId === inc.id && s.targetTitle === 'Postgres Failover'));
  await app.close();
});

test('POST wiki-link validates id + title, 404s a missing doc', async () => {
  const { app, inc } = await seededApp();
  assert.equal((await app.inject({ method: 'POST', url: '/api/library/documents/not-a-uuid/wiki-link', payload: { title: 'X' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: `/api/library/documents/${inc.id}/wiki-link`, payload: {} })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/library/documents/00000000-0000-4000-8000-000000000009/wiki-link', payload: { title: 'X' } })).statusCode, 404);
  await app.close();
});
