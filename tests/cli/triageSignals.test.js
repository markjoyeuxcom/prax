// `prax triage` interrupts (the Prax Library document "Prax design: triage TUI",
// "Errors and interrupts"): the editor draft is cleaned up on abandonment,
// kept (and named) when a hangup or termination may have cut off typing, the
// signal handlers are gone once the editor returns, and the terminal leaves
// raw mode whatever ends the session.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { editInEditor, triage } from '../../cli/lib/triage.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIGNALS = ['SIGINT', 'SIGHUP', 'SIGTERM'];
const listeners = (proc) => SIGNALS.map((s) => proc.listenerCount(s));

// A fake process (signals only) and a fake editor child. `onSpawn(file,
// child)` plays the editor; `child.kill(sig)` ends it by that signal.
function fakeProcess() {
  const proc = new EventEmitter();
  proc.exits = [];
  proc.exit = (code) => { proc.exits.push(code); };
  return proc;
}

function fakeSpawn(onSpawn) {
  const spawned = [];
  const spawnFn = (command, args) => {
    const child = new EventEmitter();
    child.killed = [];
    child.kill = (signal) => { child.killed.push(signal); setImmediate(() => child.emit('exit', null, signal)); return true; };
    const file = args[3];
    spawned.push({ child, file });
    setImmediate(() => onSpawn(file, child));
    return child;
  };
  return { spawnFn, spawned };
}

const tick = () => new Promise((resolve) => { setImmediate(resolve); });

test('a saved edit returns the text; the signal handlers exist only while the editor runs', async () => {
  const proc = fakeProcess();
  let during;
  const { spawnFn, spawned } = fakeSpawn((file, child) => {
    during = listeners(proc);
    writeFileSync(file, 'Edited');
    child.emit('exit', 0, null);
  });
  const draft = await editInEditor('Original', { env: { VISUAL: 'ed' }, spawn: spawnFn, platform: 'linux', proc });
  assert.deepEqual(during, [1, 1, 1], 'SIGINT is ignored and SIGHUP / SIGTERM are handled while the editor runs');
  assert.deepEqual(listeners(proc), [0, 0, 0], 'the handlers are removed after the editor returns');
  assert.equal(draft.text, 'Edited');
  assert.equal(draft.file, spawned[0].file);
  assert.equal((readdirSync(dirname(draft.file))).length, 1);
  draft.cleanup();
  assert.equal(existsSync(dirname(draft.file)), false);
});

test('SIGHUP mid-edit keeps a changed draft, names it, and stops triage with status 129', async () => {
  const proc = fakeProcess();
  const { spawnFn, spawned } = fakeSpawn((file) => {
    writeFileSync(file, 'Half-typed paragraph');
    proc.emit('SIGHUP');
  });
  await assert.rejects(
    editInEditor('Original', { spawn: spawnFn, platform: 'linux', proc }),
    (err) => {
      assert.equal(err.signal, 'SIGHUP');
      assert.equal(err.exitCode, 129);
      assert.equal(err.draft, spawned[0].file);
      assert.match(err.message, /triage stopped by SIGHUP while the editor was open; your draft is kept at .*document\.md/);
      return true;
    },
  );
  assert.deepEqual(spawned[0].child.killed, ['SIGHUP'], 'the signal is passed to the editor');
  assert.equal(readFileSync(spawned[0].file, 'utf8'), 'Half-typed paragraph');
  assert.deepEqual(listeners(proc), [0, 0, 0]);
  rmSync(dirname(spawned[0].file), { recursive: true, force: true });
});

test('SIGTERM mid-edit removes an unchanged draft, but keeps a directory holding the editor\'s swap file', async () => {
  const proc = fakeProcess();
  const { spawnFn, spawned } = fakeSpawn(() => { proc.emit('SIGTERM'); });
  await assert.rejects(editInEditor('Original', { spawn: spawnFn, platform: 'linux', proc }), (err) => {
    assert.equal(err.exitCode, 143);
    assert.equal(err.draft, null);
    assert.match(err.message, /the unchanged draft was removed/);
    return true;
  });
  assert.equal(existsSync(dirname(spawned[0].file)), false, 'nothing is left in the temporary directory');

  const swapped = fakeSpawn((file) => {
    writeFileSync(join(dirname(file), '.document.md.swp'), 'unsaved buffer');
    proc.emit('SIGTERM');
  });
  await assert.rejects(editInEditor('Original', { spawn: swapped.spawnFn, platform: 'linux', proc }), (err) => {
    assert.equal(err.draft, dirname(swapped.spawned[0].file));
    assert.match(err.message, /your draft is kept at /);
    return true;
  });
  assert.ok(existsSync(join(dirname(swapped.spawned[0].file), '.document.md.swp')));
  rmSync(dirname(swapped.spawned[0].file), { recursive: true, force: true });
  assert.deepEqual(listeners(proc), [0, 0, 0]);
});

