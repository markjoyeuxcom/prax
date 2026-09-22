import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('buildCliArgs pins the safety fence: json output, no tools, no user settings, turn ceiling, no-tools prompt', () => {
  const bare = buildCliArgs({ model: 'haiku' });
  assert.deepEqual(bare.slice(0, 7), ['-p', '--output-format', 'json', '--model', 'haiku', '--max-turns', '4']);
  // The primary fence: every built-in tool disabled, whatever this CLI version
  // ships (a deny-list of names always misses newly added tools).
  assert.equal(bare[bare.indexOf('--tools') + 1], '');
  // The user's own settings (default mode, allow rules, hooks) never apply to
  // a run that carries untrusted Library text; nothing prompts or auto-approves.
  assert.equal(bare[bare.indexOf('--setting-sources') + 1], '');
  assert.equal(bare[bare.indexOf('--permission-mode') + 1], 'dontAsk');
  const mcp = bare.indexOf('--strict-mcp-config');
  assert.deepEqual(bare.slice(mcp, mcp + 3), ['--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}']);
  // The deny-list stays as a second fence for CLIs that predate --tools.
  const denied = bare[bare.indexOf('--disallowedTools') + 1];
  for (const tool of ['Task', 'Agent', 'Bash', 'PowerShell', 'REPL', 'Monitor', 'LSP', 'Read', 'Write', 'WebSearch', 'TodoWrite', 'Skill', 'ToolSearch', 'CronCreate', 'SendMessage', 'EnterWorktree']) {
    assert.ok(denied.split(',').includes(tool), `${tool} must be denied`);
  }
  assert.deepEqual(bare.slice(-2), ['--append-system-prompt', 'Answer directly as plain text. Do not use any tools.']);
  // Nothing caller-supplied reaches argv: a system prompt is not an argument.
  assert.deepEqual(buildCliArgs({ model: 'haiku', system: 'Be terse. SNAPSHOT' }), bare);
});

test('parseCliResult: success text, CLI errors verbatim, garbage flagged with a hint', () => {
  assert.equal(parseCliResult(RESULT_OK).text, 'Hello from the CLI');
  assert.throws(
    () => parseCliResult(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Please run /login' })),
    /Please run \/login/,
  );
  assert.throws(() => parseCliResult('not json at all', 'boom from stderr'), /unparseable output: boom from stderr/);
  assert.throws(() => parseCliResult(JSON.stringify({ type: 'result', subtype: 'success' })), /returned no text/);
  // Non-zero exit + no envelope → the stderr/stdout hint or the bare code.
  assert.throws(() => parseCliResult('', 'stderr words', 1), /^Error: stderr words$/);
  assert.throws(() => parseCliResult('', '', 1), /exited with code 1/);
  // A text-less error_max_turns gets a sentence, not a bare subtype.
  assert.throws(
    () => parseCliResult(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: false })),
    /turn limit before returning text/,
  );
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
  assert.ok(call.args.includes('--disallowedTools'), 'built-in tools are denied');
  assert.deepEqual(call.args.slice(-2), ['--append-system-prompt', 'Answer directly as plain text. Do not use any tools.']);
  // The system prompt (which can carry a workspace snapshot) rides on stdin.
  assert.equal(call.child.stdin.written, 'System instructions:\nBe terse.\n\nConversation:\nSummarize the week');
  assert.ok(!call.args.some((arg) => arg.includes('Be terse') || arg.includes('Summarize the week')), 'no prompt text in argv');
  assert.equal(call.options.cwd, '/tmp', 'runs in the empty scratch dir, never the user data dir');
});

test('complete: a system prompt with a workspace snapshot never appears in child argv', async () => {
  const spawn = fakeSpawn((child) => {
    child.stdout.emit('data', RESULT_OK);
    child.emit('close', 0);
  });
  const chat = createClaudeCliChat({ binaryPath: '/bin/claude', exists: () => true, spawn, scratchDir: '/tmp' });
  const snapshot = `Workspace snapshot:\n${'- Secret runbook step\n'.repeat(2000)}`;
  await chat.complete([{ role: 'system', content: snapshot }, { role: 'user', content: 'What is due?' }]);
  const call = spawn.calls[0];
  assert.ok(!call.args.some((arg) => arg.includes('Secret runbook step')), 'the snapshot is not in argv');
  assert.ok(call.args.every((arg) => arg.length < 1000), 'every argument is a short constant');
  assert.match(call.child.stdin.written, /Secret runbook step/);
  assert.match(call.child.stdin.written, /Conversation:\nWhat is due\?$/);
});

