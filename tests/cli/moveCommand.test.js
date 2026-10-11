// `prax move` through the real CLI and a real app: a document and a task each
// refiled under another project, and every refusal the command promises (an
// unknown project is never created, a retired document stays put, a record
// already under the target is reported, an unknown id names both kinds).
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
      encoding: 'utf8', env: { ...process.env, PRAX_API_URL: url, PRAX_PROJECT: 'alpha', PRAX_AGENT: '' },
    }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
  });
}

async function api(method, path, payload) {
  const res = await app.inject({ method, url: path, ...(payload ? { payload } : {}) });
  return { status: res.statusCode, body: res.json() };
}

const alpha = (await api('POST', '/api/projects', { name: 'alpha' })).body;
const beta = (await api('POST', '/api/projects', { name: 'beta' })).body;
assert.ok(alpha.id && beta.id, 'two projects to move between');

async function remember(title) {
  const { code, stdout, stderr } = await prax(['remember', title, '--body', `${title} body`, '--project', 'alpha', '--json']);
  assert.equal(code, 0, stderr);
  return JSON.parse(stdout);
}

test('a document moves to the named project and the server records the new owner', async () => {
  const doc = await remember('Proxmox backup runbook');
  assert.equal(doc.projectId, alpha.id);
  const { code, stdout, stderr } = await prax(['move', doc.id, '--to', 'beta']);
  assert.equal(code, 0, stderr);
  assert.match(stdout, /^Moved document "Proxmox backup runbook" \(.+\) from alpha to beta\.$/m);
  const after = (await api('GET', `/api/library/documents/${doc.id}`)).body;
  assert.equal(after.projectId, beta.id);
  assert.equal(after.title, 'Proxmox backup runbook', 'nothing but the owner changed');
});

test('a task moves too, and --json names the kind, both projects and the updated record', async () => {
  const added = await prax(['task', 'add', 'Rotate the token', '--json']);
  assert.equal(added.code, 0, added.stderr);
  const task = JSON.parse(added.stdout);
  assert.equal(task.projectId, alpha.id);
  const { code, stdout, stderr } = await prax(['move', task.id, '--to', 'beta', '--json']);
  assert.equal(code, 0, stderr);
  const result = JSON.parse(stdout);
  assert.equal(result.kind, 'task');
  assert.equal(result.id, task.id);
  assert.deepEqual([result.from, result.to], ['alpha', 'beta']);
  assert.equal(result.record.projectId, beta.id);
  assert.equal((await api('GET', `/api/tasks/${task.id}`)).body.projectId, beta.id);
});

test('the target is matched by slug or by name, case-insensitively', async () => {
  const doc = await remember('Matched by name');
  const { code, stderr } = await prax(['move', doc.id, '--to', 'BETA']);
  assert.equal(code, 0, stderr);
  assert.equal((await api('GET', `/api/library/documents/${doc.id}`)).body.projectId, beta.id);
});

test('an unknown project is refused and never created', async () => {
  const doc = await remember('Stays in alpha');
  const { code, stderr } = await prax(['move', doc.id, '--to', 'gamma']);
  assert.equal(code, 1);
  assert.match(stderr, /project "gamma" does not exist; move never creates one/);
  const projects = (await api('GET', '/api/projects')).body;
  assert.ok(!projects.some((p) => p.slug === 'gamma'), 'no project was created');
  assert.equal((await api('GET', `/api/library/documents/${doc.id}`)).body.projectId, alpha.id);
});

test('a record already under the target is reported, not rewritten', async () => {
  const doc = await remember('Already home');
  const before = (await api('GET', `/api/library/documents/${doc.id}`)).body;
  const { code, stderr } = await prax(['move', doc.id, '--to', 'alpha']);
  assert.equal(code, 1);
  assert.match(stderr, /is already in alpha/);
  const after = (await api('GET', `/api/library/documents/${doc.id}`)).body;
  assert.equal(after.updatedAt, before.updatedAt, 'no write happened');
});

test('a superseded document keeps its place in history', async () => {
  const old = await remember('Old guidance');
  const replacement = await remember('New guidance');
  const sup = await api('POST', `/api/library/documents/${old.id}/supersede`, { supersededBy: replacement.id });
  assert.equal(sup.status, 200, JSON.stringify(sup.body));
  const { code, stderr } = await prax(['move', old.id, '--to', 'beta']);
  assert.equal(code, 1);
  assert.match(stderr, /is superseded; only an active document can be moved/);
  assert.equal((await api('GET', `/api/library/documents/${old.id}`)).body.projectId, alpha.id);
});

test('an unknown id, a missing id and a missing --to are refused with the reason', async () => {
  const unknown = await prax(['move', '11111111-2222-4333-8444-555555555555', '--to', 'beta']);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /no document or task with id 11111111-2222-4333-8444-555555555555/);
  const noId = await prax(['move', '--to', 'beta']);
  assert.equal(noId.code, 1);
  assert.match(noId.stderr, /move requires a document or task id/);
  const noTarget = await prax(['move', '11111111-2222-4333-8444-555555555555']);
  assert.equal(noTarget.code, 1);
  assert.match(noTarget.stderr, /move requires --to <project-slug>/);
});
