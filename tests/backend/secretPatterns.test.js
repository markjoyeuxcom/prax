// Credential shapes shared by the harvester (skip) and recall telemetry
// (redact before storing a query). Tokens are assembled from parts so the test
// file itself never holds a literal that a secret scanner would flag.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../../server/db.js';
import { runMigrations } from '../../server/migrate.js';
import { buildApp } from '../../server/index.js';
import { looksLikeCredential, redactSecrets, REDACTED } from '../../server/secretPatterns.js';
import { createRecallTelemetry, normalizeQueryKey, storedQueryText, MAX_QUERY_CHARS } from '../../server/recallTelemetry.js';
import { looksSecret } from '../../cli/lib/harvest.js';

const SILENT = { info() {}, error() {}, warn() {} };
const flush = () => new Promise((resolve) => { setImmediate(() => setImmediate(resolve)); });

const join = (...parts) => parts.join('');
const TOKENS = {
  github: join('ghp', '_', 'aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5'),
  githubFine: join('github', '_pat_', '11ABCDEFG0', 'aBcDeFgHiJkLmNoPqRsTuV_wXyZ0123456789'),
  gitlab: join('glpat', '-', 'xY7zQ9wE1rT3yU5iO7pA'),
  awsKeyId: join('AKIA', 'IOSFODNN7', 'EXAMPLE'),
  awsTempId: join('ASIA', 'Y34FZKBOKM', 'UTVV7A'),
  slack: join('xoxb', '-', '1234567890-0987654321-AbCdEfGhIjKl'),
  openai: join('sk', '-proj-', 'Ab12Cd34Ef56Gh78Ij90Kl12'),
  anthropic: join('sk', '-ant-', 'api03-Zz99Yy88Xx77Ww66Vv55'),
  jwt: join('eyJ', 'hbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxMjM0In0', '.', 'dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
};
const PRIVATE_KEY = join('-----BEGIN ', 'RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA7s3x\nq9Zk2\n-----END ', 'RSA PRIVATE KEY-----');

test('every self-identifying token shape is recognised (the harvester skips it)', () => {
  for (const [name, token] of Object.entries(TOKENS)) {
    if (name === 'jwt') continue; // contextual: redacted from queries, not a harvester skip
    assert.ok(looksLikeCredential(`use ${token} for the deploy`), name);
    assert.ok(looksSecret(`use ${token} for the deploy`), `${name} (harvester)`);
  }
  assert.ok(looksLikeCredential(PRIVATE_KEY));
  assert.equal(looksLikeCredential('how do we rotate the github token'), false);
  assert.equal(looksLikeCredential('password reset flow for the NAS'), false);
});

test('redaction replaces only the secret span and keeps the rest of the query', () => {
  for (const [name, token] of Object.entries(TOKENS)) {
    const out = redactSecrets(`why does ${token} fail on push`);
    assert.equal(out, `why does ${REDACTED} fail on push`, name);
  }
  assert.equal(redactSecrets('curl -H "Authorization: Bearer abc.DEF-123_xyz~987" api'), 'curl -H "Authorization: Bearer [redacted]" api');
  assert.equal(redactSecrets('Authorization: Basic dXNlcjpodW50ZXIy please'), 'Authorization: Basic [redacted] please');
  assert.equal(redactSecrets('db login password=hunter2 fails'), 'db login password=[redacted] fails');
  assert.equal(redactSecrets('set PGPASSWORD="s3cr3t pass" then retry'), 'set PGPASSWORD=[redacted] then retry');
  assert.equal(redactSecrets("api_key: 'abc123def' rejected"), 'api_key: [redacted] rejected');
  assert.equal(redactSecrets('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'), 'AWS_SECRET_ACCESS_KEY=[redacted]');
  assert.equal(redactSecrets('clone https://mark:tok3n@git.example.com/repo.git'), 'clone https://mark:[redacted]@git.example.com/repo.git');
  assert.equal(redactSecrets(`key ${PRIVATE_KEY} tail`), 'key [redacted] tail');
  assert.equal(redactSecrets(join('-----BEGIN ', 'OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEA')), REDACTED, 'a header without its END line');
  // Ordinary questions are untouched.
  for (const q of ['how do we rotate the tunnel token', 'Postgres backup runbook', 'why is the bearer auth middleware slow']) {
    assert.equal(redactSecrets(q), q);
  }
});

test('the stored query and its grouping key come from the redacted text', () => {
  const query = `restore with ${TOKENS.github} and password=hunter2`;
  const stored = storedQueryText(query);
  assert.equal(stored, `restore with ${REDACTED} and password=${REDACTED}`);
  assert.equal(normalizeQueryKey(stored), 'restore with redacted and password redacted');
  // Redaction runs before the cap: a secret straddling the cut is still caught.
  const long = `${'x '.repeat((MAX_QUERY_CHARS - 10) / 2)}${TOKENS.gitlab}`;
  assert.ok(!storedQueryText(long).includes('glpat'), 'no partial token survives the cap');
  assert.ok(storedQueryText(long).length <= MAX_QUERY_CHARS);
});

test('recall telemetry never stores a pasted secret, through the store and through a route', async () => {
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT });
  const telemetry = createRecallTelemetry(db);
  await telemetry.recordQuery({ source: 'recall', mode: 'keyword', query: `deploy fails with ${TOKENS.awsKeyId}`, agent: 'claude', hitIds: [] });
  let rows = (await db.query('select query, query_key from recall_queries')).rows;
  assert.deepEqual(rows.map((r) => [r.query, r.query_key]), [[`deploy fails with ${REDACTED}`, 'deploy fails with redacted']]);

  const app = await buildApp({ db, embedder: null, librarianSweep: false });
  const q = encodeURIComponent(`Authorization: Bearer ${TOKENS.openai}`);
  const res = await app.inject({
    method: 'GET', url: `/api/library/documents?q=${q}`,
    headers: { 'x-prax-query-source': 'search', 'x-prax-origin': 'agent', 'x-prax-agent': 'codex' },
  });
  assert.equal(res.statusCode, 200);
  await flush();
  rows = (await db.query('select query, query_key from recall_queries order by id')).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[1].query, `Authorization: Bearer ${REDACTED}`);
  const everything = JSON.stringify(rows);
  for (const token of Object.values(TOKENS)) assert.ok(!everything.includes(token));
  assert.ok(!everything.toLowerCase().includes('proj'), 'no fragment of the token in the key either');
  await app.close();
});