test('SIGINT belongs to the editor: triage ignores it and the edit goes on', async () => {
  const proc = fakeProcess();
  const { spawnFn, spawned } = fakeSpawn(async (file, child) => {
    proc.emit('SIGINT');
    await tick();
    writeFileSync(file, 'Still editing');
    child.emit('exit', 0, null);
  });
  const draft = await editInEditor('Original', { spawn: spawnFn, platform: 'linux', proc });
  assert.deepEqual(spawned[0].child.killed, []);
  assert.equal(draft.text, 'Still editing');
  draft.cleanup();
});

test('abandoning the editor removes the draft; an editor killed by a hangup keeps changed text', async () => {
  const proc = fakeProcess();
  for (const [exit, pattern] of [[[1, null], /ed exited with status 1/], [[null, 'SIGINT'], /ed was stopped by SIGINT/]]) {
    const { spawnFn, spawned } = fakeSpawn((file, child) => { writeFileSync(file, 'typed then abandoned'); child.emit('exit', ...exit); });
    const result = await editInEditor('Original', { env: { EDITOR: 'ed' }, spawn: spawnFn, platform: 'linux', proc });
    assert.match(result.cancelled, pattern);
    assert.equal(existsSync(dirname(spawned[0].file)), false, 'an abandoned draft is removed');
  }

  const hung = fakeSpawn((file, child) => { writeFileSync(file, 'typed'); child.emit('exit', null, 'SIGHUP'); });
  const kept = await editInEditor('Original', { env: { EDITOR: 'ed' }, spawn: hung.spawnFn, platform: 'linux', proc });
  assert.match(kept.cancelled, /ed was stopped by SIGHUP; your draft is kept at .*document\.md/);
  assert.equal(readFileSync(hung.spawned[0].file, 'utf8'), 'typed');
  rmSync(dirname(hung.spawned[0].file), { recursive: true, force: true });

  const idle = fakeSpawn((file, child) => { child.emit('exit', null, 'SIGTERM'); });
  const removed = await editInEditor('Original', { env: { EDITOR: 'ed' }, spawn: idle.spawnFn, platform: 'linux', proc });
  assert.equal(removed.cancelled, 'ed was stopped by SIGTERM');
  assert.equal(existsSync(dirname(idle.spawned[0].file)), false);
  assert.deepEqual(listeners(proc), [0, 0, 0]);
});

// A real editor process and a real signal: `prax triage`'s launcher in a child
// Node process whose editor writes the draft (or not) and then sleeps.
function launch(editor, tmp) {
  const script = `
    import { editInEditor } from ${JSON.stringify(join(root, 'cli', 'lib', 'triage.js'))};
    editInEditor('Original', { env: { VISUAL: ${JSON.stringify(editor)} } }).then(
      () => process.exit(0),
      (err) => { process.stderr.write(err.message); process.exit(err.exitCode ?? 1); },
    );`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, TMPDIR: tmp }, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const done = new Promise((resolve) => { child.on('exit', (code, signal) => resolve({ code, signal, stderr })); });
  return { child, done };
}

async function waitFor(predicate, ms = 10000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => { setTimeout(resolve, 20); });
  }
  throw new Error('timed out');
}

const draftDirs = (tmp) => readdirSync(tmp).filter((name) => name.startsWith('prax-triage-')).map((name) => join(tmp, name));

