// Contract: the Library git mirror round-trips its declared portable fields
// (QINV-06) and keeps SQLite the single writer. Two real apps on in-memory
// SQLite; the CLI mirrors the first, imports into the second, and the second's
// mirror must carry the same portable document content. Deliberate omissions
// (docs/contract.md "Library git mirror"): timestamps, author provenance,
// verification time, task ids, links, retired and archived documents.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../../server/db.js';
import { runMigrations } from '../../server/migrate.js';
import { buildApp } from '../../server/index.js';
import { createClient } from '../../cli/lib/apiClient.js';
import { importMirror } from '../../cli/lib/mirrorImport.js';
import { parseMirrorMarkdown } from '../../cli/lib/mirrorFormat.js';

const CLI = fileURLToPath(new URL('../../cli/prax.js', import.meta.url));
const SILENT = { info() {}, error() {}, warn() {} };

async function startApp() {
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT });
  const app = await buildApp({ db });
  await app.listen({ port: 0, host: '127.0.0.1' });
  return { app, url: `http://127.0.0.1:${app.server.address().port}` };
}

function cli(args, { cwd, url }) {
  const env = { ...process.env, PRAX_API_URL: url };
  delete env.PRAX_PROJECT;
  delete env.PRAX_TRUSTED_VERIFIERS;
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env },
      (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
  });
}

function snapshot(dir) {
  const files = {};
  for (const name of readdirSync(dir, { recursive: true })) {
    if (statSync(join(dir, name)).isFile()) files[name] = readFileSync(join(dir, name), 'utf8');
  }
  return files;
}

// The fields a mirror declares portable, as read back from a mirrored file.
function portable(text) {
  const { meta, body } = parseMirrorMarkdown(text);
  return {
    id: meta.id,
    title: meta.title,
    type: meta.type,
    tags: meta.tags,
    kind: meta.kind,
    status: meta.status,
    content_hash: meta.content_hash,
    source_filename: meta.source_filename,
    external_refs: meta.external_refs.map(({ url, label }) => ({ url, label })),
    code_refs: meta.code_refs.map(({ path, startLine, endLine, commitSha, contentHash }) => ({ path, startLine, endLine, commitSha, contentHash })),
    body,
  };
}

async function post(app, url, payload, headers = {}) {
  const res = await app.inject({ method: 'POST', url, payload, headers });
  assert.ok(res.statusCode < 300, `${url}: ${res.statusCode} ${res.body}`);
  return res.json();
}

