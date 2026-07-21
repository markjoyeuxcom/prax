import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  buildCliArgs,
  createClaudeCliChat,
  parseCliResult,
  resolveClaudeBinary,
  serializeTurns,
} from '../../server/chat/claudeCli.js';
import { createChatProvider } from '../../server/chatProvider.js';
import { buildApp } from '../../server/index.js';

// A controllable child process: the test decides stdout/stderr/exit.
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

const RESULT_OK = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Hello from the CLI' });

test('serializeTurns: single user turn passes through; conversations become a labelled transcript', () => {
  assert.equal(serializeTurns([{ role: 'user', content: 'Just this' }]), 'Just this');
  assert.equal(
    serializeTurns([
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Reply' },
      { role: 'user', content: 'Second' },
    ]),
    'User: First\n\nAssistant: Reply\n\nUser: Second',
  );
});

test('buildCliArgs pins the safety fence: json output, max-turns 1, empty MCP, optional system', () => {
  const bare = buildCliArgs({ model: 'haiku' });
  assert.deepEqual(bare, ['-p', '--output-format', 'json', '--model', 'haiku', '--max-turns', '1', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}']);
  const withSystem = buildCliArgs({ model: 'sonnet', system: 'Be terse.' });
  assert.deepEqual(withSystem.slice(-2), ['--append-system-prompt', 'Be terse.']);
});

test('parseCliResult: success text, CLI errors verbatim, garbage flagged with a hint', () => {
  assert.equal(parseCliResult(RESULT_OK).text, 'Hello from the CLI');
  assert.throws(
    () => parseCliResult(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Please run /login' })),
    /Please run \/login/,
  );
  assert.throws(() => parseCliResult('not json at all', 'boom from stderr'), /unparseable output: boom from stderr/);
  assert.throws(() => parseCliResult(JSON.stringify({ type: 'result', subtype: 'success' })), /returned no text/);
});

test('resolveClaudeBinary: explicit path wins or fails loudly; PATH and known homes searched', () => {
  const present = new Set(['/custom/claude', '/pathdir/claude', '/opt/homebrew/bin/claude']);
  const exists = (path) => present.has(path);
  assert.equal(resolveClaudeBinary({ binaryPath: '/custom/claude', exists }), '/custom/claude');
  assert.equal(resolveClaudeBinary({ binaryPath: '/wrong/claude', exists }), null, 'a wrong explicit path is an error, not silently replaced');
  assert.equal(resolveClaudeBinary({ env: { PATH: '/nowhere:/pathdir' }, exists }), '/pathdir/claude');
  assert.equal(resolveClaudeBinary({ env: { PATH: '/nowhere', HOME: '/h' }, exists }), '/opt/homebrew/bin/claude');
  assert.equal(resolveClaudeBinary({ env: { PATH: '', HOME: '/h' }, exists: () => false }), null);
});

test('complete: spawns with the fence, feeds the prompt over stdin, returns the text', async () => {
  const spawn = fakeSpawn((child) => {
    child.stdout.emit('data', RESULT_OK);
    child.emit('close', 0);
  });
  const chat = createClaudeCliChat({ binaryPath: '/bin/claude', exists: () => true, spawn, scratchDir: '/tmp' });
  assert.equal(chat.backend, 'claude-cli');
  assert.equal(chat.supportsTools, false);
  const out = await chat.complete([
    { role: 'system', content: 'Be terse.' },
    { role: 'user', content: 'Summarize the week' },
  ]);
  assert.equal(out.text, 'Hello from the CLI');
  const call = spawn.calls[0];
  assert.equal(call.binary, '/bin/claude');
  assert.ok(call.args.includes('--max-turns'), 'agentic turns are fenced off');
  assert.deepEqual(call.args.slice(-2), ['--append-system-prompt', 'Be terse.']);
  assert.equal(call.child.stdin.written, 'Summarize the week');
  assert.equal(call.options.cwd, '/tmp', 'runs in the empty scratch dir, never the user data dir');
});

test('complete: nonzero exit surfaces the CLI stderr verbatim; missing binary names what it tried', async () => {
  const spawn = fakeSpawn((child) => {
    child.stderr.emit('data', 'Invalid API key · Please run /login');
    child.emit('close', 1);
  });
  const chat = createClaudeCliChat({ binaryPath: '/bin/claude', exists: () => true, spawn });
  await assert.rejects(chat.complete('hello'), /Please run \/login/);

  const missing = createClaudeCliChat({ binaryPath: '/gone/claude', exists: () => false, spawn });
  await assert.rejects(missing.complete('hello'), /not found \(looked at \/gone\/claude\)/);
});

test('complete: a hung CLI is killed at the timeout; tool requests are refused up front', async () => {
  const spawn = fakeSpawn(() => { /* never exits */ });
  const chat = createClaudeCliChat({ binaryPath: '/bin/claude', exists: () => true, spawn, timeoutMs: 30 });
  await assert.rejects(chat.complete('hello'), /timed out/);
  assert.equal(spawn.calls[0].child.killed, true);

  await assert.rejects(
    chat.complete('hello', { tools: [{ name: 'x', description: '', parameters: {} }] }),
    /does not support tool calling/,
  );
});

test('spawns are serialized: a second call waits for the first process to close', async () => {
  const order = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const spawn = fakeSpawn(async (child, n) => {
    order.push(`start${n}`);
    if (n === 1) await gate;
    child.stdout.emit('data', RESULT_OK);
    child.emit('close', 0);
    order.push(`end${n}`);
  });
  const chat = createClaudeCliChat({ binaryPath: '/bin/claude', exists: () => true, spawn });
  const first = chat.complete('one');
  const second = chat.complete('two');
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['start1', 'end1', 'start2', 'end2']);
});

test('isAvailable probes --version only — cheap, offline, quota-free', async () => {
  const spawn = fakeSpawn((child) => {
    child.stdout.emit('data', '2.1.0 (Claude Code)');
    child.emit('close', 0);
  });
  const chat = createClaudeCliChat({ binaryPath: '/bin/claude', exists: () => true, spawn });
  assert.equal(await chat.isAvailable(), true);
  assert.deepEqual(spawn.calls[0].args, ['--version']);
  const gone = createClaudeCliChat({ binaryPath: '/gone', exists: () => false, spawn });
  assert.equal(await gone.isAvailable(), false);
});

// ---- provider + route integration ----

test('chatProvider round-trips claude-cli settings: keyless, binaryPath surfaced, never echoing secrets', async () => {
  const store = new Map();
  const repo = {
    async getSetting(key, fallback) { return store.has(key) ? store.get(key) : fallback; },
    async putSetting(key, value) { store.set(key, value); },
  };
  const provider = createChatProvider({ appSettingsRepository: repo, config: {} });
  const saved = await provider.putSettings({ backend: 'claude-cli', model: 'sonnet', binaryPath: '  /opt/homebrew/bin/claude  ' });
  assert.equal(saved.backend, 'claude-cli');
  assert.equal(saved.model, 'sonnet');
  assert.equal(saved.binaryPath, '/opt/homebrew/bin/claude');
  assert.equal(saved.keyRequired, false, 'the login IS the credential');
  const chat = await provider.getChat();
  assert.equal(chat.backend, 'claude-cli');
  assert.equal(chat.supportsTools, false);
});

test('the ai-answers route accepts a claude-cli configuration and reports honest status', async () => {
  const { loadConfig } = await import('../../server/config.js');
  const config = loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' });
  const app = await buildApp({ config });
  const put = await app.inject({
    method: 'PUT',
    url: '/api/settings/ai-answers',
    payload: { backend: 'claude-cli', model: 'haiku', binaryPath: '/definitely/not/here/claude' },
  });
  assert.equal(put.statusCode, 200);
  const status = put.json();
  assert.equal(status.backend, 'claude-cli');
  assert.equal(status.binaryPath, '/definitely/not/here/claude');
  assert.equal(status.keyRequired, false);
  assert.equal(status.connected, false, 'a missing binary must never read as connected');
  const bad = await app.inject({ method: 'PUT', url: '/api/settings/ai-answers', payload: { backend: 'claude-cli', binaryPath: 42 } });
  assert.equal(bad.statusCode, 400);
  await app.close();
});
