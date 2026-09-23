// `prax mirror import`: git-sourced verification is a claim. A document lands
// verified only for a trusted verifier, over the exact body the claim names,
// after an attended confirmation; git never writes over an existing document.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderDocumentMarkdown } from '../../server/libraryExport.js';
import { sha256 } from '../../cli/lib/mirrorFormat.js';
import { writeMirror } from '../../cli/lib/mirror.js';
import { claimProblem, confirmClaims, importMirror, trustedVerifiers } from '../../cli/lib/mirrorImport.js';

let n = 0;
function doc(fields = {}) {
  n += 1;
  const record = {
    id: `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`,
    title: `Doc ${n}`,
    body: `Body ${n}\n`,
    documentType: 'decision',
    tags: ['architecture'],
    kind: 'source',
    status: 'active',
    verified: true,
    verifiedBy: 'Mark',
    sourceFilename: null,
    externalRefs: [],
    codeRefs: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...fields,
  };
  record.contentHash = sha256(record.body);
  return {
    record,
    path: `${record.status === 'active' ? '' : 'retired/'}doc-${n}.md`,
    id: record.id,
    title: record.title,
    documentType: record.documentType,
    status: record.status,
    tags: record.tags,
    verified: record.verified,
    verifiedBy: record.verifiedBy,
    contentHash: record.contentHash,
    markdown: renderDocumentMarkdown(record, 'demo', null),
  };
}

// A library that behaves like the routes the importer calls.
function fakeClient(existing = []) {
  const docs = new Map(existing.map((d) => [d.id, d]));
  const calls = { create: [], verify: [], externalRefs: [], codeRefs: [] };
  const httpError = (status, message) => Object.assign(new Error(message), { status });
  return {
    docs,
    calls,
    gone: new Set(),
    async getDocument(id) {
      if (!docs.has(id)) throw httpError(404, 'document not found');
      return docs.get(id);
    },
    async createMemory(payload) {
      calls.create.push(payload);
      if (this.gone.has(payload.id)) throw httpError(410, 'permanently deleted');
      const created = {
        ...payload, verified: false, verifiedBy: null, contentHash: sha256(payload.body), revision: sha256(JSON.stringify([payload.title, payload.body])),
      };
      docs.set(payload.id, created);
      return created;
    },
    async verify(id, body) {
      calls.verify.push({ id, ...body });
      const current = docs.get(id);
      assert.equal(body.revision, current.revision, 'verification is bound to the created revision');
      Object.assign(current, { verified: true, verifiedBy: body.as });
      return current;
    },
    async addExternalRef(id, ref) { calls.externalRefs.push({ id, ...ref }); },
    async addCodeRef(id, ref) { calls.codeRefs.push({ id, ...ref }); },
  };
}

