import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';

// The engine-swap acceptance net (docs/desktop/checklist.md Phase 2): a real
// Fastify app over a real in-memory SQLite database — real migrations, real
// repositories, real routes — driven through the HTTP API. The fake-db unit
// tests assert SQL text; this file proves the SQL actually runs.

const config = loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' });
const app = await buildApp({ config });

const homelab = async () => {
  const res = await app.inject({ method: 'GET', url: '/api/projects' });
  return res.json().find(p => p.slug === 'homelab');
};

test('readyz reports ready against the embedded database', async () => {
  const res = await app.inject({ method: 'GET', url: '/readyz' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, 'ready');
});

test('projects: seeds exist, create/update/archive/delete work', async () => {
  const list = await app.inject({ method: 'GET', url: '/api/projects' });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.json().map(p => p.slug).sort(), ['homelab', 'inbox', 'memory', 'personal', 'work']);

  const created = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Skunkworks' } });
  assert.equal(created.statusCode, 201);
  const project = created.json();
  assert.match(project.id, /^[0-9a-f-]{36}$/);
  assert.equal(project.slug, 'skunkworks');

  const patched = await app.inject({ method: 'PATCH', url: `/api/projects/${project.id}`, payload: { status: 'on-hold' } });
  assert.equal(patched.statusCode, 200);
  assert.equal(patched.json().status, 'on-hold');

  const deleted = await app.inject({ method: 'DELETE', url: `/api/projects/${project.id}/permanent` });
  assert.equal(deleted.statusCode, 200);
});

let taskA;
let taskB;

test('tasks: create, list filters, update, activity', async () => {
  const proj = await homelab();

  const createA = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { title: 'Swap NAS drive', priority: 'high', status: 'planned', project: 'homelab', dueDate: '2026-07-10' },
  });
  assert.equal(createA.statusCode, 201);
  taskA = createA.json();
  assert.equal(taskA.projectId, proj.id);
  assert.equal(taskA.dueDate, '2026-07-10');

  const createB = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { title: 'Rotate TLS certs', priority: 'medium', status: 'in-progress', project: 'homelab' },
  });
  taskB = createB.json();

  const byProject = await app.inject({ method: 'GET', url: '/api/tasks?project=homelab' });
  assert.equal(byProject.json().length, 2);

  const byStatus = await app.inject({ method: 'GET', url: '/api/tasks?project=homelab&status=in-progress' });
  assert.deepEqual(byStatus.json().map(t => t.title), ['Rotate TLS certs']);

  const byQuery = await app.inject({ method: 'GET', url: '/api/tasks?q=nas' });
  assert.deepEqual(byQuery.json().map(t => t.title), ['Swap NAS drive']);

  const updated = await app.inject({ method: 'PATCH', url: `/api/tasks/${taskA.id}`, payload: { status: 'completed' } });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().status, 'completed');

  const activity = await app.inject({ method: 'GET', url: `/api/tasks/${taskA.id}/activity` });
  const messages = activity.json().map(a => a.message);
  assert.ok(messages.includes('Task created'), `activity: ${messages}`);
  assert.ok(messages.some(m => /Status/.test(m)), `status event missing: ${messages}`);
});

test('tasks: client creation identity is exact-once and conflicting reuse is rejected', async () => {
  const id = '77777777-7777-4777-8777-777777777777';
  const payload = {
    id,
    title: 'Exact-once UI capture',
    priority: 'medium',
    status: 'planned',
    project: 'homelab',
    labels: ['waiting'],
    sortOrder: 19,
  };
  const first = await app.inject({ method: 'POST', url: '/api/tasks', payload });
  const replay = await app.inject({ method: 'POST', url: '/api/tasks', payload });
  const conflict = await app.inject({
    method: 'POST', url: '/api/tasks', payload: { ...payload, title: 'Different task' },
  });
  assert.equal(first.statusCode, 201);
  assert.equal(replay.statusCode, 200);
  assert.equal(conflict.statusCode, 409);

  const tasks = (await app.inject({ method: 'GET', url: '/api/tasks?project=homelab' })).json();
  assert.equal(tasks.filter(task => task.id === id).length, 1);
  const activity = (await app.inject({ method: 'GET', url: `/api/tasks/${id}/activity` })).json();
  assert.equal(activity.filter(event => event.eventType === 'created').length, 1);
});

test('tasks: caller-identified batch import is exact-once and rejects changed intent', async () => {
  const requestId = '88888888-8888-4888-8888-888888888888';
  const title = 'Exact-once imported batch';
  const payload = {
    requestId,
    project: 'personal',
    mode: 'append',
    tasks: [{ title, priority: 'low', status: 'planned', checklist: [{ label: 'Verify once' }] }],
  };
  const [first, replay] = await Promise.all([
    app.inject({ method: 'POST', url: '/api/tasks/import', payload }),
    app.inject({ method: 'POST', url: '/api/tasks/import', payload }),
  ]);
  assert.deepEqual([first.statusCode, replay.statusCode].sort(), [200, 201]);
  const firstResult = first.statusCode === 201 ? first.json() : replay.json();
  const replayResult = first.statusCode === 200 ? first.json() : replay.json();
  assert.equal(firstResult.replayed, false);
  assert.equal(replayResult.replayed, true);
  assert.equal(firstResult.tasks[0].id, replayResult.tasks[0].id);

  const conflict = await app.inject({
    method: 'POST',
    url: '/api/tasks/import',
    payload: { ...payload, tasks: [{ title: 'Changed reuse' }] },
  });
  assert.equal(conflict.statusCode, 409);

  const tasks = (await app.inject({ method: 'GET', url: '/api/tasks?project=personal' })).json();
  const matches = tasks.filter(task => task.title === title);
  assert.equal(matches.length, 1);
  const checklist = (await app.inject({
    method: 'GET', url: `/api/tasks/${matches[0].id}/checklist`,
  })).json();
  assert.deepEqual(checklist.map(item => item.label), ['Verify once']);
});

