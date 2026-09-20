import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';
import { buildTemplateJob } from '../../public/js/templateUse.js';

async function ok(app, method, url, payload) {
  const r = await app.inject({ method, url, payload });
  assert.ok(r.statusCode < 400, r.body); return r.json();
}

test('starters exist on fresh install; restart never seeds or overwrites user copies', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'prax-starters-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const config = loadConfig({ PRAX_DB_FILE: join(dir, 'library.sqlite'), EMBEDDING_BACKEND: 'none' });
  let app = await buildApp({ config }); t.after(() => app.close());
  assert.deepEqual(await ok(app, 'GET', '/api/library/documents'), []);
  const catalogue = await ok(app, 'GET', '/api/library/starters');
  assert.equal(catalogue.version, 1); assert.equal(catalogue.items.length, 4);
  assert.equal(new Set(catalogue.items.map(x => x.id)).size, 4);
  for (const item of catalogue.items) {
    assert.ok(item.body.length > 300);
    assert.doesNotMatch(item.body, /\/Users\/|b000054a|843c1f25|49636|markjoyeux/);
    const staticDoc = await app.inject({ url: `/starter-content/${item.id}.md` });
    assert.equal(staticDoc.statusCode, 200); assert.equal(staticDoc.body, item.body);
  }
  const source = catalogue.items.find(x => x.id === 'project-overview');
  const job = buildTemplateJob({ source, title: 'Local overview', project: 'homelab', documentType: 'template' }, randomUUID());
  const doc = await ok(app, 'POST', '/api/library/documents', job.payload);
  assert.equal(doc.verified, false); assert.equal(doc.documentType, 'template');
  await ok(app, 'PATCH', `/api/library/documents/${doc.id}`, { body: 'My checked architecture, preserved across upgrades' });
  const before = await ok(app, 'GET', `/api/library/documents/${doc.id}`);
  await ok(app, 'POST', `/api/library/documents/${doc.id}/verify`, { verified: true, revision: before.revision });
  const verified = await ok(app, 'GET', `/api/library/documents/${doc.id}`);
  await app.close(); app = await buildApp({ config });
  assert.deepEqual(await ok(app, 'GET', '/api/library/starters'), catalogue);
  assert.deepEqual(await ok(app, 'GET', `/api/library/documents/${doc.id}`), verified);
  assert.equal((await ok(app, 'GET', '/api/library/documents')).length, 1);
});

test('onboarding task and nine checklist items commit once; retries preserve later edits', async t => {
  const app = await buildApp({ config: loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' }) }); t.after(() => app.close());
  const source = (await ok(app, 'GET', '/api/library/starters')).items.find(x => x.target === 'task');
  const job = buildTemplateJob({ source, project: 'homelab', title: 'Onboard repository' }, randomUUID());
  assert.equal(job.payload.tasks[0].checklist.length, 9);
  assert.doesNotMatch(job.payload.tasks[0].notes, /- \[ \]/);
  const result = await ok(app, 'POST', '/api/tasks/import', job.payload);
  assert.equal(result.imported, 1);
  const id = result.tasks[0].id;
  const items = await ok(app, 'GET', `/api/tasks/${id}/checklist`);
  assert.equal(items.length, 9); assert.ok(items.every(x => x.completed === false));
  await ok(app, 'PATCH', `/api/tasks/${id}`, { notes: 'Newer progress' });
  await ok(app, 'PATCH', `/api/tasks/${id}/checklist/${items[0].id}`, { completed: true });
  const retry = await ok(app, 'POST', '/api/tasks/import', job.payload);
  assert.equal(retry.replayed, true); assert.equal(retry.tasks[0].id, id);
  assert.equal((await ok(app, 'GET', `/api/tasks/${id}`)).notes, 'Newer progress');
  assert.equal((await ok(app, 'GET', `/api/tasks/${id}/checklist`))[0].completed, true);
  assert.equal((await ok(app, 'GET', '/api/tasks?project=homelab')).length, 1);
});

test('an explicit unverified create lowers trust without changing human/agent attribution', async t => {
  const app = await buildApp({ config: loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' }) }); t.after(() => app.close());
  const base = { title: 'Trust boundary', body: 'Draft content', project: 'homelab', documentType: 'template' };
  const ordinary = await ok(app, 'POST', '/api/library/documents', base);
  assert.equal(ordinary.verified, true);
  const draft = await ok(app, 'POST', '/api/library/documents', { ...base, verified: false });
  assert.equal(draft.verified, false); assert.equal(draft.updatedBy, 'user');
  const r = await app.inject({ method: 'POST', url: '/api/library/documents', payload: { ...base, verified: true }, headers: { 'x-prax-origin': 'agent', 'x-prax-agent': 'codex' } });
  assert.equal(r.statusCode, 201); assert.equal(r.json().verified, false); assert.equal(r.json().updatedByAgent, 'codex');
  const exported = await app.inject({ url: `/api/library/documents/${draft.id}/export` });
  assert.equal(exported.statusCode, 200); assert.match(exported.body, /\ntype: template\n/);
});

test('template creation receipts preserve edits, reject changed intent and never resurrect a deleted copy', async t => {
  const app = await buildApp({ config: loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' }) }); t.after(() => app.close());
  const source = (await ok(app, 'GET', '/api/library/starters')).items[0];
  const job = buildTemplateJob({ source, project: 'homelab', title: 'Receipt copy', documentType: 'runbook' }, randomUUID());
  const responses = await Promise.all([1, 2, 3].map(() => ok(app, 'POST', '/api/library/documents', job.payload)));
  assert.equal(responses.filter(x => x.replayed).length, 2);
  const id = responses[0].id;
  await ok(app, 'PATCH', `/api/library/documents/${id}`, { body: 'Newer accepted content' });
  const retry = await ok(app, 'POST', '/api/library/documents', job.payload);
  assert.equal(retry.replayed, true); assert.equal(retry.body, 'Newer accepted content');
  const conflict = await app.inject({ method: 'POST', url: '/api/library/documents', payload: { ...job.payload, title: 'Different intent' } });
  assert.equal(conflict.statusCode, 409);
  await ok(app, 'DELETE', `/api/library/documents/${id}/permanent`);
  const gone = await app.inject({ method: 'POST', url: '/api/library/documents', payload: job.payload });
  assert.equal(gone.statusCode, 410);
  assert.equal((await ok(app, 'GET', '/api/library/documents')).length, 0);
});
