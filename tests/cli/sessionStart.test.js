// `prax session-start --hook <vendor>` (docs/design/session-start-recall.md):
// the SessionStart hook prints one briefing in the vendor's envelope, advances
// the agent's delta marker exactly as `recall --since-last-session` does, and
// fails open on everything. The end-to-end tests run the real CLI against a
// real app on an in-memory database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';
import { envelope, composeBriefing, CLOSING_LINES } from '../../cli/lib/sessionStart.js';

const CLI = fileURLToPath(new URL('../../cli/prax.js', import.meta.url));
const app = await buildApp({ config: loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' }) });
await app.listen({ port: 0, host: '127.0.0.1' });
const url = `http://127.0.0.1:${app.server.address().port}`;
test.after(() => app.close());

async function api(method, path, payload) {
  const res = await app.inject({ method, url: path, ...(payload ? { payload } : {}) });
  return { status: res.statusCode, body: res.json() };
}

// A working directory that carries the project marker, so the hook's cwd
// (not the test runner's) decides the project.
const work = mkdtempSync(join(tmpdir(), 'prax-session-start-'));
test.after(() => rmSync(work, { recursive: true, force: true }));
mkdirSync(join(work, '.prax'));
writeFileSync(join(work, '.prax', 'project.json'), JSON.stringify({ project: 'sessionlab' }));

const homelab = (await api('POST', '/api/projects', { name: 'sessionlab' })).body;
assert.ok(homelab.id);
const doc = (await api('POST', '/api/library/documents', {
  title: 'Postgres restore runbook', body: '# Postgres restore\n\n1. Stop the app.\n2. Restore the base backup.', project: homelab.id, documentType: 'runbook', tags: ['postgres'],
})).body;
assert.ok(doc.id);
const verified = await api('POST', `/api/library/documents/${doc.id}/verify`, { verified: true, revision: doc.revision, as: 'mark' });
assert.equal(verified.status, 200, JSON.stringify(verified.body));

function hook(args, { input, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [CLI, 'session-start', ...args], {
      encoding: 'utf8', env: { PATH: process.env.PATH, HOME: work, PRAX_API_URL: url, PRAX_AGENT: '', ...env },
    }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
    child.stdin.end(input ?? '');
  });
}

test('the Claude Code hook prints the project briefing and the delta in the hookSpecificOutput envelope', async () => {
  const first = await hook(['--hook', 'claude'], { input: JSON.stringify({ session_id: 's1', hook_event_name: 'SessionStart', source: 'startup', cwd: work }) });
  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.stderr, '');
  const parsed = JSON.parse(first.stdout);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'SessionStart');
  const text = parsed.hookSpecificOutput.additionalContext;
  assert.match(text, /^# Prax memory at session start — project sessionlab \(claude\)/);
  assert.match(text, /Postgres restore runbook/, 'the verified runbook is in the context pack');
  assert.match(text, /## Since your last session/);
  assert.match(text, /No earlier delta recorded for agent "claude"/, 'the first run sets the baseline');
  for (const line of CLOSING_LINES) assert.ok(text.includes(line), `closing line present: ${line}`);
  assert.ok(text.length < 10000, 'under Claude Code\'s 10,000-character cap');

  // The marker advanced: a second session sees a delta window, not a baseline.
  await api('POST', '/api/library/documents', {
    title: 'New since the first session', body: 'A note written between sessions.', project: homelab.id, documentType: 'note',
  });
  const second = await hook(['--hook', 'claude'], { input: JSON.stringify({ session_id: 's2', hook_event_name: 'SessionStart', source: 'resume', cwd: work }) });
  assert.equal(second.code, 0, second.stderr);
  const again = JSON.parse(second.stdout).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(again, /No earlier delta recorded/);
  assert.match(again, /New since the first session/);
});

test('the Copilot envelope carries only additionalContext, and --budget bounds the context pack', async () => {
  const run = await hook(['--hook', 'copilot', '--budget', '150'], { input: JSON.stringify({ sessionId: 's3', source: 'startup', cwd: work }) });
  assert.equal(run.code, 0, run.stderr);
  const parsed = JSON.parse(run.stdout);
  assert.deepEqual(Object.keys(parsed), ['additionalContext']);
  assert.match(parsed.additionalContext, /\(copilot\)/);
  assert.match(parsed.additionalContext, /budget: ~\d+ of 150 tokens/);
});

test('it fails open: Prax unreachable, a deadline, or an unknown vendor', async () => {
  const down = await hook(['--hook', 'codex'], { input: JSON.stringify({ session_id: 's4', hook_event_name: 'SessionStart', cwd: work }), env: { PRAX_API_URL: 'http://127.0.0.1:9' } });
  assert.equal(down.code, 0);
  assert.equal(down.stdout, '');
  assert.equal(down.stderr, '');
  const slow = await hook(['--hook', 'codex'], { input: JSON.stringify({ session_id: 's5', hook_event_name: 'SessionStart', cwd: work }), env: { PRAX_SESSION_START_MS: '1' } });
  assert.equal(slow.code, 0);
  assert.equal(slow.stdout, '', 'a deadline that fires prints nothing rather than a partial block');
  const unknown = await hook(['--hook', 'cursor'], { input: '{}' });
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /needs --hook claude\|codex\|copilot/);
});

test('without a project the briefing is the delta alone, and with nothing to say it prints nothing', async () => {
  const nowhere = mkdtempSync(join(tmpdir(), 'prax-session-nowhere-'));
  try {
    const run = await hook(['--hook', 'claude'], { input: JSON.stringify({ session_id: 's6', hook_event_name: 'SessionStart', cwd: nowhere }), env: { HOME: nowhere } });
    assert.equal(run.code, 0, run.stderr);
    if (run.stdout) {
      const text = JSON.parse(run.stdout).hookSpecificOutput.additionalContext;
      assert.doesNotMatch(text, /— project /, 'a folder name that is no project is not claimed as one');
    }
  } finally {
    rmSync(nowhere, { recursive: true, force: true });
  }
});

test('composeBriefing and envelope are pure', () => {
  const text = composeBriefing({ vendor: 'codex', project: 'p', contextText: 'CTX\n', deltaText: null });
  assert.equal(text.split('\n')[0], '# Prax memory at session start — project p (codex)');
  assert.doesNotMatch(text, /Since your last session/);
  assert.deepEqual(envelope('copilot', 'x'), { additionalContext: 'x' });
  assert.deepEqual(envelope('claude', 'x'), { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'x' } });
});
