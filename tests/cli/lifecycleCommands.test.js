// `prax archive`, `prax restore` and `prax delete` through the real CLI and a
// real app (the Prax Library document "Prax design: agents archive, restore and delete"): archive is reversible and
// drops the record out of recall, restore brings it back, and delete is
// permanent only for an archived, unverified record with an explicit --yes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';

const CLI = fileURLToPath(new URL('../../cli/prax.js', import.meta.url));
const app = await buildApp({ config: loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' }) });
await app.listen({ port: 0, host: '127.0.0.1' });
const url = `http://127.0.0.1:${app.server.address().port}`;
test.after(() => app.close());

function prax(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], {
      encoding: 'utf8', env: { ...process.env, PRAX_API_URL: url, PRAX_PROJECT: 'lifecycle', PRAX_AGENT: 'codex' },
    }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
  });
}

async function api(method, path, payload) {
  const res = await app.inject({ method, url: path, ...(payload ? { payload } : {}) });
  return { status: res.statusCode, body: res.statusCode === 204 ? null : res.json() };
}

const project = (await api('POST', '/api/projects', { name: 'lifecycle' })).body;
assert.ok(project.id);

async function remember(title) {
  const { code, stdout, stderr } = await prax(['remember', title, '--body', `${title} body`, '--json']);
  assert.equal(code, 0, stderr);
  return JSON.parse(stdout);
}

test('archive takes a document out of recall and restore brings it back; both are attributed to the agent', async () => {
  const doc = await remember('Wrong note about the proxy');
  const archived = await prax(['archive', doc.id]);
  assert.equal(archived.code, 0, archived.stderr);
  assert.match(archived.stdout, /^Archived document "Wrong note about the proxy" \(.+\)\. Restore it with `prax restore /m);
  const stored = (await api('GET', `/api/library/documents/${doc.id}`)).body;
  assert.ok(stored.archivedAt, 'archivedAt is set');
  assert.equal(stored.updatedBy, 'agent');
  assert.equal(stored.updatedByAgent, 'codex', 'the archiving agent is on the record');
  const miss = await prax(['recall', 'wrong note about the proxy']);
  assert.doesNotMatch(miss.stdout, /Wrong note about the proxy/, 'an archived document is not recalled');

  const again = await prax(['archive', doc.id]);
  assert.equal(again.code, 1);
  assert.match(again.stderr, /is already archived/);

  const restored = await prax(['restore', doc.id, '--json']);
  assert.equal(restored.code, 0, restored.stderr);
  const result = JSON.parse(restored.stdout);
  assert.equal(result.action, 'restored');
  assert.equal(result.kind, 'document');
  assert.equal((await api('GET', `/api/library/documents/${doc.id}`)).body.archivedAt, null);
  const notArchived = await prax(['restore', doc.id]);
  assert.equal(notArchived.code, 1);
  assert.match(notArchived.stderr, /is not archived; nothing to restore/);
});

test('delete is permanent and guarded: archived first, never verified, and only with --yes', async () => {
  const doc = await remember('Scratch note to remove');
  const live = await prax(['delete', doc.id, '--yes']);
  assert.equal(live.code, 1);
  assert.match(live.stderr, /is not archived\. Delete is permanent and takes an archived record only/);
  assert.equal((await api('GET', `/api/library/documents/${doc.id}`)).status, 200, 'nothing was deleted');

  assert.equal((await prax(['archive', doc.id])).code, 0);
  const noYes = await prax(['delete', doc.id]);
  assert.equal(noYes.code, 1);
  assert.match(noYes.stderr, /would be permanently deleted\. Re-run with --yes/);
  assert.equal((await api('GET', `/api/library/documents/${doc.id}`)).status, 200, 'still there without --yes');

  const gone = await prax(['delete', doc.id, '--yes']);
  assert.equal(gone.code, 0, gone.stderr);
  assert.match(gone.stdout, /^Permanently deleted document "Scratch note to remove"/);
  assert.equal((await api('GET', `/api/library/documents/${doc.id}`)).status, 404);

  // A verified document is never deleted by an agent, archived or not.
  const verified = await remember('Verified runbook that must stay');
  const ver = await api('POST', `/api/library/documents/${verified.id}/verify`, { verified: true, revision: verified.revision, as: 'mark' });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  assert.equal((await prax(['archive', verified.id])).code, 0, 'archiving a verified document is allowed (reversible)');
  const refused = await prax(['delete', verified.id, '--yes']);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /was verified by mark; an agent never deletes verified memory/);
  assert.equal((await api('GET', `/api/library/documents/${verified.id}`)).status, 200);
});

test('tasks follow the same lifecycle, with the archive and restore logged as the agent', async () => {
  const added = await prax(['task', 'add', 'Temporary task', '--json']);
  assert.equal(added.code, 0, added.stderr);
  const task = JSON.parse(added.stdout);
  const archived = await prax(['archive', task.id, '--json']);
  assert.equal(archived.code, 0, archived.stderr);
  assert.equal(JSON.parse(archived.stdout).kind, 'task');
  assert.ok((await api('GET', `/api/tasks/${task.id}`)).body.archivedAt);
  const activity = (await api('GET', `/api/tasks/${task.id}/activity`)).body;
  const entries = Array.isArray(activity) ? activity : (activity.items || []);
  const archivedEntry = entries.find((e) => /archived/i.test(e.type || e.kind || e.message || ''));
  assert.ok(archivedEntry, 'the archive is in the task activity');
  assert.match(JSON.stringify(archivedEntry), /agent/, 'and names the agent as the actor');

  assert.equal((await prax(['restore', task.id])).code, 0);
  assert.equal((await api('GET', `/api/tasks/${task.id}`)).body.archivedAt, null);
  const live = await prax(['delete', task.id, '--yes']);
  assert.equal(live.code, 1, 'an open task is not deleted');
  assert.equal((await prax(['archive', task.id])).code, 0);
  const gone = await prax(['delete', task.id, '--yes']);
  assert.equal(gone.code, 0, gone.stderr);
  assert.equal((await api('GET', `/api/tasks/${task.id}`)).status, 404);
});

test('an unknown id and a missing id are refused with the reason', async () => {
  const unknown = await prax(['archive', '11111111-2222-4333-8444-555555555555']);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /no document or task with id 11111111-2222-4333-8444-555555555555/);
  const missing = await prax(['delete']);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /delete requires a document or task id/);
});
