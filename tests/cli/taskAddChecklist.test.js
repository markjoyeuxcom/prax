// `prax task add --check` through the real CLI and a real app. v0.39.0 shipped
// with `check` declared both as task add's repeatable checklist flag and as
// `mirror --check`'s boolean in one global grammar; the boolean won and every
// task add with a checklist was refused. The grammar tests used parseArgs with
// their own grammar, so only an end-to-end run of the CLI catches this class.
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
      encoding: 'utf8', env: { ...process.env, PRAX_API_URL: url, PRAX_PROJECT: 'demo', PRAX_AGENT: '' },
    }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
  });
}

async function checklistOf(taskId) {
  const res = await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/checklist` });
  return res.json().map((item) => item.label);
}

test('task add --check a --check b creates both checklist items, in order', async () => {
  const { code, stdout, stderr } = await prax(['task', 'add', 'Rotate the token', '--check', 'New token issued', '--check', 'Old token revoked', '--json']);
  assert.equal(code, 0, stderr);
  const task = JSON.parse(stdout);
  assert.deepEqual(await checklistOf(task.id), ['New token issued', 'Old token revoked']);
});

test('the --check=<item> form works, including an item that begins with --', async () => {
  const { code, stdout, stderr } = await prax(['task', 'add', 'Document the flags', '--check=First', '--check=--json output is documented', '--json']);
  assert.equal(code, 0, stderr);
  assert.deepEqual(await checklistOf(JSON.parse(stdout).id), ['First', '--json output is documented']);
});

test('a global flag before the command still selects task add\'s grammar', async () => {
  const { code, stdout, stderr } = await prax(['--project', 'demo', 'task', 'add', 'Global flag first', '--check', 'Only item', '--json']);
  assert.equal(code, 0, stderr);
  assert.deepEqual(await checklistOf(JSON.parse(stdout).id), ['Only item']);
});

test('a bare --check on task add is still refused rather than silently dropped', async () => {
  const { code, stderr } = await prax(['task', 'add', 'Bare check', '--check']);
  assert.notEqual(code, 0);
  assert.match(stderr, /--check needs a value/);
});

test('mirror --check is still a boolean: it takes no value and never swallows the next word', async () => {
  const valued = await prax(['mirror', '--check=yes']);
  assert.notEqual(valued.code, 0);
  assert.match(valued.stderr, /--check takes no value/);
  const unexpected = await prax(['mirror', '--check', 'stray']);
  assert.notEqual(unexpected.code, 0);
  assert.match(unexpected.stderr, /unknown subcommand "stray"/);
});