test('tasks: concurrent distinct skip imports deduplicate inside the write transaction', async () => {
  const title = 'Concurrent skip import';
  const importPayload = requestId => ({
    requestId,
    project: 'work',
    mode: 'skip',
    tasks: [{ title, priority: 'medium', status: 'planned' }],
  });
  const [left, right] = await Promise.all([
    app.inject({
      method: 'POST',
      url: '/api/tasks/import',
      payload: importPayload('91000000-0000-4000-8000-000000000001'),
    }),
    app.inject({
      method: 'POST',
      url: '/api/tasks/import',
      payload: importPayload('91000000-0000-4000-8000-000000000002'),
    }),
  ]);
  assert.deepEqual([left.json().imported, right.json().imported].sort(), [0, 1]);
  assert.deepEqual([left.json().skipped, right.json().skipped].sort(), [0, 1]);
  const tasks = (await app.inject({ method: 'GET', url: '/api/tasks?project=work' })).json();
  assert.equal(tasks.filter(task => task.title === title).length, 1);
});

test('tasks: reorder persists status + sortOrder in one call', async () => {
  const res = await app.inject({
    method: 'PATCH',
    url: '/api/tasks/reorder',
    payload: {
      tasks: [
        { id: taskA.id, status: 'planned', sortOrder: 1 },
        { id: taskB.id, status: 'planned', sortOrder: 0 },
      ],
    },
  });
  assert.equal(res.statusCode, 200);
  const list = await app.inject({ method: 'GET', url: '/api/tasks?project=homelab' });
  const ordered = list.json()
    .filter(t => t.id === taskA.id || t.id === taskB.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  assert.deepEqual(ordered.map(t => t.title), ['Rotate TLS certs', 'Swap NAS drive']);
});

test('tasks: completing a recurring task spawns the next instance with an advanced due date', async () => {
  // A weekly cert rotation due far in the future, so the next instance is a
  // clean +7 regardless of the real date this test runs on (the route advances
  // from the real "now"; the roll-forward-past-today path is unit-tested).
  const created = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { title: 'Rotate gateway cert', priority: 'medium', status: 'planned', project: 'homelab', dueDate: '2030-07-10' },
  });
  const task = created.json();
  // Recurrence is set via PATCH (not accepted on create).
  const setRec = await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, payload: { recurrence: 'weekly' } });
  assert.equal(setRec.statusCode, 200);
  assert.equal(setRec.json().recurrence, 'weekly');

  const before = (await app.inject({ method: 'GET', url: '/api/tasks?project=homelab' })).json().filter(t => t.title === 'Rotate gateway cert').length;

  // Complete it → the next weekly instance appears, due +7 days, still planned + recurring.
  const done = await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, payload: { status: 'completed' } });
  assert.equal(done.json().status, 'completed');

  const rotations = (await app.inject({ method: 'GET', url: '/api/tasks?project=homelab' })).json().filter(t => t.title === 'Rotate gateway cert');
  assert.equal(rotations.length, before + 1, 'a next instance was created');
  const next = rotations.find(t => t.status === 'planned');
  assert.ok(next, 'next instance is planned');
  assert.equal(next.dueDate, '2030-07-17');
  assert.equal(next.recurrence, 'weekly');
  assert.notEqual(next.id, task.id);

  // Completing a NON-recurring task spawns nothing.
  const plain = (await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: 'One-off chore', project: 'homelab', priority: 'low', status: 'planned' } })).json();
  const countBefore = (await app.inject({ method: 'GET', url: '/api/tasks?project=homelab' })).json().length;
  await app.inject({ method: 'PATCH', url: `/api/tasks/${plain.id}`, payload: { status: 'completed' } });
  const countAfter = (await app.inject({ method: 'GET', url: '/api/tasks?project=homelab' })).json().length;
  assert.equal(countAfter, countBefore, 'no spawn for a non-recurring task');

  // An invalid recurrence token is rejected.
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, payload: { recurrence: 'yearly' } })).statusCode, 400);
});