test('complete: an envelope that reports stop_reason max_tokens is marked truncated', async () => {
  const spawn = fakeSpawn((child) => {
    child.stdout.emit('data', JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Partial answ', stop_reason: 'max_tokens' }));
    child.emit('close', 0);
  });
  const chat = createClaudeCliChat({ binaryPath: '/bin/claude', exists: () => true, spawn, scratchDir: '/tmp' });
  const out = await chat.complete('hello');
  assert.equal(out.truncated, true);
  assert.equal(out.finishReason, 'max_tokens');
  const okSpawn = fakeSpawn((child) => { child.stdout.emit('data', RESULT_OK); child.emit('close', 0); });
  const complete = await createClaudeCliChat({ binaryPath: '/bin/claude', exists: () => true, spawn: okSpawn, scratchDir: '/tmp' }).complete('hello');
  assert.equal(complete.truncated, false);
});

// Regression: a real child that exits before reading a prompt larger than the
// pipe buffer made the stdin write fail with EPIPE; with no 'error' listener
// that crashed the whole server (and the desktop sidecar).
test('complete: a 70 KB prompt to a CLI that exits immediately is a clean error, not a crash', { skip: process.platform === 'win32' }, async () => {
  const falseBinary = ['/usr/bin/false', '/bin/false'].find((path) => { try { return statSync(path).isFile(); } catch { return false; } });
  if (!falseBinary) return;
  const scratch = mkdtempSync(join(tmpdir(), 'prax-epipe-'));
  try {
    const chat = createClaudeCliChat({ binaryPath: falseBinary, scratchDir: scratch, timeoutMs: 10_000 });
    await assert.rejects(chat.complete('x'.repeat(70 * 1024)), /exited with code 1/);
    // The process is still alive and the provider still usable afterwards.
    await assert.rejects(chat.complete([{ role: 'system', content: 'y'.repeat(70 * 1024) }, { role: 'user', content: 'again' }]), /exited with code 1/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('without an injected scratch dir, the CLI runs in a fresh private temp directory', async () => {
  const spawn = fakeSpawn((child) => {
    child.stdout.emit('data', RESULT_OK);
    child.emit('close', 0);
  });
  const chat = createClaudeCliChat({ binaryPath: '/bin/claude', exists: () => true, spawn });
  await chat.complete([{ role: 'user', content: 'hi' }]);
  await chat.complete([{ role: 'user', content: 'again' }]);
  const [first, second] = spawn.calls.map((c) => c.options.cwd);
  // Not a fixed, guessable name: the CLI reads hooks and instructions from its
  // cwd, and a predictable path in the shared temp dir is a plant-a-hook
  // opportunity for another local user.
  assert.ok(first.startsWith(join(tmpdir(), 'prax-claude-cli-')), first);
  assert.notEqual(first, join(tmpdir(), 'prax-claude-cli'));
  assert.equal(second, first, 'one private directory per chat instance');
  const mode = statSync(first).mode & 0o777;
  if (process.platform !== 'win32') assert.equal(mode, 0o700, 'private to this user');
  rmSync(first, { recursive: true, force: true });
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

test('a non-zero exit with a result envelope surfaces the CLI words, never raw JSON (login regression)', async () => {
  // The real CLI reports "not logged in" as an envelope on stdout WITH exit
  // code 1 — the field-observed shape: subtype "success" yet is_error true.
  const envelope = JSON.stringify({
    type: 'result', subtype: 'success', is_error: true, api_error_status: null,
    num_turns: 1, result: 'Not logged in · Please run /login', total_cost_usd: 0,
  });
  const spawn = fakeSpawn((child) => {
    child.stdout.emit('data', envelope);
    child.emit('close', 1);
  });
  const chat = createClaudeCliChat({ binaryPath: '/bin/claude', exists: () => true, spawn });
  await assert.rejects(chat.complete('hello'), (err) => {
    assert.equal(err.message, 'Not logged in · Please run /login');
    return true;
  });
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
