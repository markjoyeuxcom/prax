import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../../server/index.js', import.meta.url));
function start(portFile) {
  const child = spawn(process.execPath, [entry], { env: { ...process.env, HOST: '127.0.0.1', PORT: '0', PRAX_DB_FILE: ':memory:', PRAX_DESKTOP_CONTROL: 'stdio', PRAX_DESKTOP_PORT_FILE: portFile, CHAT_BACKEND: 'none', EMBEDDING_BACKEND: 'none' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  const closedStreams = once(child, 'close');
  const closed = once(child, 'exit');
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('readiness timeout')); }, 5000);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`exit ${code}: ${output}`)); });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
      output += data;
      const match = output.match(/PRAX_DESKTOP_READY \{"port":(\d+)\}/);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
  });
  return {
    ready,
    async stop() { child.stdin.end('shutdown\n'); await closed; },
    async output() { await closedStreams; return output; },
  };
}

test('the desktop child logs no line per request, so its session log stays small', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prax-origin-quiet-'));
  const child = start(join(dir, 'webview-port'));
  try {
    const port = await child.ready;
    for (let index = 0; index < 3; index += 1) {
      const response = await fetch(`http://127.0.0.1:${port}/api/library/search?q=private-search-term-${index}`);
      await response.arrayBuffer();
    }
    await child.stop();
    const output = await child.output();
    assert.match(output, /Prax bound to host 127\.0\.0\.1/, 'lifecycle lines are still logged');
    assert.doesNotMatch(output, /incoming request|request completed|private-search-term/);
    assert.doesNotMatch(output, /Deprecation/, 'no deprecated Fastify option is used to get there');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('desktop keeps the bound origin across child restarts and refuses a taken port', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prax-origin-'));
  const file = join(dir, 'webview-port');
  let first, second, collision;
  try {
    first = start(file);
    const port = await first.ready;
    assert.equal(Number(readFileSync(file, 'utf8')), port);
    collision = start(file);
    await assert.rejects(collision.ready, /EADDRINUSE|address already in use/);
    await first.stop(); first = null;
    second = start(file);
    assert.equal(await second.ready, port);
    assert.equal(Number(readFileSync(file, 'utf8')), port);
  } finally {
    if (first) await first.stop();
    if (second) await second.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('a corrupt saved desktop port fails closed without silently changing storage origin', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prax-origin-invalid-'));
  const file = join(dir, 'webview-port');
  writeFileSync(file, 'invalid');
  const child = start(file);
  try { await assert.rejects(child.ready, /saved desktop port/); }
  finally { await child.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test('first upgraded desktop launch recovers its previous origin from the child log', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prax-origin-upgrade-'));
  const file = join(dir, 'webview-port');
  let child = start(file);
  try {
    const port = await child.ready; await child.stop(); child = null;
    rmSync(file); mkdirSync(join(dir,'logs'));
    writeFileSync(join(dir,'logs','server.log.1'), 'PRAX_DESKTOP_READY ' + JSON.stringify({port}) + '\n');
    child = start(file);
    assert.equal(await child.ready, port);
    assert.equal(Number(readFileSync(file,'utf8')), port);
  } finally { if(child) await child.stop(); rmSync(dir,{recursive:true,force:true}); }
});

// Run the desktop child to completion and keep everything it printed.
function runToExit(portFile, { input = null } = {}) {
  const child = spawn(process.execPath, [entry], { env: { ...process.env, HOST: '127.0.0.1', PORT: '0', PRAX_DB_FILE: ':memory:', PRAX_DESKTOP_CONTROL: 'stdio', PRAX_DESKTOP_PORT_FILE: portFile, CHAT_BACKEND: 'none', EMBEDDING_BACKEND: 'none' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  if (input !== null) child.stdin.write(input);
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  return once(child, 'close').then(([code, signal]) => { clearTimeout(timer); return { code, signal, stdout, stderr }; });
}

test('a taken saved port ends the desktop child with one structured port-in-use line', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prax-origin-busy-'));
  const file = join(dir, 'webview-port');
  let owner;
  try {
    owner = start(file);
    const port = await owner.ready;
    const collision = await runToExit(file);
    assert.equal(collision.code, 1);
    assert.equal(collision.stdout.match(/^PRAX_DESKTOP_FAILED .*$/gm)?.join('\n'), `PRAX_DESKTOP_FAILED {"reason":"port-in-use","port":${port}}`);
    assert.doesNotMatch(collision.stdout, /PRAX_DESKTOP_READY/);
    assert.match(collision.stderr, /EADDRINUSE/, 'the stack still reaches the diagnostic log');
  } finally {
    if (owner) await owner.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a desktop quit during startup migrations stops at a migration boundary and exits cleanly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prax-origin-migrating-'));
  try {
    // The request is already waiting on stdin when the first migration
    // boundary yields, so the run stops there instead of being killed later.
    const result = await runToExit(join(dir, 'webview-port'), { input: 'shutdown\n' });
    assert.equal(result.code, 0, result.stderr);
    const progress = result.stdout.match(/^PRAX_DESKTOP_PROGRESS \{"phase":"migrating","index":\d+,"total":(\d+)\}$/gm) || [];
    assert.ok(progress.length >= 1, `progress was reported: ${result.stdout}`);
    const total = Number(progress[0].match(/"total":(\d+)/)[1]);
    assert.ok(progress.length < total, 'the remaining migrations did not run');
    assert.doesNotMatch(result.stdout, /PRAX_DESKTOP_READY|PRAX_DESKTOP_FAILED|"phase":"migrated"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