test('tasks: labels round-trip and normalize (lowercase, strip @, dedupe) on create + patch', async () => {
  const created = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { title: 'Renew cert', priority: 'high', status: 'planned', project: 'homelab', labels: ['@Waiting', 'waiting', 'Cert-Rotation'] },
  });
  assert.equal(created.statusCode, 201);
  assert.deepEqual(created.json().labels, ['waiting', 'cert-rotation'], 'normalized + deduped on create');
  const id = created.json().id;

  const listed = (await app.inject({ method: 'GET', url: '/api/tasks?project=homelab' })).json().find(t => t.id === id);
  assert.deepEqual(listed.labels, ['waiting', 'cert-rotation']);

  const patched = await app.inject({ method: 'PATCH', url: `/api/tasks/${id}`, payload: { labels: ['@PagerDuty', ' pagerduty '] } });
  assert.deepEqual(patched.json().labels, ['pagerduty']);

  assert.deepEqual((await app.inject({ method: 'PATCH', url: `/api/tasks/${id}`, payload: { labels: [] } })).json().labels, []);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/tasks/${id}`, payload: { labels: 'nope' } })).statusCode, 400);
});

test('checklist: add, toggle, list, delete', async () => {
  const add = await app.inject({ method: 'POST', url: `/api/tasks/${taskA.id}/checklist`, payload: { label: 'Verify snapshot' } });
  assert.equal(add.statusCode, 201);
  const item = add.json();
  assert.equal(item.completed, false);

  const toggle = await app.inject({ method: 'PATCH', url: `/api/tasks/${taskA.id}/checklist/${item.id}`, payload: { completed: true } });
  assert.equal(toggle.statusCode, 200);
  assert.equal(toggle.json().completed, true);

  const list = await app.inject({ method: 'GET', url: `/api/tasks/${taskA.id}/checklist` });
  assert.equal(list.json().length, 1);
  assert.equal(list.json()[0].completed, true);

  const del = await app.inject({ method: 'DELETE', url: `/api/tasks/${taskA.id}/checklist/${item.id}` });
  assert.equal(del.statusCode, 204);
});

let docSource;
let docDerived;

test('library: create with tags, FTS search, filters', async () => {
  const create = await app.inject({
    method: 'POST',
    url: '/api/library/documents',
    payload: {
      title: 'Postgres restore runbook',
      body: '# Restore\n\nPromote the replica behind PgBouncer.',
      documentType: 'runbook',
      project: 'homelab',
      tags: ['postgres', 'dr'],
    },
  });
  assert.equal(create.statusCode, 201);
  docSource = create.json();
  assert.deepEqual(docSource.tags, ['postgres', 'dr']);
  assert.equal(docSource.verified, true); // human-authored default
  assert.ok(docSource.contentHash);

  const agentDoc = await app.inject({
    method: 'POST',
    url: '/api/library/documents',
    payload: {
      title: 'Synthesized recovery summary',
      body: 'When the primary dies, promote the replica.',
      documentType: 'note',
      project: 'homelab',
      tags: ['dr'],
      kind: 'synthesized',
    },
    headers: { 'x-prax-origin': 'agent' },
  });
  assert.equal(agentDoc.statusCode, 201);
  docDerived = agentDoc.json();
  assert.equal(docDerived.verified, false); // agent-authored starts unverified
  assert.equal(docDerived.kind, 'synthesized');

  // FTS5 full-text: body word hits
  const hit = await app.inject({ method: 'GET', url: '/api/library/documents?q=pgbouncer' });
  assert.deepEqual(hit.json().map(d => d.title), ['Postgres restore runbook']);

  // miss
  const miss = await app.inject({ method: 'GET', url: '/api/library/documents?q=kubernetes' });
  assert.equal(miss.json().length, 0);

  // FTS injection-ish input must not 500
  const weird = await app.inject({ method: 'GET', url: `/api/library/documents?q=${encodeURIComponent('post"; drop table--')}` });
  assert.equal(weird.statusCode, 200);

  const typed = await app.inject({ method: 'GET', url: '/api/library/documents?documentType=runbook&project=homelab' });
  assert.ok(typed.json().every(d => d.documentType === 'runbook'));

  const byKind = await app.inject({ method: 'GET', url: '/api/library/documents?kind=synthesized' });
  assert.deepEqual(byKind.json().map(d => d.id), [docDerived.id]);
});

test('library: caller document id is exact-once across a lost-response retry', async () => {
  const id = '92000000-0000-4000-8000-000000000001';
  const payload = {
    id,
    title: 'Exact-once Markdown import',
    body: '# Exact-once Markdown import\n\nBody\n',
    documentType: 'note',
    project: 'work',
    tags: ['imported'],
    sourceFilename: 'exact-once.md',
  };

  const created = await app.inject({ method: 'POST', url: '/api/library/documents', payload });
  const replayed = await app.inject({ method: 'POST', url: '/api/library/documents', payload });
  const conflicting = await app.inject({
    method: 'POST',
    url: '/api/library/documents',
    payload: { ...payload, body: '# Changed after identity allocation' },
  });

  assert.equal(created.statusCode, 201);
  assert.equal(replayed.statusCode, 200);
  assert.equal(replayed.json().id, id);
  assert.equal(conflicting.statusCode, 409);
  const listed = await app.inject({ method: 'GET', url: '/api/library/documents?project=work' });
  assert.equal(listed.json().filter(document => document.id === id).length, 1);
});

test('library: query-scoped context-pack gathers relevant docs (semantic off → keyword fallback)', async () => {
  // Markdown by default — includes the matching verified runbook.
  const md = await app.inject({ method: 'GET', url: '/api/library/context-pack?q=pgbouncer' });
  assert.equal(md.statusCode, 200);
  assert.match(md.headers['content-type'], /markdown/);
  assert.match(md.body, /Postgres restore runbook/);

  // format=json returns the structured pack object.
  const json = await app.inject({ method: 'GET', url: '/api/library/context-pack?q=pgbouncer&format=json' });
  assert.equal(json.statusCode, 200);
  assert.equal(typeof json.json(), 'object');

  // q is required; an unknown project is a 400.
  assert.equal((await app.inject({ method: 'GET', url: '/api/library/context-pack' })).statusCode, 400);
  assert.equal((await app.inject({ method: 'GET', url: '/api/library/context-pack?q=x&project=no-such-project' })).statusCode, 400);
});

test('library: runbook execution is exact-once, resumable, terminal on completion, and source-independent', async () => {
  const created = await app.inject({
    method: 'POST',
    url: '/api/library/documents',
    payload: {
      title: 'Failover runbook',
      body: '# Failover\n\n- [ ] Stop writes\n- [ ] Promote replica\n- [ ] Repoint app\n',
      documentType: 'runbook',
      project: 'homelab',
    },
  });
  const runbookId = created.json().id;
  const runId = '88888888-8888-4888-8888-888888888888';

  // Start identity is caller-stable: a retry returns the same operation and no
  // second start event. Non-runbook documents cannot be executed.
  const start = await app.inject({
    method: 'POST',
    url: `/api/library/documents/${runbookId}/runs`,
    payload: { id: runId, title: 'DR drill' },
  });
  assert.equal(start.statusCode, 201);
  const run = start.json();
  assert.equal(run.id, runId);
  assert.equal(run.status, 'running');
  assert.equal(run.title, 'DR drill');
  assert.equal(run.documentTitle, 'Failover runbook');
  assert.equal(run.events[0].type, 'started');
  assert.deepEqual(run.steps.map(s => s.text), ['Stop writes', 'Promote replica', 'Repoint app']);
  assert.ok(run.steps.every(s => s.checkedAt === null));
  const retry = await app.inject({
    method: 'POST',
    url: `/api/library/documents/${runbookId}/runs`,
    payload: { id: runId, title: 'DR drill' },
  });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().events.length, 1);
  assert.equal((await app.inject({
    method: 'POST', url: `/api/library/documents/${docDerived.id}/runs`, payload: {},
  })).statusCode, 409);

  // Check, replay, and uncheck append only actual changes. The source doc is untouched.
  const check = await app.inject({ method: 'PATCH', url: `/api/library/runs/${run.id}/steps/${run.steps[0].id}`, payload: { checked: true } });
  assert.equal(check.statusCode, 200);
  assert.match(check.json().checkedAt, /^\d{4}-\d{2}-\d{2}T/);
  const checkReplay = await app.inject({ method: 'PATCH', url: `/api/library/runs/${run.id}/steps/${run.steps[0].id}`, payload: { checked: true } });
  assert.equal(checkReplay.json().checkedAt, check.json().checkedAt);
  const uncheck = await app.inject({ method: 'PATCH', url: `/api/library/runs/${run.id}/steps/${run.steps[0].id}`, payload: { checked: false } });
  assert.equal(uncheck.json().checkedAt, null);
  const docAfter = await app.inject({ method: 'GET', url: `/api/library/documents/${runbookId}` });
  assert.ok(docAfter.json().body.includes('- [ ] Stop writes'), 'the runbook source is not rewritten by a run');

  // Bad payloads are rejected.
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/library/runs/${run.id}/steps/${run.steps[0].id}`, payload: {} })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/library/runs/${run.id}`, payload: { status: 'bogus' } })).statusCode, 400);

  // Abort blocks step changes and direct completion; Resume is explicit.
  const abort = await app.inject({ method: 'PATCH', url: `/api/library/runs/${run.id}`, payload: { status: 'aborted' } });
  assert.equal(abort.statusCode, 200);
  assert.equal((await app.inject({
    method: 'PATCH', url: `/api/library/runs/${run.id}/steps/${run.steps[0].id}`, payload: { checked: true },
  })).statusCode, 409);
  assert.equal((await app.inject({
    method: 'PATCH', url: `/api/library/runs/${run.id}`, payload: { status: 'completed' },
  })).statusCode, 409);
  const resume = await app.inject({ method: 'PATCH', url: `/api/library/runs/${run.id}`, payload: { status: 'running' } });
  assert.equal(resume.statusCode, 200);
  assert.equal(resume.json().finishedAt, null);
  await app.inject({
    method: 'PATCH', url: `/api/library/runs/${run.id}/steps/${run.steps[0].id}`, payload: { checked: true },
  });

  // Completion is terminal and a same-state replay preserves its first stamp.
  const finish = await app.inject({ method: 'PATCH', url: `/api/library/runs/${run.id}`, payload: { status: 'completed' } });
  assert.equal(finish.statusCode, 200);
  assert.match(finish.json().finishedAt, /^\d{4}-\d{2}-\d{2}T/);
  const finishReplay = await app.inject({ method: 'PATCH', url: `/api/library/runs/${run.id}`, payload: { status: 'completed' } });
  assert.equal(finishReplay.json().finishedAt, finish.json().finishedAt);
  assert.equal((await app.inject({
    method: 'PATCH', url: `/api/library/runs/${run.id}`, payload: { status: 'running' },
  })).statusCode, 409);

  // List + fetch reflect current state and the complete append-only history.
  const list = await app.inject({ method: 'GET', url: `/api/library/documents/${runbookId}/runs` });
  assert.equal(list.json()[0].stepCount, 3);
  assert.equal(list.json()[0].doneCount, 1);
  const fetched = (await app.inject({ method: 'GET', url: `/api/library/runs/${run.id}` })).json();
  assert.equal(fetched.status, 'completed');
  assert.deepEqual(fetched.events.map(event => event.type), [
    'started', 'step-checked', 'step-unchecked', 'aborted', 'resumed', 'step-checked', 'completed',
  ]);

  // Deleting the editable source does not delete the operational record, and
  // its snapshotted project/title still support a post-mortem.
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/library/documents/${runbookId}/permanent` })).statusCode, 200);
  const preserved = (await app.inject({ method: 'GET', url: `/api/library/runs/${run.id}` })).json();
  assert.equal(preserved.documentId, null);
  assert.equal(preserved.documentTitle, 'Failover runbook');
  assert.equal(preserved.events.length, 7);
  const postMortemId = '44444444-4444-4444-8444-444444444444';
  const postMortem = await app.inject({
    method: 'POST', url: `/api/library/runs/${run.id}/post-mortem`, payload: { id: postMortemId },
  });
  assert.equal(postMortem.statusCode, 201);
  assert.equal(postMortem.json().document.id, postMortemId);
  assert.match(postMortem.json().document.title, /Failover runbook/);
  const postMortemReplay = await app.inject({
    method: 'POST', url: `/api/library/runs/${run.id}/post-mortem`, payload: { id: postMortemId },
  });
  assert.equal(postMortemReplay.statusCode, 200);
  assert.equal(postMortemReplay.json().replayed, true);
  assert.equal(postMortemReplay.json().document.id, postMortemId);
  assert.equal((await app.inject({ method: 'GET', url: '/api/library/runs/11111111-1111-4111-8111-111111111111' })).statusCode, 404);
});

