import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';
import { canonicalInstant } from '../../server/memoryChangesRoutes.js';
import { classifyChange } from '../../server/memoryChangesRepository.js';

// The since-last-session delta over a real in-memory SQLite database: real
// migrations (0041 included), real repositories and triggers, real routes.
// Timestamps are pinned with SQL so every window is deterministic.

const AGENT = { 'x-prax-origin': 'agent', 'x-prax-agent': 'claude' };
const T0 = '2026-01-01T00:00:00.000Z';

async function freshApp({ clock = () => new Date('2026-09-23T12:00:00.000Z') } = {}) {
  const config = loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' });
  const app = await buildApp({ config, changesClock: clock });
  const create = async (title, { project = 'homelab', agent = false } = {}) => {
    const res = await app.inject({
      method: 'POST', url: '/api/library/documents',
      payload: { title, body: `${title} body`, documentType: 'note', project },
      headers: agent ? AGENT : {},
    });
    assert.equal(res.statusCode, 201, res.body);
    return res.json();
  };
  // Pin every stamp of a document (null leaves the column as it is).
  const stamp = async (id, { created = T0, updated = T0, verified = null } = {}) => {
    await app.db.query(
      'update markdown_documents set created_at = $2, updated_at = $3, verified_at = coalesce($4, verified_at) where id = $1',
      [id, created, updated, verified],
    );
  };
  const changes = (query, headers = {}) => app.inject({ method: 'GET', url: `/api/library/changes?${query}`, headers });
  return { app, create, stamp, changes };
}

test('canonicalInstant accepts ISO dates and date-times only', () => {
  assert.equal(canonicalInstant('2026-09-23'), '2026-09-23T00:00:00.000Z');
  assert.equal(canonicalInstant('2026-09-23T10:00:00+02:00'), '2026-09-23T08:00:00.000Z');
  assert.equal(canonicalInstant('yesterday'), null);
  assert.equal(canonicalInstant('1695000000'), null);
  assert.equal(canonicalInstant(undefined), null);
});

test('classifyChange: created is not also updated; a retired row reports its state', () => {
  const since = '2026-05-01T00:00:00.000Z';
  const later = '2026-06-01T00:00:00.000Z';
  const early = '2026-01-01T00:00:00.000Z';
  assert.deepEqual(classifyChange({ c_at: later, u_at: later, status: 'active' }, since), ['created']);
  assert.deepEqual(classifyChange({ c_at: early, u_at: later, status: 'active' }, since), ['updated']);
  assert.deepEqual(classifyChange({ c_at: early, u_at: later, status: 'superseded' }, since), ['superseded']);
  assert.deepEqual(classifyChange({ c_at: early, u_at: early, v_at: later, status: 'active' }, since), ['verified']);
  assert.deepEqual(classifyChange({ c_at: early, u_at: later, a_at: later, status: 'active' }, since), ['archived']);
  assert.deepEqual(classifyChange({ c_at: later, u_at: later, v_at: later, status: 'active' }, since), ['created', 'verified']);
});

