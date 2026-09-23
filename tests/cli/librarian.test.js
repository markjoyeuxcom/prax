// `prax used`, `prax doctor` and `prax telemetry` (librarian spec 2026-09-23):
// unit checks over a fake client, the request shapes the API client sends,
// and the commands end to end against a real in-memory server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from '../../cli/lib/apiClient.js';
import {
  markUsed, doctorExitCode, formatDoctor, formatTelemetryStatus, DOCTOR_EXIT,
} from '../../cli/lib/librarian.js';
import { createDb } from '../../server/db.js';
import { runMigrations } from '../../server/migrate.js';
import { buildApp } from '../../server/index.js';

const CLI = fileURLToPath(new URL('../../cli/prax.js', import.meta.url));
const DOC = '2234a575-027e-4218-892a-b74d2b5c7f8c';

function jsonRes(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

test('markUsed validates the id before any request', async () => {
  let calls = 0;
  const client = { markUsed: async (id) => { calls += 1; return { documentId: id }; } };
  await assert.rejects(markUsed(client, 'not-an-id'), /used requires a document uuid/);
  await assert.rejects(markUsed(client, undefined), /used requires a document uuid/);
  assert.equal(calls, 0);
  assert.deepEqual(await markUsed(client, DOC), { documentId: DOC });
});

test('the client names retrieval sources and marks a use as an agent write', async () => {
  const seen = [];
  globalThis.fetch = async (url, opts = {}) => {
    seen.push({ url: String(url), method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body });
    return jsonRes(200, { items: [], page: null });
  };
  const client = createClient({ baseUrl: 'http://x', agent: 'claude', env: {} });
  await client.semanticSearch(undefined, 'q', { source: 'recall' });
  await client.keywordSearch(undefined, 'q', { source: 'search' });
  await client.semanticSearch(undefined, 'q', {});
  await client.markUsed(DOC);
  const calls = seen.filter((c) => !c.url.endsWith('/readyz'));
  assert.equal(calls[0].headers['x-prax-query-source'], 'recall');
  assert.equal(calls[0].headers['x-prax-agent'], 'claude');
  assert.equal(calls[1].headers['x-prax-query-source'], 'search');
  assert.equal(calls[2].headers['x-prax-query-source'], undefined, 'no source, no telemetry');
  assert.match(calls[3].url, /\/api\/library\/telemetry\/used$/);
  assert.equal(calls[3].method, 'POST');
  assert.equal(calls[3].headers['x-prax-origin'], 'agent');
  assert.deepEqual(JSON.parse(calls[3].body), { documentId: DOC, source: 'cli' });
});

test('doctor exit codes: 0 clean, 2 on a warning, 1 when there is no report', () => {
  assert.equal(doctorExitCode({ checks: [{ id: 'stale', level: 'ok' }, { id: 'gaps', level: 'info' }] }), DOCTOR_EXIT.ok);
  assert.equal(doctorExitCode({ checks: [{ id: 'stale', level: 'warn' }] }), DOCTOR_EXIT.warn);
  assert.equal(doctorExitCode(null), DOCTOR_EXIT.failed);
  const text = formatDoctor({
    status: 'warn',
    checks: [{ id: 'stale', level: 'warn', message: '1 stale derivation(s)' }],
    clusters: { clusters: [{ status: 'new', documents: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], edges: [{ method: 'shingle', similarity: 0.7 }] }] },
    gaps: { items: [{ query: 'tls rotation', reason: 'no-hits', occurrences: 2 }] },
    telemetry: { enabled: true, queries: 3, uses: 1, retentionDays: 90 },
  }, { base: 'http://x' });
  assert.match(text, /\[WARN\] stale: 1 stale derivation\(s\)/);
  assert.match(text, /"A", "B" \(shingle 0\.7\)/);
  assert.match(text, /"tls rotation" — no hits, asked 2×/);
  assert.match(formatTelemetryStatus({ enabled: false, queries: 0, uses: 0, retentionDays: 90, maxQueryRows: 1, maxUseRows: 1 }), /off \(PRAX_RECALL_TELEMETRY=off\)/);
});

// ---- end to end ---------------------------------------------------------------

async function withServer(fn) {
  const db = createDb(':memory:');
  await runMigrations(db, { logger: { info() {}, error() {}, warn() {} } });
  const app = await buildApp({ db, librarianSweep: false });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  try { return await fn(app, url, db); } finally { await app.close(); }
}

function cli(args, url) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], {
      encoding: 'utf8', env: { ...process.env, PRAX_API_URL: url, PRAX_PROJECT: 'demo', PRAX_AGENT: 'codex' },
    }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
  });
}

test('prax used, telemetry and doctor against a real server', async () => {
  await withServer(async (app, url, db) => {
    const doc = (await app.inject({
      method: 'POST', url: '/api/library/documents',
      payload: { title: 'Restore Postgres', body: 'Stop the app, restore the dump, start the app and check counts.', documentType: 'runbook', project: 'homelab' },
    })).json();
    assert.ok(doc.id, JSON.stringify(doc));

    let res = await cli(['doctor'], url);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /Prax doctor — http:\/\/127\.0\.0\.1:\d+: ok/);

    res = await cli(['recall', 'restore the dump'], url);
    assert.equal(res.code, 0, res.stderr);
    res = await cli(['used', doc.id], url);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /Noted: used "Restore Postgres"/);
    const use = (await db.query('select agent from recall_uses')).rows[0];
    assert.equal(use.agent, 'codex');
    const recorded = (await db.query('select source, agent, mode from recall_queries')).rows;
    assert.deepEqual(recorded.map((r) => [r.source, r.agent, r.mode]), [['recall', 'codex', 'keyword']]);

    res = await cli(['telemetry', 'status', '--json'], url);
    assert.equal(JSON.parse(res.stdout).uses, 1);

    // A near-duplicate makes doctor warn (exit 2) until a proposal exists.
    await app.inject({
      method: 'POST', url: '/api/library/documents',
      payload: { title: 'Restore Postgres', body: 'Stop the app, restore the dump, start the app and check counts again.', documentType: 'runbook', project: 'homelab' },
    });
    res = await cli(['doctor', '--json'], url);
    assert.equal(res.code, 2);
    assert.equal(JSON.parse(res.stdout).checks.find((c) => c.id === 'duplicates').level, 'warn');

    res = await cli(['telemetry', 'clear'], url);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /Cleared 1 recorded queries and 1 used signals/);
    assert.equal((await db.query('select count(*) as n from recall_uses')).rows[0].n, 0);

    res = await cli(['telemetry', 'wipe'], url);
    assert.notEqual(res.code, 0);
    assert.match(res.stderr, /Unknown telemetry subcommand: wipe/);
  });
  const unreachable = await cli(['doctor'], 'http://127.0.0.1:9');
  assert.equal(unreachable.code, 1);
  assert.match(unreachable.stderr, /doctor could not run: Prax not reachable/);
});