test('library: links, stale detection, and maintenance', async () => {
  const link = await app.inject({
    method: 'POST',
    url: `/api/library/documents/${docDerived.id}/links`,
    payload: { targetId: docSource.id, relation: 'derived-from' },
  });
  assert.equal(link.statusCode, 201);

  const links = await app.inject({ method: 'GET', url: `/api/library/documents/${docDerived.id}/links?direction=both` });
  const outbound = links.json().filter(l => l.direction === 'outbound');
  assert.equal(outbound.length, 1);
  assert.equal(outbound[0].relation, 'derived-from');

  // Not stale yet
  const staleNone = await app.inject({ method: 'GET', url: '/api/library/maintenance/stale' });
  assert.equal(staleNone.json().length, 0);

  // Edit the source: derived doc goes stale (hash mismatch)
  const edit = await app.inject({
    method: 'PATCH',
    url: `/api/library/documents/${docSource.id}`,
    payload: { body: '# Restore\n\nCompletely rewritten procedure.' },
  });
  assert.equal(edit.statusCode, 200);

  const stale = await app.inject({ method: 'GET', url: '/api/library/maintenance/stale' });
  assert.equal(stale.json().length, 1);
  assert.equal(stale.json()[0].documentId, docDerived.id);
  assert.equal(stale.json()[0].staleSources[0].documentId, docSource.id);

  // Stale flag also rides document listings
  const listed = await app.inject({ method: 'GET', url: '/api/library/documents?kind=synthesized' });
  assert.equal(listed.json()[0].stale, true);

  const removedOrphanEndpoint = await app.inject({ method: 'GET', url: '/api/library/maintenance/orphans' });
  assert.equal(removedOrphanEndpoint.statusCode, 404);
});