test('mirror → import → mirror round-trips the portable fields and honours the trust rule', async () => {
  const source = await startApp();
  const target = await startApp();
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'prax-mirror-contract-')));
  try {
    // The source is a hand-built fixture: no seeded overview card. The import
    // creates the target's project without one too (the mirror carries the
    // project's own card when it has one).
    await post(source.app, '/api/projects', { name: 'demo', overview: false });
    const doc = (fields, headers) => post(source.app, '/api/library/documents', { project: 'demo', documentType: 'note', tags: [], ...fields }, headers);
    const decision = await doc({ title: 'Use SQLite', body: '# Why\n\nOne file, one writer.\n', documentType: 'decision', tags: ['architecture', 'convention'] });
    await post(source.app, `/api/library/documents/${decision.id}/verify`, { verified: true, as: 'Mark', revision: decision.revision });
    const agentNote = await doc({ title: 'Agent finding', body: 'no final newline', kind: 'synthesized' }, { 'x-prax-origin': 'agent', 'x-prax-agent': 'codex' });
    const imported = await doc({ title: 'Imported file', body: 'from disk\n', sourceFilename: 'origin-notes.md', documentType: 'reference', tags: ['ops'] });
    await post(source.app, `/api/library/documents/${imported.id}/external-refs`, { url: 'https://example.com/pr/7', label: 'PR 7' });
    await post(source.app, `/api/library/documents/${imported.id}/code-refs`, { path: 'server/db.js', startLine: 1, endLine: 4, contentHash: 'c'.repeat(64) });
    const old = await doc({ title: 'Old rule', body: 'retired\n', documentType: 'decision' });
    await post(source.app, `/api/library/documents/${old.id}/supersede`, { supersededBy: decision.id });
    const archived = await doc({ title: 'Archived', body: 'gone\n' });
    assert.equal((await source.app.inject({ method: 'DELETE', url: `/api/library/documents/${archived.id}` })).statusCode, 200);

    // Mirror twice into two folders: identical bytes (determinism end to end).
    const first = await cli(['mirror', '--project', 'demo', '--out', 'one'], { cwd: base, url: source.url });
    assert.equal(first.code, 0, first.stderr);
    const again = await cli(['mirror', '--project', 'demo', '--out', 'two'], { cwd: base, url: source.url });
    assert.equal(again.code, 0, again.stderr);
    const one = snapshot(join(base, 'one'));
    assert.deepEqual(snapshot(join(base, 'two')), one);
    assert.deepEqual(Object.keys(one).sort(), ['README.md', 'agent-finding.md', 'index.json', 'origin-notes.md', 'retired/old-rule.md', 'use-sqlite.md']);
    const check = await cli(['mirror', '--project', 'demo', '--out', 'one', '--check'], { cwd: base, url: source.url });
    assert.equal(check.code, 0, check.stdout);

    // A non-interactive import creates everything unverified and names the pending claim.
    const cliImport = await cli(['mirror', 'import', 'one', '--project', 'demo', '--trust-verifier', 'Mark'], { cwd: base, url: target.url });
    assert.equal(cliImport.code, 0, cliImport.stderr);
    assert.match(cliImport.stdout, /3 created, 0 already present, 0 verified/);
    assert.match(cliImport.stdout, /use-sqlite\.md — trusted claim not confirmed/);
    assert.match(cliImport.stdout, /retired\/old-rule\.md \(superseded\)/);
    const unverified = (await target.app.inject({ method: 'GET', url: `/api/library/documents/${decision.id}` })).json();
    assert.equal(unverified.verified, false);

    // An attended re-run applies the trusted claim; nothing is created twice.
    const client = createClient({ baseUrl: target.url, env: {} });
    const report = await importMirror(client, { dir: join(base, 'one'), project: 'demo', trusted: ['Mark'], confirm: async () => true });
    assert.equal(report.created.length, 0);
    assert.equal(report.present.length, 3);
    assert.deepEqual(report.verified.map((v) => [v.id, v.verifier]), [[decision.id, 'Mark']]);
    const verified = (await target.app.inject({ method: 'GET', url: `/api/library/documents/${decision.id}` })).json();
    assert.equal(verified.verified, true);
    assert.equal(verified.verifiedBy, 'Mark');
    const agent = (await target.app.inject({ method: 'GET', url: `/api/library/documents/${agentNote.id}` })).json();
    assert.equal(agent.verified, false, 'an unverified source stays unverified');

    // Mirror the target: every active document carries the same portable content.
    const back = await cli(['mirror', '--project', 'demo', '--out', 'back'], { cwd: base, url: target.url });
    assert.equal(back.code, 0, back.stderr);
    const round = snapshot(join(base, 'back'));
    assert.deepEqual(Object.keys(round).sort(), ['README.md', 'agent-finding.md', 'index.json', 'origin-notes.md', 'use-sqlite.md'], 'the import seeds no starter card beside the mirrored documents');
    for (const path of ['agent-finding.md', 'origin-notes.md', 'use-sqlite.md']) {
      assert.deepEqual(portable(round[path]), portable(one[path]), path);
    }
    assert.match(round['use-sqlite.md'], /^verified_by: "Mark"$/m);

    // The library stays the writer: an edit in git is not imported over it.
    writeFileSync(join(base, 'one', 'use-sqlite.md'), one['use-sqlite.md'].replace('One file, one writer.', 'Edited in git.'));
    const edited = await importMirror(client, { dir: join(base, 'one'), project: 'demo', trusted: ['Mark'], confirm: async () => true });
    assert.deepEqual(edited.conflicts.map((c) => c.id), [decision.id]);
    assert.match((await target.app.inject({ method: 'GET', url: `/api/library/documents/${decision.id}` })).json().body, /One file, one writer\./);

    // The compiled block carries the verified decision and nothing unverified.
    const block = await cli(['mirror', '--agents-block', '--project', 'demo', '--file', 'AGENTS.md'], { cwd: base, url: target.url });
    assert.equal(block.code, 0, block.stderr);
    const agentsFile = readFileSync(join(base, 'AGENTS.md'), 'utf8');
    assert.match(agentsFile, /<!-- prax-library:start -->\n## Verified project knowledge: demo/);
    assert.match(agentsFile, /### Use SQLite\n\n_decision · verified by Mark/);
    assert.doesNotMatch(agentsFile, /Agent finding|Imported file|Old rule/);
    const removed = await cli(['mirror', '--agents-block', '--remove', '--file', 'AGENTS.md'], { cwd: base, url: target.url });
    assert.equal(removed.code, 0, removed.stderr);
    assert.equal(readFileSync(join(base, 'AGENTS.md'), 'utf8'), '');
  } finally {
    await source.app.close();
    await target.app.close();
    rmSync(base, { recursive: true, force: true });
  }
});