function withMirror(documents, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'prax-mirror-import-'));
  return (async () => {
    try {
      writeMirror({ dir, project: 'demo', documents });
      return await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
}

const yes = async () => true;

test('documents land unverified by default, with their portable fields and the exact body', async () => {
  const withRefs = doc({
    sourceFilename: 'origin.md', kind: 'synthesized', body: 'no final newline',
    externalRefs: [{ id: 'r', url: 'https://example.com/pr/1', label: 'PR' }],
    codeRefs: [{ id: 'c', path: 'cli/prax.js', startLine: 1, endLine: 3, commitSha: null, contentHash: 'a'.repeat(64) }],
  });
  const plain = doc({ verified: false, verifiedBy: null });
  await withMirror([withRefs, plain], async (dir) => {
    const client = fakeClient();
    const report = await importMirror(client, { dir, project: 'demo', trusted: [], confirm: yes });
    assert.equal(report.created.length, 2);
    assert.deepEqual(report.verified, []);
    const created = client.calls.create.find((c) => c.id === withRefs.id);
    assert.deepEqual(created, {
      id: withRefs.id, project: 'demo', title: withRefs.title, body: 'no final newline', documentType: 'decision',
      tags: ['architecture'], kind: 'synthesized', sourceFilename: 'origin.md', verified: false,
    });
    assert.ok(client.calls.create.every((c) => c.verified === false), 'every create asks for unverified');
    assert.deepEqual(client.calls.externalRefs, [{ id: withRefs.id, url: 'https://example.com/pr/1', label: 'PR' }]);
    assert.equal(client.calls.codeRefs.length, 1);
    assert.deepEqual(report.unverifiedClaims.map((c) => c.reason), ['verifier "Mark" is not trusted']);
  });
});

test('a trusted claim over an unchanged body is verified as the claimed verifier after confirmation', async () => {
  const claimed = doc();
  await withMirror([claimed], async (dir) => {
    const client = fakeClient();
    let shown;
    const report = await importMirror(client, {
      dir, project: 'demo', trusted: ['Mark'], confirm: async (claims) => { shown = claims; return true; },
    });
    assert.deepEqual(shown.map((c) => [c.id, c.verifier]), [[claimed.id, 'Mark']]);
    assert.deepEqual(client.calls.verify.map((v) => [v.id, v.verified, v.as]), [[claimed.id, true, 'Mark']]);
    assert.equal(report.verified.length, 1);
    assert.equal(client.docs.get(claimed.id).verified, true);
  });
});

test('each condition of the trust rule withholds verification, with a reason', async () => {
  const untrusted = doc({ verifiedBy: 'Eve' });
  const anonymous = doc({ verifiedBy: null });
  const edited = doc();
  const unconfirmed = doc();
  await withMirror([untrusted, anonymous, edited], async (dir) => {
    // An edit to the body after verification, made in git.
    const file = join(dir, `doc-${n - 1}.md`);
    writeFileSync(file, readFileSync(file, 'utf8').replace(/Body \d+/, 'Tampered'));
    const client = fakeClient();
    const report = await importMirror(client, { dir, project: 'demo', trusted: ['Mark'], confirm: yes });
    assert.deepEqual(client.calls.verify, []);
    const reasons = Object.fromEntries(report.unverifiedClaims.map((c) => [c.id, c.reason]));
    assert.equal(reasons[untrusted.id], 'verifier "Eve" is not trusted');
    assert.equal(reasons[anonymous.id], 'no verifier named');
    assert.equal(reasons[edited.id], 'body changed after verification (content hash mismatch)');
    // The tampered body is still imported, unverified.
    assert.equal(client.docs.get(edited.id).body, `Tampered\n`);
  });
  await withMirror([unconfirmed], async (dir) => {
    const client = fakeClient();
    const report = await importMirror(client, { dir, project: 'demo', trusted: ['Mark'], confirm: async () => false });
    assert.deepEqual(client.calls.verify, []);
    assert.match(report.unverifiedClaims[0].reason, /not confirmed/);
  });
});

test('existing documents keep the library copy; retired, gone and changed ones are skipped and reported', async () => {
  const same = doc();
  const differs = doc();
  const retired = doc({ status: 'superseded' });
  const gone = doc();
  await withMirror([same, differs, retired, gone], async (dir) => {
    const client = fakeClient([
      { id: same.id, title: same.title, body: same.record.body, contentHash: same.contentHash, verified: false, revision: 'r' },
      { id: differs.id, title: differs.title, contentHash: sha256('library edit'), verified: true },
    ]);
    client.gone.add(gone.id);
    const report = await importMirror(client, { dir, project: 'demo', trusted: ['Mark'], confirm: async () => false });
    assert.deepEqual(report.present.map((d) => d.id), [same.id]);
    assert.deepEqual(report.conflicts.map((d) => d.id), [differs.id]);
    assert.deepEqual(report.retired.map((d) => [d.id, d.status]), [[retired.id, 'superseded']]);
    assert.deepEqual(report.gone.map((d) => d.id), [gone.id]);
    assert.deepEqual(client.calls.create.map((c) => c.id), [gone.id], 'only the absent document is created');
    // An unverified library copy with the claimed body is still eligible (a re-run after an interruption).
    assert.match(report.unverifiedClaims.find((c) => c.id === same.id).reason, /not confirmed/);
  });
});

test('trusted names come from the flag or PRAX_TRUSTED_VERIFIERS, never from the mirror', () => {
  assert.deepEqual(trustedVerifiers({ flag: ' Mark , Ana,Mark', env: {} }), ['Mark', 'Ana']);
  assert.deepEqual(trustedVerifiers({ env: { PRAX_TRUSTED_VERIFIERS: 'Mark' } }), ['Mark']);
  assert.deepEqual(trustedVerifiers({ flag: '', env: { PRAX_TRUSTED_VERIFIERS: 'Mark' } }), [], 'an explicit empty flag trusts no one');
  assert.equal(claimProblem({ verified: true, verified_by: 'mark' }, true, ['Mark']), 'verifier "mark" is not trusted', 'names match exactly');
  assert.equal(claimProblem({ verified: false }, true, ['Mark']), 'not claimed');
});

test('confirmation needs an attended terminal and the exact phrase', async () => {
  const claims = [{ id: 'a', title: 'A', verifier: 'Mark' }, { id: 'b', title: 'B', verifier: 'Mark' }];
  assert.equal(await confirmClaims(claims, { input: new PassThrough(), output: new PassThrough() }), false, 'no TTY, no verification');
  const attended = async (answer) => {
    const input = new PassThrough();
    const output = new PassThrough();
    input.isTTY = true;
    output.isTTY = true;
    let text = '';
    output.on('data', (chunk) => { text += chunk; });
    const pending = confirmClaims(claims, { input, output });
    input.end(`${answer}\n`);
    return { confirmed: await pending, text };
  };
  const ok = await attended('VERIFY 2');
  assert.equal(ok.confirmed, true);
  assert.match(ok.text, /A \(a\) — verified by Mark/);
  assert.equal((await attended('VERIFY 1')).confirmed, false);
  assert.equal((await attended('yes')).confirmed, false);
});