test('library: verify and supersede round-trip', async () => {
  const verify = await app.inject({
    method: 'POST',
    url: `/api/library/documents/${docDerived.id}/verify`,
    payload: { verified: true, as: 'user', revision: docDerived.revision },
  });
  assert.equal(verify.statusCode, 200);
  assert.equal(verify.json().verified, true);
  assert.equal(verify.json().verifiedBy, 'user');

  const replacement = await app.inject({
    method: 'POST',
    url: '/api/library/documents',
    payload: { title: 'Recovery v2', body: 'New summary', documentType: 'note', project: 'homelab' },
  });
  const supersede = await app.inject({
    method: 'POST',
    url: `/api/library/documents/${docDerived.id}/supersede`,
    payload: { supersededBy: replacement.json().id },
  });
  assert.equal(supersede.statusCode, 200);
  assert.equal(supersede.json().status, 'superseded');

  // Unlinking the superseding doc reverts the orphaned superseded doc
  const unlink = await app.inject({
    method: 'DELETE',
    url: `/api/library/documents/${replacement.json().id}/links/${docDerived.id}?relation=supersedes`,
  });
  assert.equal(unlink.statusCode, 200);
  const after = await app.inject({ method: 'GET', url: `/api/library/documents/${docDerived.id}` });
  assert.equal(after.json().status, 'active');
});

test('task↔document links and board extras aggregate', async () => {
  const link = await app.inject({
    method: 'POST',
    url: `/api/tasks/${taskA.id}/documents`,
    payload: { documentId: docSource.id },
  });
  assert.ok([200, 201].includes(link.statusCode));

  const docs = await app.inject({ method: 'GET', url: `/api/tasks/${taskA.id}/documents` });
  assert.deepEqual(docs.json().map(d => d.id), [docSource.id]);

  await app.inject({ method: 'POST', url: `/api/tasks/${taskA.id}/checklist`, payload: { label: 'step one' } });
  const extras = await app.inject({ method: 'GET', url: `/api/tasks/board-extras?ids=${taskA.id},${taskB.id}` });
  assert.equal(extras.statusCode, 200);
  const forA = extras.json().find(e => e.taskId === taskA.id);
  assert.equal(forA.docsCount, 1);
  assert.equal(forA.checklistTotal, 1);
  assert.equal(forA.nextChecklistItem, 'step one');
  assert.ok(forA.latestActivity.length > 0);

  const unlink = await app.inject({ method: 'DELETE', url: `/api/tasks/${taskA.id}/documents/${docSource.id}` });
  assert.equal(unlink.statusCode, 200);
});

test('tasks: export envelope, import skip-dedup, replace mode', async () => {
  const exported = await app.inject({ method: 'GET', url: '/api/tasks/export?project=homelab' });
  assert.equal(exported.statusCode, 200);
  assert.equal(exported.json().format, 'moomora.tasks');
  assert.equal(exported.json().version, 1);
  assert.ok(exported.json().tasks.length >= 2);

  // skip mode dedups on [title, project, status, dueDate]
  const dupe = await app.inject({
    method: 'POST',
    url: '/api/tasks/import',
    payload: { project: 'homelab', tasks: [{ title: 'Swap NAS drive', status: 'planned', dueDate: '2026-07-10' }] },
  });
  assert.equal(dupe.json().skipped, 1);

  const replace = await app.inject({
    method: 'POST',
    url: '/api/tasks/import',
    payload: { project: 'homelab', mode: 'replace', tasks: [{ title: 'Only survivor' }] },
  });
  assert.equal(replace.statusCode, 201);
  const after = await app.inject({ method: 'GET', url: '/api/tasks?project=homelab&archived=all' });
  assert.deepEqual(after.json().map(t => t.title), ['Only survivor']);
});

test('tasks: archive → restore → permanent delete lifecycle', async () => {
  const created = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { title: 'Ephemeral', priority: 'low', status: 'planned', project: 'homelab' },
  });
  const id = created.json().id;

  const archived = await app.inject({ method: 'DELETE', url: `/api/tasks/${id}` });
  assert.equal(archived.statusCode, 200);
  assert.ok(archived.json().archivedAt);

  const restored = await app.inject({ method: 'PATCH', url: `/api/tasks/${id}/restore` });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.json().archivedAt, null);

  await app.inject({ method: 'DELETE', url: `/api/tasks/${id}` });
  const gone = await app.inject({ method: 'DELETE', url: `/api/tasks/${id}/permanent` });
  assert.equal(gone.statusCode, 200);
});

test('projects: deleting a project takes its tasks and documents with it; Memory is refused', async () => {
  const proj = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Disposable' } })).json();
  const task = (await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: 'Goes with it', priority: 'low', status: 'planned', project: 'disposable' } })).json();
  const doc = (await app.inject({ method: 'POST', url: '/api/library/documents', payload: { title: 'Goes with it too', body: 'x', documentType: 'note', project: 'disposable' } })).json();
  const res = await app.inject({ method: 'DELETE', url: `/api/projects/${proj.id}/permanent` });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().deleted, { tasks: 1, documents: 1 });
  assert.equal((await app.inject({ method: 'GET', url: `/api/tasks/${task.id}` })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: `/api/library/documents/${doc.id}` })).statusCode, 404);

  const memory = (await app.inject({ method: 'GET', url: '/api/projects' })).json().find(p => p.slug === 'memory');
  const refused = await app.inject({ method: 'DELETE', url: `/api/projects/${memory.id}/permanent` });
  assert.equal(refused.statusCode, 403);
  assert.match(refused.json().message, /Memory project/);
});

test('library export: single .md front-matter and zip archive', async () => {
  const single = await app.inject({ method: 'GET', url: `/api/library/documents/${docSource.id}/export` });
  assert.equal(single.statusCode, 200);
  assert.match(single.headers['content-type'], /text\/markdown/);
  assert.match(single.body, /^---\ntitle: Postgres restore runbook\n/);
  assert.match(single.body, /project: homelab/);

  const zip = await app.inject({ method: 'GET', url: '/api/library/export?project=all' });
  assert.equal(zip.statusCode, 200);
  assert.match(zip.headers['content-type'], /application\/zip/);
});

