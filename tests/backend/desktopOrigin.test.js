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
  return { ready, async stop() { child.stdin.end('shutdown\n'); await closed; } };
}

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
