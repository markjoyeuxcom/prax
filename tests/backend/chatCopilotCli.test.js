import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCopilotArgs,
  createCopilotCliChat,
  parseCopilotResult,
  resolveCopilotBinary,
  serializeCopilotPrompt,
} from '../../server/chat/copilotCli.js';
import { createChatProvider } from '../../server/chatProvider.js';
import { buildApp } from '../../server/index.js';

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { written: '', write(chunk) { this.written += chunk; }, end() { child.stdinEnded = true; } };
  child.kill = () => { child.killed = true; };
  return child;
}

function fakeSpawn(script) {
  const calls = [];
  const spawn = (binary, args, options) => {
    const child = fakeChild();
    calls.push({ binary, args, options, child });
    queueMicrotask(() => script(child, calls.length));
    return child;
  };
  spawn.calls = calls;
  return spawn;
}

test('serializeCopilotPrompt preserves the system prompt and conversation labels', () => {
  assert.equal(
    serializeCopilotPrompt([
      { role: 'system', content: 'Use the supplied evidence.' },
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Reply' },
      { role: 'user', content: 'Second' },
    ]),
    'System instructions:\nUse the supplied evidence.\n\nConversation:\nUser: First\n\nAssistant: Reply\n\nUser: Second\n\nAnswer directly as plain text. Do not use any tools.',
  );
});

test('buildCopilotArgs pins answer-only mode and the deny-over-allow tool fence', () => {
  const args = buildCopilotArgs({ model: 'auto', prompt: 'hello' });
  // The whole prompt goes to stdin. --prompt must not be sent: with it set,
  // Copilot ignores stdin and answers that it saw no request (found live).
  assert.ok(!args.includes('--prompt') && !args.includes('-p'), 'no --prompt, or stdin is ignored');
  assert.deepEqual(args.slice(0, 7), [
    '--silent', '--output-format', 'text', '--stream', 'off', '--model', 'auto',
  ]);
  assert.ok(!args.includes('hello'), 'no caller text in argv');
  assert.ok(args.includes('--available-tools=fetch_copilot_cli_documentation'));
  assert.ok(args.includes('--deny-tool=fetch_copilot_cli_documentation'));
  for (const flag of [
    '--disable-builtin-mcps', '--no-custom-instructions', '--no-remote',
    '--no-remote-export', '--no-auto-update', '--no-ask-user', '--disallow-temp-dir',
  ]) assert.ok(args.includes(flag), `${flag} must be present`);
});

test('parseCopilotResult returns text and surfaces useful CLI errors', () => {
  assert.equal(parseCopilotResult('  Hello from Copilot\n').text, 'Hello from Copilot');
  assert.throws(() => parseCopilotResult('', 'Please run copilot login', 1), /copilot login/);
  assert.throws(() => parseCopilotResult('stdout details', '', 2), /stdout details/);
  assert.throws(() => parseCopilotResult('', '', 3), /exited with code 3/);
  assert.throws(() => parseCopilotResult('   ', '', 0), /returned no text/);
});

test('resolveCopilotBinary: explicit path wins or fails loudly; PATH and known homes searched', () => {
  const present = new Set(['/custom/copilot', '/pathdir/copilot', '/opt/homebrew/bin/copilot']);
  const exists = (path) => present.has(path);
  assert.equal(resolveCopilotBinary({ binaryPath: '/custom/copilot', exists }), '/custom/copilot');
  assert.equal(resolveCopilotBinary({ binaryPath: '/wrong/copilot', exists }), null);
  assert.equal(resolveCopilotBinary({ env: { PATH: '/nowhere:/pathdir' }, exists }), '/pathdir/copilot');
  assert.equal(resolveCopilotBinary({ env: { PATH: '/nowhere', HOME: '/h' }, exists }), '/opt/homebrew/bin/copilot');
  assert.equal(resolveCopilotBinary({ env: { PATH: '', HOME: '/h' }, exists: () => false }), null);
});

test('complete runs a fenced completion in the empty scratch directory', async () => {
  const spawn = fakeSpawn((child) => {
    child.stdout.emit('data', 'Hello from Copilot\n');
    child.emit('close', 0);
  });
  const chat = createCopilotCliChat({ binaryPath: '/bin/copilot', exists: () => true, spawn, scratchDir: '/tmp/empty' });
  assert.equal(chat.backend, 'copilot-cli');
  assert.equal(chat.supportsTools, false);
  const out = await chat.complete([
    { role: 'system', content: 'Be terse.' },
    { role: 'user', content: 'Summarize the week' },
  ]);
  assert.equal(out.text, 'Hello from Copilot');
  const call = spawn.calls[0];
  assert.equal(call.binary, '/bin/copilot');
  assert.ok(call.args.includes('--available-tools=fetch_copilot_cli_documentation'));
  assert.ok(call.args.includes('--deny-tool=fetch_copilot_cli_documentation'));
  // Prompts (with Library bodies) are piped over stdin, never visible in ps.
  assert.match(call.child.stdin.written, /System instructions:\nBe terse\./);
  assert.match(call.child.stdin.written, /Summarize the week/);
  assert.ok(!call.args.some((arg) => arg.includes('Be terse') || arg.includes('Summarize the week')), 'no prompt text in argv');
  assert.equal(call.options.cwd, '/tmp/empty');
  assert.equal(out.truncated, false);
});