test('changes since an instant: created, updated, verified, superseded and archived, oldest first', async () => {
  const { app, create, stamp, changes } = await freshApp();
  const quiet = await create('Quiet note');
  const fresh = await create('Fresh note', { agent: true });
  const edited = await create('Edited note');
  const blessed = await create('Blessed note', { agent: true });
  const old = await create('Old pooler', { agent: true });
  const replacement = await create('New pooler', { agent: true });
  const gone = await create('Archived note');
  for (const doc of [quiet, edited, blessed, old, replacement, gone]) await stamp(doc.id);
  await stamp(fresh.id, { created: '2026-03-01T00:00:00.000Z', updated: '2026-03-01T00:00:00.000Z' });
  await stamp(edited.id, { updated: '2026-03-02T00:00:00.000Z' });
  await app.db.query("update markdown_documents set verified = 1, verified_by = 'mark', verified_at = '2026-03-03T00:00:00.000Z' where id = $1", [blessed.id]);
  // The supersession trigger bumps the old row's updated_at to now.
  const sup = await app.inject({ method: 'POST', url: `/api/library/documents/${old.id}/supersede`, payload: { supersededBy: replacement.id } });
  assert.equal(sup.statusCode, 200);
  await app.db.query("update markdown_documents set updated_at = '2026-03-04T00:00:00.000Z' where id = $1", [old.id]);
  await app.db.query("update markdown_documents set archived_at = '2026-03-05T00:00:00.000Z', updated_at = '2026-03-05T00:00:00.000Z' where id = $1", [gone.id]);

  const res = await changes('since=2026-02-01');
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.equal(body.baseline, 'explicit');
  assert.equal(body.since, '2026-02-01T00:00:00.000Z');
  const byTitle = Object.fromEntries(body.items.map((item) => [item.title, item]));
  assert.deepEqual(body.items.map((item) => item.title), ['Fresh note', 'Edited note', 'Blessed note', 'Old pooler', 'Archived note']);
  assert.deepEqual(byTitle['Fresh note'].changes, ['created']);
  assert.deepEqual(byTitle['Edited note'].changes, ['updated']);
  assert.deepEqual(byTitle['Blessed note'].changes, ['verified']);
  assert.deepEqual(byTitle['Old pooler'].changes, ['superseded']);
  assert.deepEqual(byTitle['Old pooler'].supersededBy, [replacement.id]);
  assert.equal(byTitle['Old pooler'].status, 'superseded');
  assert.deepEqual(byTitle['Archived note'].changes, ['archived']);
  assert.equal(byTitle['Fresh note'].updatedByAgent, 'claude');
  assert.equal(byTitle['Fresh note'].projectSlug, 'homelab');
  assert.equal(body.until, '2026-03-05T00:00:00.000Z', 'until is the last change, never the clock');
  assert.deepEqual(body.page, { returned: 5, total: 5, hasMore: false, limit: 50 });
  assert.ok(!byTitle['Quiet note'], 'an unchanged document is not in the delta');

  // Nothing after the last change: an empty window keeps `until` at `since`.
  const none = (await changes('since=2026-03-05T00:00:00.000Z')).json();
  assert.deepEqual(none.items, []);
  assert.equal(none.until, '2026-03-05T00:00:00.000Z');
});

test('a page never splits a tie at its boundary and reports what remains', async () => {
  const { create, stamp, changes } = await freshApp();
  const docs = [];
  for (const title of ['A', 'B', 'C', 'D']) docs.push(await create(title));
  await stamp(docs[0].id, { created: '2026-03-01T00:00:00.000Z', updated: '2026-03-01T00:00:00.000Z' });
  for (const doc of docs.slice(1, 3)) await stamp(doc.id, { created: '2026-03-02T00:00:00.000Z', updated: '2026-03-02T00:00:00.000Z' });
  await stamp(docs[3].id, { created: '2026-03-03T00:00:00.000Z', updated: '2026-03-03T00:00:00.000Z' });

  const first = (await changes('since=2026-02-01&limit=2')).json();
  assert.deepEqual(first.items.map((i) => i.title).sort(), ['A', 'B', 'C'], 'the B/C tie is kept whole');
  assert.equal(first.until, '2026-03-02T00:00:00.000Z');
  assert.equal(first.page.hasMore, true);
  assert.equal(first.page.total, 4);
  const next = (await changes(`since=${first.until}&limit=2`)).json();
  assert.deepEqual(next.items.map((i) => i.title), ['D']);
  assert.equal(next.page.hasMore, false);
});

test('changes can be scoped to one project; bad input is refused', async () => {
  const { create, stamp, changes } = await freshApp();
  const here = await create('Homelab note');
  const there = await create('Work note', { project: 'work' });
  await stamp(here.id, { created: '2026-03-01T00:00:00.000Z', updated: '2026-03-01T00:00:00.000Z' });
  await stamp(there.id, { created: '2026-03-01T00:00:00.000Z', updated: '2026-03-01T00:00:00.000Z' });
  const scoped = (await changes('since=2026-02-01&project=work')).json();
  assert.deepEqual(scoped.items.map((i) => i.title), ['Work note']);
  assert.equal(scoped.project.slug, 'work');
  assert.equal((await changes('since=2026-02-01&project=nope')).statusCode, 400);
  assert.equal((await changes('since=last-tuesday')).statusCode, 400);
  assert.equal((await changes('since=2026-02-01&limit=0')).statusCode, 400);
  assert.equal((await changes('')).statusCode, 400, 'one of since or sinceLastSession is required');
  assert.equal((await changes('since=2026-02-01&sinceLastSession=true', AGENT)).statusCode, 400, 'not both');
});