test('semantic search degrades honestly with no backend', async () => {
  const status = await app.inject({ method: 'GET', url: '/api/settings/semantic-search' });
  assert.equal(status.json().available, false);

  const search = await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=restore' });
  assert.equal(search.statusCode, 409);

  const reindex = await app.inject({ method: 'POST', url: '/api/library/embeddings/reindex' });
  assert.equal(reindex.statusCode, 409);
});

test('context pack renders markdown from the keyword fallback', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/projects/homelab/context-pack' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/markdown/);
});

test('semantic search: runtime provider config + reindex + JS-cosine ranking (fake backend)', async () => {
  // Invalid provider config never persists.
  const bad = await app.inject({ method: 'PUT', url: '/api/settings/semantic-search', payload: { backend: 'quantum' } });
  assert.equal(bad.statusCode, 400);
  const badUrl = await app.inject({ method: 'PUT', url: '/api/settings/semantic-search', payload: { backend: 'ollama', ollamaUrl: 'not a url' } });
  assert.equal(badUrl.statusCode, 400);
  assert.equal((await app.inject({ method: 'GET', url: '/api/settings/semantic-search' })).json().available, false);

  // Enable the deterministic fake backend at runtime — no restart, no env.
  const put = await app.inject({ method: 'PUT', url: '/api/settings/semantic-search', payload: { backend: 'fake', enabled: true } });
  assert.equal(put.statusCode, 200);
  const status = put.json();
  assert.equal(status.available, true);
  assert.equal(status.enabled, true);
  assert.equal(status.backend, 'fake');
  assert.equal(status.connected, true);
  assert.equal(status.hasApiKey, false);
  assert.equal(typeof status.model, 'string');
  assert.equal(typeof status.baseUrl, 'string');
  assert.equal(status.keyRequired, false);
  assert.equal(typeof status.ollamaUrl, 'string');
  assert.equal(typeof status.openaiBaseUrl, 'string');

  const created = await app.inject({
    method: 'POST',
    url: '/api/library/documents',
    payload: { title: 'Backup drill', body: 'Quarterly restore rehearsal for the NAS.', documentType: 'note', project: 'homelab' },
  });
  assert.equal(created.statusCode, 201);
  const target = created.json();

  // Reindex embeds every active doc (idempotent with the write-path embed).
  const reindex = await app.inject({ method: 'POST', url: '/api/library/embeddings/reindex' });
  assert.equal(reindex.statusCode, 200);
  assert.equal(reindex.json().failed, 0);

  const counts = (await app.inject({ method: 'GET', url: '/api/settings/semantic-search' })).json();
  assert.ok(counts.totalCount >= 4, `expected the flow's docs, got ${counts.totalCount}`);
  assert.equal(counts.embeddedCount, counts.totalCount);

  // The fake embedder is deterministic (text -> fixed vector), so a query of
  // the exact embedded text (title\n\nbody) makes the doc its own top hit.
  const q = encodeURIComponent('Backup drill\n\nQuarterly restore rehearsal for the NAS.');
  const search = await app.inject({ method: 'GET', url: `/api/library/documents/semantic-search?q=${q}` });
  assert.equal(search.statusCode, 200);
  const refs = search.json();
  assert.ok(refs.length >= 1, 'expected at least the exact-match doc');
  assert.equal(refs[0].id, target.id);
  assert.ok('snippet' in refs[0]);
  for (const ref of refs) {
    // The raw embedding vector must never leak…
    assert.ok(!('embedding' in ref));
    // …but the real cosine similarity is now surfaced (0..1) so the UI can
    // show "why it matched" honestly.
    assert.ok('similarity' in ref, 'semantic results expose a similarity score');
    assert.equal(typeof ref.similarity, 'number');
    assert.ok(ref.similarity >= 0 && ref.similarity <= 1, `similarity in [0,1], got ${ref.similarity}`);
  }
  // The exact-text match is its own top hit at ~1.0 similarity.
  assert.ok(refs[0].similarity >= 0.99, `exact match should score ~1, got ${refs[0].similarity}`);

  // Project scoping still applies on the JS-cosine path.
  const scoped = await app.inject({ method: 'GET', url: `/api/library/documents/semantic-search?q=${q}&project=personal` });
  assert.equal(scoped.statusCode, 200);
  assert.equal(scoped.json().length, 0);

  // Context pack rides the same semantic branch when given a query.
  const pack = await app.inject({ method: 'GET', url: `/api/projects/homelab/context-pack?query=${q}&format=json` });
  assert.equal(pack.statusCode, 200);
  assert.ok(pack.json().sections.some((s) => s.items.some((i) => i.id === target.id)));

  // Disable -> the gate slams shut again (honest degradation).
  const off = await app.inject({ method: 'PUT', url: '/api/settings/semantic-search', payload: { enabled: false } });
  assert.equal(off.json().enabled, false);
  assert.equal((await app.inject({ method: 'GET', url: `/api/library/documents/semantic-search?q=${q}` })).statusCode, 409);

  // Back to backend none -> unavailable everywhere, like the shipped default.
  const none = await app.inject({ method: 'PUT', url: '/api/settings/semantic-search', payload: { backend: 'none' } });
  assert.equal(none.statusCode, 200);
  assert.equal(none.json().available, false);
  assert.equal((await app.inject({ method: 'POST', url: '/api/library/embeddings/reindex' })).statusCode, 409);
});

