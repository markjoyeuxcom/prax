// `prax task done` on a UTC server rolls a recurring task forward from the
// CALLER's today (review 2026-09-22, a263da8e): the CLI sends its local date
// and IANA zone (server/localDay.js) on every request.
//
// This process plays the UTC server: a real app on an in-memory database,
// listening on a random loopback port. The CLI runs as a child process in two
// zones 26 hours apart — Kiritimati (UTC+14) and Etc/GMT+12 (UTC-12) — whose
// dates always differ from each other, so no single server-side date can
// satisfy both: each successor proves the child's own day was used.
process.env.TZ = 'UTC';

const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const { execFile } = await import('node:child_process');
const { fileURLToPath } = await import('node:url');
const { createDb } = await import('../../server/db.js');
const { runMigrations } = await import('../../server/migrate.js');
const { buildApp } = await import('../../server/index.js');
const { dateInTimeZone } = await import('../../server/localDay.js');
const { createClient } = await import('../../cli/lib/apiClient.js');

const CLI = fileURLToPath(new URL('../../cli/prax.js', import.meta.url));
const SILENT = { info() {}, error() {}, warn() {} };

async function startApp() {
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT });
  const app = await buildApp({ db });
  await app.listen({ port: 0, host: '127.0.0.1' });
  return { app, url: `http://127.0.0.1:${app.server.address().port}` };
}

function cli(args, env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, ...env } },
      (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
  });
}

function nextDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

test('prax task done schedules the next occurrence from the caller\'s day, in any zone', async () => {
  const { app, url } = await startApp();
  try {
    for (const zone of ['Pacific/Kiritimati', 'Etc/GMT+12']) {
      const title = `Water plants (${zone})`;
      const created = await app.inject({
        method: 'POST', url: '/api/tasks',
        payload: { title, project: 'inbox', priority: 'medium', status: 'planned', dueDate: '2020-01-01', recurrence: 'daily' },
      });
      assert.equal(created.statusCode, 201, created.body);
      // Midnight can pass in that zone while the CLI runs: accept either day.
      const before = dateInTimeZone(new Date(), zone);
      const done = await cli(['task', 'done', created.json().id], { TZ: zone, PRAX_API_URL: url, PRAX_PROJECT: 'inbox' });
      const after = dateInTimeZone(new Date(), zone);
      assert.equal(done.code, 0, done.stderr);
      assert.match(done.stdout, /next occurrence/);
      const tasks = (await app.inject({ method: 'GET', url: '/api/tasks' })).json();
      const successor = tasks.find((t) => t.title === title && t.status !== 'completed');
      assert.ok([nextDay(before), nextDay(after)].includes(successor?.dueDate),
        `${zone}: successor due ${successor?.dueDate}, expected ${nextDay(before)}`);
    }
  } finally {
    await app.close();
  }
});

test('every CLI request carries the local date and IANA zone of the machine it runs on', async () => {
  const seen = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    seen.push(opts.headers);
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => [] };
  };
  try {
    const client = createClient({ baseUrl: 'http://x', env: {} });
    await client.listTasks({});
    await client.patchTask('11111111-1111-4111-8111-111111111111', { status: 'completed' });
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    for (const headers of seen) {
      assert.match(headers['x-prax-local-date'], /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(headers['x-prax-time-zone'], zone);
    }
    assert.equal(seen.length, 2);
  } finally {
    globalThis.fetch = saved;
  }
});
