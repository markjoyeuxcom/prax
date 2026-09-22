import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';
import { createClient } from '../../cli/lib/apiClient.js';
import { remember } from '../../cli/lib/remember.js';
import { recall } from '../../cli/lib/recall.js';
import { createPraxClient } from '../../mcp/praxClient.js';

const agent = { 'x-prax-origin': 'agent', 'x-prax-agent': 'codex' };
async function boot(t, options = {}) {
  const app = await buildApp({ config: loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' }), ...options });
  t.after(() => app.close());
  return app;
}
async function ok(app, method, url, payload, headers) {
  const res = await app.inject({ method, url, payload, headers });
  assert.ok(res.statusCode < 400, `${method} ${url}: ${res.statusCode} ${res.body}`);
  return res.json();
}
async function document(app, title = 'Review fixture') {
  return ok(app, 'POST', '/api/library/documents', { title, body: 'baseline', documentType: 'note', project: 'homelab' }, agent);
}
function transport(app, afterResponse = () => {}) {
  return async (url, options = {}) => {
    const u = new URL(url);
    const res = await app.inject({ method: options.method || 'GET', url: u.pathname + u.search, headers: options.headers, payload: options.body });
    await afterResponse(u, options, res);
    return new Response(res.body, { status: res.statusCode, headers: res.headers });
  };
}

for (const kind of ['CLI by ID', 'CLI cross-project', 'MCP']) {
  test(`R01: ${kind} lost-response retry preserves an intervening newer write`, async t => {
    const app = await boot(t);
    const doc = await document(app);
    const attempts = [];
    const fetch = transport(app, async (url, options, res) => {
      if (url.pathname.endsWith(`/${doc.id}/update`)) {
        assert.equal(res.statusCode, 200, res.body);
        attempts.push(JSON.parse(options.body));
        if (attempts.length === 1) {
          await ok(app, 'PATCH', `/api/library/documents/${doc.id}`, { body: 'newer accepted human edit' });
          throw new TypeError('response lost after commit');
        }
      }
    });
    let result;
    if (kind === 'MCP') {
      result = await createPraxClient({ baseUrl: 'http://fixture.invalid', fetch }).updateDocument(doc.id, { body: 'older agent write' });
    } else {
      t.mock.method(globalThis, 'fetch', fetch);
      result = (await remember(createClient({ baseUrl: 'http://fixture.invalid' }), {
        title: doc.title, body: 'older agent write', project: 'memory', crossProject: true,
        ...(kind === 'CLI by ID' ? { id: doc.id } : {}),
      })).doc;
    }
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[1], attempts[0], 'the retry retains exactly the same operation and intent');
    assert.equal(result.body, 'newer accepted human edit');
    assert.equal(result.replayed, true);
    assert.equal((await ok(app, 'GET', `/api/library/documents/${doc.id}`)).updatedBy, 'user');
  });
}

test('R01: receipt guards metadata-only updates, concurrent replay, changed intent and deleted results', async t => {
  const app = await boot(t);
  const doc = await document(app);
  const path = `/api/library/documents/${doc.id}/update`;
  const payload = { operationId: randomUUID(), tags: ['original operation'], ifRevision: doc.revision };
  const responses = await Promise.all([1, 2, 3].map(() => ok(app, 'POST', path, payload, agent)));
  assert.equal(responses.filter(r => r.replayed).length, 2);
  await ok(app, 'PATCH', `/api/library/documents/${doc.id}`, { tags: ['newer metadata'] });
  const replay = await ok(app, 'POST', path, payload, agent);
  assert.deepEqual(replay.tags, ['newer metadata']);
  const otherClient = await ok(app, 'POST', path, { ...payload, ifRevision: '0'.repeat(64) }, { 'x-prax-origin': 'agent', 'x-prax-agent': 'claude' });
  assert.deepEqual(otherClient.tags, ['newer metadata']);
  assert.equal(otherClient.updatedBy, 'user', 'reconciliation never restamps the newer writer');
  const conflict = await app.inject({ method: 'POST', url: path, payload: { ...payload, tags: ['different intent'] }, headers: agent });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().reason, 'update-intent-mismatch');
  await ok(app, 'DELETE', `/api/library/documents/${doc.id}/permanent`);
  const gone = await app.inject({ method: 'POST', url: path, payload, headers: agent });
  assert.equal(gone.statusCode, 409);
  assert.equal(gone.json().reason, 'update-result-gone');
  assert.equal(gone.json().committed, true);
});