test('complete: a 70 KB prompt to a CLI that exits immediately is a clean error, not a crash', { skip: process.platform === 'win32' }, async () => {
  const falseBinary = ['/usr/bin/false', '/bin/false'].find((path) => { try { return statSync(path).isFile(); } catch { return false; } });
  if (!falseBinary) return;
  const scratch = mkdtempSync(join(tmpdir(), 'prax-epipe-'));
  try {
    const chat = createCopilotCliChat({ binaryPath: falseBinary, scratchDir: scratch, timeoutMs: 10_000 });
    await assert.rejects(chat.complete('x'.repeat(70 * 1024)), /exited with code 1/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('complete surfaces failures, times out, refuses tools, and serializes spawns', async () => {
  const failingSpawn = fakeSpawn((child) => {
    child.stderr.emit('data', 'Authentication required. Run copilot login.');
    child.emit('close', 1);
  });
  const failing = createCopilotCliChat({ binaryPath: '/bin/copilot', exists: () => true, spawn: failingSpawn });
  await assert.rejects(failing.complete('hello'), /copilot login/);

  const missing = createCopilotCliChat({ binaryPath: '/gone/copilot', exists: () => false, spawn: failingSpawn });
  await assert.rejects(missing.complete('hello'), /not found \(looked at \/gone\/copilot\)/);

  const hungSpawn = fakeSpawn(() => {});
  const hung = createCopilotCliChat({ binaryPath: '/bin/copilot', exists: () => true, spawn: hungSpawn, timeoutMs: 30 });
  await assert.rejects(hung.complete('hello'), /timed out/);
  assert.equal(hungSpawn.calls[0].child.killed, true);
  await assert.rejects(hung.complete('hello', { tools: [{ name: 'x' }] }), /does not support tool calling/);

  const order = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const queuedSpawn = fakeSpawn(async (child, n) => {
    order.push(`start${n}`);
    if (n === 1) await gate;
    child.stdout.emit('data', 'ok');
    child.emit('close', 0);
    order.push(`end${n}`);
  });
  const queued = createCopilotCliChat({ binaryPath: '/bin/copilot', exists: () => true, spawn: queuedSpawn });
  const first = queued.complete('one');
  const second = queued.complete('two');
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['start1', 'end1', 'start2', 'end2']);
});

test('isAvailable probes --version only', async () => {
  const spawn = fakeSpawn((child) => {
    child.stdout.emit('data', 'GitHub Copilot CLI');
    child.emit('close', 0);
  });
  const chat = createCopilotCliChat({ binaryPath: '/bin/copilot', exists: () => true, spawn });
  assert.equal(await chat.isAvailable(), true);
  assert.deepEqual(spawn.calls[0].args, ['--version']);
});

test('chatProvider round-trips copilot-cli settings as a keyless backend', async () => {
  const store = new Map();
  const repo = {
    async getSetting(key, fallback) { return store.has(key) ? store.get(key) : fallback; },
    async putSetting(key, value) { store.set(key, value); },
  };
  const provider = createChatProvider({ appSettingsRepository: repo, config: {} });
  const saved = await provider.putSettings({ backend: 'copilot-cli', model: 'auto', binaryPath: '  /opt/homebrew/bin/copilot  ' });
  assert.equal(saved.backend, 'copilot-cli');
  assert.equal(saved.model, 'auto');
  assert.equal(saved.binaryPath, '/opt/homebrew/bin/copilot');
  assert.equal(saved.keyRequired, false);
  const chat = await provider.getChat();
  assert.equal(chat.backend, 'copilot-cli');
  assert.equal(chat.supportsTools, false);
});

test('the ai-answers route accepts a copilot-cli configuration and reports honest status', async () => {
  const { loadConfig } = await import('../../server/config.js');
  const config = loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' });
  const app = await buildApp({ config });
  const put = await app.inject({
    method: 'PUT',
    url: '/api/settings/ai-answers',
    payload: { backend: 'copilot-cli', model: 'auto', binaryPath: '/definitely/not/here/copilot' },
  });
  assert.equal(put.statusCode, 200);
  const status = put.json();
  assert.equal(status.backend, 'copilot-cli');
  assert.equal(status.binaryPath, '/definitely/not/here/copilot');
  assert.equal(status.keyRequired, false);
  assert.equal(status.connected, false);
  await app.close();
});