test('task export/import round-trips current fields and checklist state', async () => {
  const sourceProject = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Portable source' } })).json();
  const targetProject = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Portable target' } })).json();
  const created = (await app.inject({
    method: 'POST', url: '/api/tasks',
    payload: {
      title: 'Portable task', description: 'details', notes: 'operator context',
      priority: 'high', status: 'planned', project: sourceProject.slug,
      dueDate: '2026-07-13', dueTime: '09:30',
      recurrence: 'weekly', labels: ['Waiting'],
    },
  })).json();
  await app.inject({
    method: 'PATCH', url: `/api/tasks/${created.id}`,
    payload: { deferredUntil: '2026-07-12T18:00:00.000Z' },
  });
  const item = (await app.inject({ method: 'POST', url: `/api/tasks/${created.id}/checklist`, payload: { label: 'Verify result' } })).json();
  await app.inject({ method: 'PATCH', url: `/api/tasks/${created.id}/checklist/${item.id}`, payload: { completed: true } });

  const exported = (await app.inject({ method: 'GET', url: `/api/tasks/export?project=${sourceProject.slug}` })).json();
  assert.equal(exported.tasks[0].checklist[0].completed, true);
  const imported = await app.inject({
    method: 'POST', url: '/api/tasks/import',
    payload: { project: targetProject.slug, mode: 'append', tasks: exported.tasks },
  });
  assert.equal(imported.statusCode, 201);
  const restored = (await app.inject({ method: 'GET', url: `/api/tasks?project=${targetProject.slug}` })).json()[0];
  assert.deepEqual({
    notes: restored.notes, dueTime: restored.dueTime, deferredUntil: restored.deferredUntil,
    recurrence: restored.recurrence, labels: restored.labels,
  }, {
    notes: 'operator context', dueTime: '09:30', deferredUntil: '2026-07-12T18:00:00.000Z',
    recurrence: 'weekly', labels: ['waiting'],
  });
  const restoredChecklist = (await app.inject({ method: 'GET', url: `/api/tasks/${restored.id}/checklist` })).json();
  assert.deepEqual(restoredChecklist.map((entry) => ({ label: entry.label, completed: entry.completed })), [
    { label: 'Verify result', completed: true },
  ]);
});

test('agent edits revoke verification on previously trusted documents', async () => {
  const created = (await app.inject({
    method: 'POST', url: '/api/library/documents',
    payload: { title: 'Trusted memory', body: 'human fact', documentType: 'note', project: 'homelab' },
  })).json();
  assert.equal(created.verified, true);
  const edited = (await app.inject({
    method: 'PATCH', url: `/api/library/documents/${created.id}`,
    headers: { 'x-prax-origin': 'agent' }, payload: { body: 'agent revision' },
  })).json();
  assert.equal(edited.updatedBy, 'agent');
  assert.equal(edited.verified, false);
  assert.equal(edited.verifiedAt, null);
  assert.equal(edited.verifiedBy, null);
});

test('human-reviewed editor writes retain verification', async () => {
  const created = (await app.inject({
    method: 'POST', url: '/api/library/documents',
    payload: { title: 'Reviewed writing', body: 'trusted original', documentType: 'note', project: 'homelab' },
  })).json();
  assert.equal(created.verified, true);

  // Editor writing actions return a preview and only alter the local draft
  // after the person clicks Apply. Autosave then uses the ordinary user-origin
  // PATCH path, so reviewing exact generated text does not destroy trust.
  const edited = (await app.inject({
    method: 'PATCH', url: `/api/library/documents/${created.id}`,
    payload: { body: 'exact generated text reviewed and applied by the person' },
  })).json();
  assert.equal(edited.updatedBy, 'user');
  assert.equal(edited.verified, true);
});

test('superseded status follows archive, restore, and deletion of the replacement', async () => {
  const createDoc = async (title) => (await app.inject({
    method: 'POST', url: '/api/library/documents',
    payload: { title, body: title, documentType: 'note', project: 'homelab' },
  })).json();
  const oldDoc = await createDoc('Lifecycle old');
  const replacement = await createDoc('Lifecycle replacement');
  await app.inject({ method: 'POST', url: `/api/library/documents/${oldDoc.id}/supersede`, payload: { supersededBy: replacement.id } });
  assert.equal((await app.inject({ method: 'GET', url: `/api/library/documents/${oldDoc.id}` })).json().status, 'superseded');

  await app.inject({ method: 'DELETE', url: `/api/library/documents/${replacement.id}` });
  assert.equal((await app.inject({ method: 'GET', url: `/api/library/documents/${oldDoc.id}` })).json().status, 'active');
  await app.inject({ method: 'PATCH', url: `/api/library/documents/${replacement.id}/restore` });
  assert.equal((await app.inject({ method: 'GET', url: `/api/library/documents/${oldDoc.id}` })).json().status, 'superseded');
  await app.inject({ method: 'DELETE', url: `/api/library/documents/${replacement.id}/permanent` });
  assert.equal((await app.inject({ method: 'GET', url: `/api/library/documents/${oldDoc.id}` })).json().status, 'active');
});

test('generic supersedes links atomically follow the complete live replacement set', async () => {
  const createDoc = async (title) => (await app.inject({
    method: 'POST', url: '/api/library/documents',
    payload: { title, body: title, documentType: 'note', project: 'homelab' },
  })).json();
  const predecessor = await createDoc('Atomic lifecycle predecessor');
  const replacementA = await createDoc('Atomic lifecycle replacement A');
  const replacementB = await createDoc('Atomic lifecycle replacement B');

  // The generic relation route is also the MCP link_documents path. It must
  // enforce the same lifecycle contract as POST .../supersede.
  const first = await app.inject({
    method: 'POST', url: `/api/library/documents/${replacementA.id}/links`,
    payload: { targetId: predecessor.id, relation: 'supersedes' },
  });
  assert.equal(first.statusCode, 201);
  assert.equal((await app.inject({ method: 'GET', url: `/api/library/documents/${predecessor.id}` })).json().status, 'superseded');
  assert.equal((await app.inject({ method: 'GET', url: '/api/library/documents?status=active' })).json().some(doc => doc.id === predecessor.id), false);

  await app.inject({
    method: 'POST', url: `/api/library/documents/${replacementB.id}/links`,
    payload: { targetId: predecessor.id, relation: 'supersedes' },
  });

  // Removing one of two live replacements cannot reactivate the predecessor.
  await app.inject({ method: 'DELETE', url: `/api/library/documents/${replacementA.id}` });
  assert.equal((await app.inject({ method: 'GET', url: `/api/library/documents/${predecessor.id}` })).json().status, 'superseded');
  await app.inject({
    method: 'DELETE',
    url: `/api/library/documents/${replacementB.id}/links/${predecessor.id}?relation=supersedes`,
  });
  assert.equal((await app.inject({ method: 'GET', url: `/api/library/documents/${predecessor.id}` })).json().status, 'active');

  // Restore re-establishes the remaining edge; cascade deletion releases it.
  await app.inject({ method: 'PATCH', url: `/api/library/documents/${replacementA.id}/restore` });
  assert.equal((await app.inject({ method: 'GET', url: `/api/library/documents/${predecessor.id}` })).json().status, 'superseded');
  await app.inject({ method: 'DELETE', url: `/api/library/documents/${replacementA.id}/permanent` });
  assert.equal((await app.inject({ method: 'GET', url: `/api/library/documents/${predecessor.id}` })).json().status, 'active');
  assert.equal((await app.inject({ method: 'GET', url: '/api/library/documents?status=active' })).json().some(doc => doc.id === predecessor.id), true);
});