test('R01 audit: an uncertain MCP task PATCH is not replayed over a newer accepted edit', async t => {
  const app = await boot(t);
  const task = await ok(app, 'POST', '/api/tasks', { title: 'Initial', project: 'homelab', priority: 'medium', status: 'planned' });
  let attempts = 0;
  const fetch = transport(app, async (url, options, response) => {
    if (options.method !== 'PATCH') return;
    attempts++;
    assert.equal(response.statusCode, 200);
    await ok(app, 'PATCH', url.pathname, { title: 'Newer human edit' });
    throw new TypeError('lost response');
  });
  await assert.rejects(() => createPraxClient({ baseUrl: 'http://127.0.0.1:3000', fetch }).updateTask(task.id, { title: 'Older operation' }), /outcome unknown/i);
  assert.equal(attempts, 1);
  assert.equal((await ok(app, 'GET', `/api/tasks/${task.id}`)).title, 'Newer human edit');
});

test('R01 audit: a lost CLI verification response never reverses a newer unverification', async t => {
  const app = await boot(t);
  const doc = await document(app);
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', transport(app, async (url, _options, response) => {
    attempts++;
    assert.equal(response.statusCode, 200);
    await ok(app, 'POST', url.pathname, { verified: false });
    throw new TypeError('lost response');
  }));
  const client = createClient({ baseUrl: 'http://fixture.invalid' });
  await assert.rejects(() => client.verify(doc.id, { verified: true, revision: doc.revision }), /outcome unknown/i);
  assert.equal(attempts, 1);
  assert.equal((await ok(app, 'GET', `/api/library/documents/${doc.id}`)).verified, false);
});

test('R01: a rejected revision consumes no receipt and never overwrites current content', async t => {
  const app = await boot(t);
  const doc = await document(app);
  const newer = await ok(app, 'PATCH', `/api/library/documents/${doc.id}`, { title: 'Newer title' });
  const payload = { operationId: randomUUID(), body: 'my next edit', ifRevision: doc.revision };
  const path = `/api/library/documents/${doc.id}/update`;
  const conflict = await app.inject({ method: 'POST', url: path, payload });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().reason, 'revision-mismatch');
  assert.equal(conflict.json().document.body, 'baseline');
  const accepted = await ok(app, 'POST', path, { ...payload, ifRevision: newer.revision });
  assert.equal(accepted.title, 'Newer title');
  assert.equal(accepted.body, 'my next edit');
  assert.equal((await app.inject({ method: 'POST', url: path, payload: { body: 'invalid ID', operationId: 'bad' } })).statusCode, 400);
});

