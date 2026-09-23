// Completing a recurring task through the MCP client rolls it forward from the
// CALLER's today on a UTC server (review 2026-09-22, a263da8e). This process
// plays the UTC server (a real app, in-memory database, random loopback port);
// the MCP client runs as a child process in Kiritimati (UTC+14) and in
// Etc/GMT+12 (UTC-12), whose dates always differ from each other, so each
// successor proves the child's own day was used.
process.env.TZ = 'UTC';

const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const { execFile } = await import('node:child_process');
const { createDb } = await import('../../server/db.js');
const { runMigrations } = await import('../../server/migrate.js');
const { buildApp } = await import('../../server/index.js');
const { dateInTimeZone } = await import('../../server/localDay.js');
const { createPraxClient } = await import('../../mcp/praxClient.js');

const CLIENT = new URL('../../mcp/praxClient.js', import.meta.url).href;
const SILENT = { info() {}, error() {}, warn() {} };

function nextDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function completeInZone(zone, url, id) {
  const script = `
    const { createPraxClient } = await import(${JSON.stringify(CLIENT)});
    const client = createPraxClient({ baseUrl: process.env.TARGET, env: {} });
    const task = await client.updateTask(process.env.TASK_ID, { status: 'completed' });
    process.stdout.write(JSON.stringify(task));
  `;
  return new Promise((resolve) => {
    execFile(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8', env: { ...process.env, TZ: zone, TARGET: url, TASK_ID: id },
    }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
  });
}

test('update_task completion schedules the next occurrence from the MCP caller\'s day', async () => {
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT });
  const app = await buildApp({ db });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  try {
    for (const zone of ['Pacific/Kiritimati', 'Etc/GMT+12']) {
      const title = `Rotate logs (${zone})`;
      const created = await app.inject({
        method: 'POST', url: '/api/tasks',
        payload: { title, project: 'inbox', priority: 'medium', status: 'planned', dueDate: '2020-01-01', recurrence: 'daily' },
      });
      assert.equal(created.statusCode, 201, created.body);
      const before = dateInTimeZone(new Date(), zone);
      const done = await completeInZone(zone, url, created.json().id);
      const after = dateInTimeZone(new Date(), zone);
      assert.equal(done.code, 0, done.stderr);
      assert.equal(JSON.parse(done.stdout).status, 'completed');
      const tasks = (await app.inject({ method: 'GET', url: '/api/tasks' })).json();
      const successor = tasks.find((t) => t.title === title && t.status !== 'completed');
      assert.ok([nextDay(before), nextDay(after)].includes(successor?.dueDate),
        `${zone}: successor due ${successor?.dueDate}, expected ${nextDay(before)}`);
    }
  } finally {
    await app.close();
  }
});

test('the MCP client sends its day on every request; the in-app assistant\'s client sends none of its own', async () => {
  const calls = [];
  const fetch = async (_url, options) => {
    calls.push(options.headers);
    return { status: 200, ok: true, text: async () => '[]' };
  };
  await createPraxClient({ baseUrl: 'http://x', fetch, env: {} }).listTasks({});
  assert.match(calls[0]['x-prax-local-date'], /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(calls[0]['x-prax-time-zone'], Intl.DateTimeFormat().resolvedOptions().timeZone);
  // server/assistant/injectClient.js runs inside the server: its clock is not
  // the user's, so it forwards the requester's day instead of sending its own.
  await createPraxClient({ baseUrl: 'http://x', fetch, env: {}, sendLocalDay: false }).listTasks({});
  assert.equal('x-prax-local-date' in calls[1], false);
  assert.equal('x-prax-time-zone' in calls[1], false);
});