test('recurring clones retain scheduling metadata and reject unsafe intervals', async () => {
  const invalid = await app.inject({
    method: 'POST', url: '/api/tasks',
    payload: { title: 'Unsafe recurrence', priority: 'medium', status: 'planned', project: 'inbox', recurrence: `every:${'9'.repeat(30)}d` },
  });
  assert.equal(invalid.statusCode, 400);

  const original = (await app.inject({
    method: 'POST', url: '/api/tasks',
    payload: {
      title: 'Recurring metadata', priority: 'medium', status: 'planned', project: 'inbox',
      dueDate: '2026-07-12', dueTime: '08:45', recurrence: 'weekly', labels: ['ops'],
    },
  })).json();
  await app.inject({ method: 'PATCH', url: `/api/tasks/${original.id}`, payload: { status: 'completed' } });
  const instances = (await app.inject({ method: 'GET', url: '/api/tasks?project=inbox' })).json()
    .filter((task) => task.title === 'Recurring metadata');
  const next = instances.find((task) => task.status === 'planned');
  assert.ok(next);
  assert.equal(next.dueTime, '08:45');
  assert.deepEqual(next.labels, ['ops']);
  assert.equal(next.recurrence, 'weekly');
  assert.match(next.dueDate, /^\d{4}-\d{2}-\d{2}$/);
});

test('reopening a completed recurring occurrence keeps one successor and detaches the old occurrence', async () => {
  const original = (await app.inject({
    method: 'POST', url: '/api/tasks',
    payload: {
      title: 'Recurring reopen safety', priority: 'medium', status: 'planned', project: 'inbox',
      dueDate: '2031-01-10', recurrence: 'monthly',
    },
  })).json();

  assert.equal((await app.inject({
    method: 'PATCH', url: `/api/tasks/${original.id}`, payload: { status: 'completed' },
  })).statusCode, 200);
  let instances = (await app.inject({ method: 'GET', url: '/api/tasks?project=inbox' })).json()
    .filter((task) => task.title === original.title);
  assert.equal(instances.length, 2);

  const reopened = await app.inject({
    method: 'PATCH', url: `/api/tasks/${original.id}`, payload: { status: 'planned' },
  });
  assert.equal(reopened.statusCode, 200);
  assert.equal(reopened.json().status, 'planned');
  assert.equal(reopened.json().recurrence, null, 'the reopened historical occurrence is one-off');

  await app.inject({
    method: 'PATCH', url: `/api/tasks/${original.id}`, payload: { status: 'completed' },
  });
  instances = (await app.inject({ method: 'GET', url: '/api/tasks?project=inbox' })).json()
    .filter((task) => task.title === original.title);
  assert.equal(instances.length, 2, 'completing the reopened one-off does not duplicate the successor');
});

test('board reorder completion uses the same atomic recurring lifecycle', async () => {
  const original = (await app.inject({
    method: 'POST', url: '/api/tasks',
    payload: {
      title: 'Recurring board move', priority: 'medium', status: 'planned', project: 'inbox',
      dueDate: '2031-06-10', recurrence: 'weekly',
    },
  })).json();
  const complete = await app.inject({
    method: 'PATCH', url: '/api/tasks/reorder',
    payload: { tasks: [{ id: original.id, status: 'completed', sortOrder: 0 }] },
  });
  assert.equal(complete.statusCode, 200);
  let instances = (await app.inject({ method: 'GET', url: '/api/tasks?project=inbox' })).json()
    .filter((task) => task.title === original.title);
  assert.equal(instances.length, 2);
  assert.ok(instances.some((task) => task.status === 'planned' && task.recurrence === 'weekly'));

  const reopen = await app.inject({
    method: 'PATCH', url: '/api/tasks/reorder',
    payload: { tasks: [{ id: original.id, status: 'planned', sortOrder: 1 }] },
  });
  assert.equal(reopen.statusCode, 200);
  assert.equal(reopen.json()[0].recurrence, null);
  instances = (await app.inject({ method: 'GET', url: '/api/tasks?project=inbox' })).json()
    .filter((task) => task.title === original.title);
  assert.equal(instances.length, 2);
});

test('recurring successor failure atomically rolls back source completion', async () => {
  const original = (await app.inject({
    method: 'POST', url: '/api/tasks',
    payload: {
      title: 'Atomic recurrence rollback', priority: 'high', status: 'planned', project: 'inbox',
      dueDate: '2031-03-10', recurrence: 'weekly',
    },
  })).json();
  app.db.exec(`
    create trigger fail_atomic_recurring_successor
    before insert on tasks
    when new.title = 'Atomic recurrence rollback'
      and exists (select 1 from tasks where title = new.title)
    begin
      select raise(abort, 'injected recurring successor failure');
    end;
  `);
  try {
    const completion = await app.inject({
      method: 'PATCH', url: `/api/tasks/${original.id}`, payload: { status: 'completed' },
    });
    assert.equal(completion.statusCode, 500);
    const canonical = (await app.inject({ method: 'GET', url: `/api/tasks/${original.id}` })).json();
    assert.equal(canonical.status, 'planned');
    const instances = (await app.inject({ method: 'GET', url: '/api/tasks?project=inbox' })).json()
      .filter((task) => task.title === original.title);
    assert.equal(instances.length, 1);
  } finally {
    app.db.exec('drop trigger if exists fail_atomic_recurring_successor');
  }
});

test('teardown', async () => {
  await app.close();
});