test('R01: update receipts survive server restart', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'prax-update-receipt-'));
  const config = loadConfig({ PRAX_DB_FILE: join(folder, 'fixture.db'), EMBEDDING_BACKEND: 'none' });
  let app;
  try {
    app = await buildApp({ config });
    const doc = await document(app);
    const path = `/api/library/documents/${doc.id}/update`;
    const payload = { body: 'first operation', operationId: randomUUID(), ifRevision: doc.revision };
    await ok(app, 'POST', path, payload);
    await ok(app, 'PATCH', `/api/library/documents/${doc.id}`, { body: 'newer accepted write' });
    await app.close();
    app = await buildApp({ config });
    const replay = await ok(app, 'POST', path, payload);
    assert.equal(replay.replayed, true);
    assert.equal(replay.body, 'newer accepted write');
  } finally {
    await app?.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('R01: failure to record a receipt rolls the update back too', async t => {
  const app = await boot(t);
  const doc = await document(app);
  app.db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON document_update_receipts BEGIN SELECT RAISE(ABORT, 'fixture storage failure'); END;");
  const payload = { operationId: randomUUID(), body: 'must roll back', ifRevision: doc.revision };
  const path = `/api/library/documents/${doc.id}/update`;
  const failed = await app.inject({ method: 'POST', url: path, payload });
  assert.equal(failed.statusCode, 500);
  assert.equal((await ok(app, 'GET', `/api/library/documents/${doc.id}`)).body, 'baseline');
  app.db.exec('DROP TRIGGER fail_receipt');
  assert.equal((await ok(app, 'POST', path, payload)).body, 'must roll back');
});

for (const kind of ['CLI', 'MCP']) {
  test(`R01: ${kind} never retries a legacy PATCH after losing its response`, async t => {
    let patches = 0;
    const fetch = async (_url, options) => {
      if (options.method === 'POST') return new Response(JSON.stringify({ message: 'route not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
      patches++;
      throw new TypeError('connection closed after accepting update');
    };
    let update;
    if (kind === 'CLI') {
      t.mock.method(globalThis, 'fetch', fetch);
      update = () => createClient({ baseUrl: 'http://fixture.invalid' }).updateMemory('doc', { body: 'x' });
    } else update = () => createPraxClient({ baseUrl: 'http://127.0.0.1:3000', fetch }).updateDocument('doc', { body: 'x' });
    await assert.rejects(update, /outcome unknown.*not re-sent/i);
    assert.equal(patches, 1);
  });
}

test('R03: production listing supports cross-project deduplication, type/tag preservation and ambiguity', async t => {
  const app = await boot(t);
  const doc = await document(app, 'Cross-project procedure');
  await ok(app, 'PATCH', `/api/library/documents/${doc.id}`, { documentType: 'runbook', tags: ['human tag'] });
  t.mock.method(globalThis, 'fetch', transport(app));
  const client = createClient({ baseUrl: 'http://fixture.invalid' });
  const listed = await client.listDocuments(undefined, { status: 'active' });
  assert.equal(listed.find(d => d.id === doc.id).projectSlug, 'homelab');
  const result = await remember(client, { title: doc.title, body: 'refined', project: 'memory', crossProject: true, tags: ['agent tag'] });
  assert.equal(result.action, 'updated');
  assert.equal(result.project, 'homelab');
  assert.equal(result.doc.id, doc.id);
  assert.equal(result.doc.documentType, 'runbook');
  assert.deepEqual(result.doc.tags, ['human tag', 'agent tag']);
  assert.equal((await client.listDocuments('memory')).some(d => d.title === doc.title), false);
  const other = await ok(app, 'POST', '/api/projects', { name: 'Second owner' });
  await ok(app, 'POST', '/api/library/documents', { title: doc.title, body: 'other', documentType: 'note', project: other.id });
  await assert.rejects(() => remember(client, { title: doc.title, body: 'ambiguous', project: 'memory', crossProject: true }), /more than one project/);
});

test('R04: dedicated and generic supersession reject short and long cycles while preserving replay', async t => {
  const app = await boot(t);
  const [a, b, c] = await Promise.all(['A', 'B', 'C'].map(title => document(app, title)));
  await ok(app, 'POST', `/api/library/documents/${a.id}/supersede`, { supersededBy: b.id });
  const short = await app.inject({ method: 'POST', url: `/api/library/documents/${b.id}/supersede`, payload: { supersededBy: a.id } });
  assert.equal(short.statusCode, 409);
  assert.equal(short.json().reason, 'supersession-cycle');
  await ok(app, 'POST', `/api/library/documents/${b.id}/supersede`, { supersededBy: c.id });
  const long = await app.inject({ method: 'POST', url: `/api/library/documents/${a.id}/links`, payload: { targetId: c.id, relation: 'supersedes' } });
  assert.equal(long.statusCode, 409);
  assert.equal(long.json().reason, 'supersession-cycle');
  await ok(app, 'POST', `/api/library/documents/${a.id}/supersede`, { supersededBy: b.id });
  assert.equal((await ok(app, 'GET', `/api/library/documents/${c.id}`)).status, 'active');
  await ok(app, 'POST', `/api/library/documents/${a.id}/links`, { targetId: c.id, relation: 'derived-from' });
});

test('R04: competing supersession directions cannot both commit', async t => {
  const app = await boot(t);
  const [a, b] = await Promise.all(['A', 'B'].map(title => document(app, title)));
  const results = await Promise.all([[a, b], [b, a]].map(([old, next]) => app.inject({
    method: 'POST', url: `/api/library/documents/${old.id}/supersede`, payload: { supersededBy: next.id },
  })));
  assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
  const current = await Promise.all([a, b].map(d => ok(app, 'GET', `/api/library/documents/${d.id}`)));
  assert.equal(current.filter(d => d.status === 'active').length, 1);
});

test('R08: deleting a project automatically reconciles its Google Calendar events', async t => {
  const events = new Map();
  const client = { ensurePraxCalendar: async () => 'calendar', listEventIds: async () => [...events.keys()],
    upsertEvent: async (_id, event) => events.set(event.id, event), deleteEvent: async (_id, eventId) => events.delete(eventId) };
  const provider = { client: async () => client, getSettings: async () => ({ calendarId: 'calendar' }), putSettings: async () => {} };
  const app = await boot(t, { googleCalendarProvider: provider });
  const project = await ok(app, 'POST', '/api/projects', { name: 'Calendar fixture' });
  await ok(app, 'POST', '/api/tasks', { title: 'Scheduled', priority: 'medium', status: 'planned', dueDate: '2026-10-01', project: project.id });
  await app.calendarPusher.flush();
  assert.equal(events.size, 1);
  await ok(app, 'DELETE', `/api/projects/${project.id}/permanent`);
  await app.calendarPusher.flush();
  assert.equal(events.size, 0);
});

test('R10: normal recall continues to include explicitly unverified memory', async t => {
  const app = await boot(t);
  const doc = await document(app, 'Unverified recall fixture');
  t.mock.method(globalThis, 'fetch', transport(app));
  const result = await recall(createClient({ baseUrl: 'http://fixture.invalid' }), { query: doc.title });
  assert.equal(result.kind, 'hit');
  assert.equal(result.top.id, doc.id);
  assert.equal(result.top.verified, false);
});