test('real signals: SIGTERM keeps a changed draft and exits 143; SIGHUP on an untouched draft removes it and exits 129', { skip: process.platform === 'win32' }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'prax-triage-signals-'));
  try {
    const typed = launch('f() { printf changed > "$1"; exec sleep 30; }; f', tmp);
    const file = await waitFor(() => draftDirs(tmp).map((d) => join(d, 'document.md'))
      .find((f) => existsSync(f) && readFileSync(f, 'utf8') === 'changed'));
    typed.child.kill('SIGTERM');
    const first = await typed.done;
    assert.equal(first.code, 143, first.stderr);
    assert.match(first.stderr, new RegExp(`your draft is kept at ${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.equal(readFileSync(file, 'utf8'), 'changed');
    rmSync(dirname(file), { recursive: true, force: true });

    const untouched = launch('f() { exec sleep 30; }; f', tmp);
    const dir = await waitFor(() => draftDirs(tmp)[0]);
    await waitFor(() => existsSync(join(dir, 'document.md')));
    untouched.child.kill('SIGHUP');
    const second = await untouched.done;
    assert.equal(second.code, 129, second.stderr);
    assert.match(second.stderr, /the unchanged draft was removed/);
    assert.deepEqual(draftDirs(tmp), [], 'no draft is orphaned');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The entry point: raw mode is restored whatever ends the session.
// ---------------------------------------------------------------------------

function tty() {
  const input = new PassThrough();
  input.isTTY = true;
  input.rawModes = [];
  input.setRawMode = (on) => { input.rawModes.push(on); return input; };
  const output = { isTTY: true, columns: 80, text: '', write(s) { this.text += s; return true; } };
  return { input, output };
}

const doc = {
  id: '11111111-1111-4111-8111-111111111111', title: 'Agent note', body: 'Body.', documentType: 'note', projectId: 'p1',
  tags: [], kind: 'source', updatedBy: 'agent', updatedByAgent: 'claude', verified: false, status: 'active', archivedAt: null,
  updatedAt: '2026-09-21T10:00:00.000Z', revision: 'a'.repeat(64), contentHash: 'b'.repeat(64),
};

function client(overrides = {}) {
  return {
    base: 'http://fake',
    listProjects: async () => [],
    listDocuments: async () => [{ ...doc }],
    getDocument: async () => ({ ...doc }),
    listCodeRefs: async () => [],
    similarDocuments: async () => ({ items: [], degraded: false }),
    ...overrides,
  };
}

test('an uncaught error restores raw mode, detaches from the input and removes the signal handlers', async () => {
  for (const [name, options] of [
    ['a failing request', { client: client({ listDocuments: async () => { throw new TypeError('boom'); } }) }],
    ['a failing editor', { client: client(), edit: async () => { throw new RangeError('editor crashed'); }, keys: 'e' }],
  ]) {
    const proc = fakeProcess();
    const { input, output } = tty();
    if (options.keys) input.write(options.keys);
    await assert.rejects(triage({ input, output, env: {}, as: 'Mark', proc, ...options }), /boom|editor crashed/, name);
    assert.equal(input.rawModes[0], true, name);
    assert.equal(input.rawModes.at(-1), false, `${name}: raw mode is off`);
    assert.equal(input.listenerCount('data'), 0, `${name}: no longer reading keys`);
    assert.deepEqual([...listeners(proc), proc.listenerCount('exit')], [0, 0, 0, 0], `${name}: handlers removed`);
    assert.equal(output.text.includes('\x1b'), false, `${name}: no cursor or screen escape was ever written`);
  }
});

test('SIGTERM outside the editor restores the terminal and exits 143, naming a draft whose save is in flight', async () => {
  const proc = fakeProcess();
  const stderr = { text: '', write(s) { this.text += s; } };
  const { input, output } = tty();
  let saving = false;
  // The save never answers: the fake process's exit() returns, so the session
  // is left pending, as a real exit would leave it.
  triage({
    input, output, env: {}, as: 'Mark', proc, errorOutput: stderr,
    client: client({ updateBody: () => { saving = true; return new Promise(() => {}); } }),
    edit: async () => ({ text: 'Typed by a person', file: '/tmp/prax-triage-x/document.md', cleanup() {} }),
  });
  input.write('e');
  await waitFor(() => saving);
  proc.emit('SIGTERM');
  assert.deepEqual(proc.exits, [143]);
  assert.equal(input.rawModes.at(-1), false, 'raw mode is restored before exiting');
  assert.equal(input.listenerCount('data'), 0);
  assert.match(stderr.text, /prax: triage stopped by SIGTERM\. The save in flight may not have finished; your draft is kept at \/tmp\/prax-triage-x\/document\.md\./);
  assert.match(output.text, /v verify as Mark/);
});

test('while the editor owns the terminal, the session leaves signals to it', async () => {
  const proc = fakeProcess();
  const { input, output } = tty();
  let finishEdit;
  const session = triage({
    input, output, env: {}, as: 'Mark', proc, client: client(),
    edit: () => new Promise((resolve) => { finishEdit = resolve; }),
  });
  input.write('e');
  await waitFor(() => finishEdit);
  proc.emit('SIGTERM');
  proc.emit('SIGHUP');
  assert.deepEqual(proc.exits, [], 'the editor launcher decides');
  finishEdit({ cancelled: 'done' });
  input.end();
  const result = await session;
  assert.equal(result.quit, true);
  assert.equal(input.rawModes.at(-1), false);
  assert.deepEqual(listeners(proc), [0, 0, 0]);
});