test('since-last-session: needs an agent, starts with no baseline, then reads from the marker', async () => {
  const { app, create, stamp, changes } = await freshApp();
  const noAgent = await changes('sinceLastSession=true');
  assert.equal(noAgent.statusCode, 400);
  assert.match(noAgent.json().message, /agent id is required/);
  // x-prax-agent alone, without the agent origin, is not an agent.
  assert.equal((await changes('sinceLastSession=true', { 'x-prax-agent': 'claude' })).statusCode, 400);

  const first = (await changes('sinceLastSession=true', AGENT)).json();
  assert.equal(first.baseline, 'none');
  assert.equal(first.agent, 'claude');
  assert.equal(first.since, null);
  assert.deepEqual(first.items, []);
  assert.equal(first.until, '2026-09-23T12:00:00.000Z', 'the baseline is the server clock');

  const put = await app.inject({ method: 'PUT', url: '/api/library/recall-marker', payload: { at: '2026-03-01T00:00:00.000Z' }, headers: AGENT });
  assert.equal(put.statusCode, 200, put.body);
  assert.equal(put.json().lastRecallAt, '2026-03-01T00:00:00.000Z');

  const doc = await create('After the marker');
  await stamp(doc.id, { created: '2026-03-02T00:00:00.000Z', updated: '2026-03-02T00:00:00.000Z' });
  const delta = (await changes('sinceLastSession=true', AGENT)).json();
  assert.equal(delta.baseline, 'marker');
  assert.equal(delta.since, '2026-03-01T00:00:00.000Z');
  assert.deepEqual(delta.items.map((i) => i.title), ['After the marker']);

  // Another agent has its own marker.
  const codex = (await changes('sinceLastSession=true', { 'x-prax-origin': 'agent', 'x-prax-agent': 'codex' })).json();
  assert.equal(codex.baseline, 'none');
});

test('the recall marker is monotonic, clamped to the clock and scoped by project', async () => {
  const { app } = await freshApp();
  const put = (payload, headers = AGENT) => app.inject({ method: 'PUT', url: '/api/library/recall-marker', payload, headers });
  const get = (query = '') => app.inject({ method: 'GET', url: `/api/library/recall-marker${query}`, headers: AGENT });

  assert.equal((await get()).json().lastRecallAt, null);
  assert.equal((await put({ at: '2026-05-01T00:00:00.000Z' })).json().lastRecallAt, '2026-05-01T00:00:00.000Z');
  // A retry or a stale session never moves it backwards.
  assert.equal((await put({ at: '2026-04-01T00:00:00.000Z' })).json().lastRecallAt, '2026-05-01T00:00:00.000Z');
  assert.equal((await put({ at: '2026-05-01T00:00:00.000Z' })).json().lastRecallAt, '2026-05-01T00:00:00.000Z');
  // Never later than the server's clock.
  assert.equal((await put({ at: '2030-01-01T00:00:00.000Z' })).json().lastRecallAt, '2026-09-23T12:00:00.000Z');

  // A project-scoped marker is separate from the all-projects feed.
  assert.equal((await get('?project=homelab')).json().lastRecallAt, null);
  await put({ at: '2026-02-01T00:00:00.000Z', project: 'homelab' });
  assert.equal((await get('?project=homelab')).json().lastRecallAt, '2026-02-01T00:00:00.000Z');
  assert.equal((await get()).json().lastRecallAt, '2026-09-23T12:00:00.000Z');

  assert.equal((await put({ at: 'soon' })).statusCode, 400);
  assert.equal((await put({ at: '2026-02-01T00:00:00.000Z', project: 'nope' })).statusCode, 400);
  assert.equal((await put({ at: '2026-02-01T00:00:00.000Z' }, {})).statusCode, 400, 'an agent is required');
  const rows = (await app.db.query('select agent, scope from agent_recall_markers order by scope')).rows;
  assert.equal(rows.length, 2);
  assert.ok(rows.some((r) => r.scope === '*'));
});
