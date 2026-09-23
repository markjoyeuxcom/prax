// The committed prax-remember bundle always names the project it wrote to
// (review 2026-09-22), including the memory project it defaults to. Run
// against a real app on an in-memory database on a random loopback port.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDb } from '../../server/db.js';
import { runMigrations } from '../../server/migrate.js';
import { buildApp } from '../../server/index.js';

const SCRIPT = fileURLToPath(new URL('../../skills/prax-remember/scripts/remember.mjs', import.meta.url));
const SILENT = { info() {}, error() {}, warn() {} };

function remember(args, url) {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8', env: { ...process.env, PRAX_API_URL: url, PRAX_AGENT: 'codex' },
    }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
  });
}

test('the remember skill names the project on every write', async () => {
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT });
  const app = await buildApp({ db });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const memory = await remember(['Shell quoting', 'Quote every expansion.'], url);
    assert.equal(memory.code, 0, memory.stderr);
    assert.match(memory.stdout, /^Remembered "Shell quoting" → [0-9a-f-]{36} \(created in memory, as codex\) at http:\/\/127\.0\.0\.1:\d+\n$/);
    const project = await remember(['Deploy order', 'Database first.', '--project', 'ops'], url);
    assert.equal(project.code, 0, project.stderr);
    assert.match(project.stdout, /\(created in ops, as codex\)/);
  } finally {
    await app.close();
  }
});
