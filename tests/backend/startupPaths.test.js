import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
function fixture(container = false) {
  const folder = mkdtempSync(join(tmpdir(), 'prax startup space '));
  const sources = container
    ? [...readFileSync(join(root, 'deploy/Dockerfile'), 'utf8').matchAll(/^COPY --chown=node:node (\S+) (\S+)$/gm)].map(m => [m[1], m[2]])
    : ['server', 'mcp', 'public', 'package.json'].map(name => [name, name]);
  for (const [source, destination] of sources) {
    const target = destination === './' ? join(folder, source) : resolve(folder, destination);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(root, source), target, { recursive: true });
  }
  symlinkSync(join(root, 'node_modules'), join(folder, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  return folder;
}
async function checkLaunch(folder, entry = join(folder, 'server/index.js')) {
  const child = spawn(process.execPath, [entry], {
    cwd: folder, env: { ...process.env, PRAX_DB_FILE: ':memory:', HOST: '127.0.0.1', PORT: '0', EMBEDDING_BACKEND: 'none', CHAT_BACKEND: 'none', PRAX_DESKTOP_CONTROL: 'stdio' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  const exited = new Promise(resolve => child.once('exit', resolve));
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No readiness announcement: ${output}`)), 8000);
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Exited ${code} before readiness: ${output}`)); });
      for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
        output += data;
        const match = output.match(/PRAX_DESKTOP_READY \{"port":(\d+)\}/);
        if (match) { clearTimeout(timer); resolve(Number(match[1])); }
      });
    });
    for (const path of ['/healthz', '/', '/js/main.js']) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(5000), headers: { connection: 'close' } });
      await response.text();
      assert.equal(response.status, 200, `${path} must work from the launched layout`);
    }
  } finally {
    child.stdin.end('shutdown\n');
    const forceStop = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(forceStop);
  }
}

test('server serves its UI from an installation path containing spaces', async () => {
  const folder = fixture();
  try { await checkLaunch(folder); } finally { rmSync(folder, { recursive: true, force: true }); }
});
test('server starts through a symlinked installation directory', async () => {
  const folder = fixture();
  const parent = mkdtempSync(join(tmpdir(), 'prax-entry-'));
  const link = join(parent, 'linked');
  symlinkSync(folder, link, process.platform === 'win32' ? 'junction' : 'dir');
  try { await checkLaunch(folder, join(link, 'server/index.js')); }
  finally { rmSync(parent, { recursive: true, force: true }); rmSync(folder, { recursive: true, force: true }); }
});
test('Dockerfile copied application paths contain the complete runtime import graph', async () => {
  const folder = fixture(true);
  try { await checkLaunch(folder); } finally { rmSync(folder, { recursive: true, force: true }); }
});
