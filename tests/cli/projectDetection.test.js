// Where `prax remember` lands, and what it says about it (review 2026-09-22,
// CLI low-severity fixes), end to end: a real app on an in-memory database on
// a random loopback port, and the CLI run from throwaway directory trees.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../../server/db.js';
import { runMigrations } from '../../server/migrate.js';
import { buildApp } from '../../server/index.js';

const CLI = fileURLToPath(new URL('../../cli/prax.js', import.meta.url));
const SILENT = { info() {}, error() {}, warn() {} };

async function withApp(fn) {
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT });
  const app = await buildApp({ db });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'prax-detect-')));
  try {
    return await fn(app, `http://127.0.0.1:${app.server.address().port}`, base);
  } finally {
    await app.close();
    rmSync(base, { recursive: true, force: true });
  }
}

function write(path, text) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

function cli(args, { cwd, url }) {
  const env = { ...process.env, PRAX_API_URL: url };
  delete env.PRAX_PROJECT;
  delete env.MOOMORA_PROJECT;
  mkdirSync(cwd, { recursive: true });
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env },
      (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
  });
}

async function projectSlugs(app) {
  return (await app.inject({ method: 'GET', url: '/api/projects' })).json().map((p) => p.slug);
}

test('a registered remote beats a marker above the repository, and remember always names the project', async () => {
  await withApp(async (app, url, base) => {
    write(join(base, '.prax', 'project.json'), '{"project":"workspace"}');
    write(join(base, 'repoC', '.git', 'config'), '[remote "origin"]\n\turl = git@example.com:org/repoC.git\n');
    const created = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'repo-c' } });
    assert.equal(created.statusCode, 201, created.body);
    const patched = await app.inject({ method: 'PATCH', url: `/api/projects/${created.json().id}`, payload: { repoUrl: 'https://example.com/org/repoC' } });
    assert.equal(patched.statusCode, 200, patched.body);

    const inRepo = await cli(['remember', 'Deploy notes', '--body', 'B'], { cwd: join(base, 'repoC', 'docs'), url });
    assert.equal(inRepo.code, 0, inRepo.stderr);
    assert.match(inRepo.stdout, /^Remembered "Deploy notes" \([0-9a-f-]{36}\) in repo-c — unverified, at http:\/\/127\.0\.0\.1:\d+\.\n$/);

    // A repository whose remote is not registered still follows the folder's marker.
    write(join(base, 'repoD', '.git', 'config'), '[remote "origin"]\n\turl = git@example.com:org/repoD.git\n');
    const unregistered = await cli(['remember', 'Build notes', '--body', 'B'], { cwd: join(base, 'repoD'), url });
    assert.equal(unregistered.code, 0, unregistered.stderr);
    assert.match(unregistered.stdout, / in workspace — unverified,/);
    assert.equal(unregistered.stderr, '', 'an existing marker is a choice, not a guess');
  });
});

test('from a subfolder with nothing configured, the guess is the repository\'s name and is announced', async () => {
  await withApp(async (app, url, base) => {
    write(join(base, 'repoB', '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n');
    const res = await cli(['remember', 'Doc layout', '--body', 'B'], { cwd: join(base, 'repoB', 'docs'), url });
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stderr, /no project matches this directory; "repoB" \(the folder name\) will be created\. Pass --project <slug> or run `prax init`/);
    const slugs = await projectSlugs(app);
    assert.ok(!slugs.includes('docs'), `no "docs" project: ${slugs.join(', ')}`);
    const slug = slugs.find((s) => s.toLowerCase() === 'repob');
    assert.ok(slug, slugs.join(', '));
    assert.match(res.stdout, new RegExp(` in ${slug} — unverified,`));
    // The second write finds the project: nothing to announce.
    const again = await cli(['task', 'add', 'Tidy docs'], { cwd: join(base, 'repoB', 'docs'), url });
    assert.equal(again.code, 0, again.stderr);
    assert.equal(again.stderr, '');
  });
});

test('remember prints the trust the document actually has', async () => {
  await withApp(async (app, url, base) => {
    const cwd = join(base, 'plain');
    const first = await cli(['remember', 'Backup runbook', '--body', 'Steps', '--project', 'ops'], { cwd, url });
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, / in ops — unverified,/);
    const id = first.stdout.match(/\(([0-9a-f-]{36})\)/)[1];
    const doc = (await app.inject({ method: 'GET', url: `/api/library/documents/${id}` })).json();
    const verified = await app.inject({ method: 'POST', url: `/api/library/documents/${id}/verify`, payload: { verified: true, as: 'Mark', revision: doc.revision } });
    assert.equal(verified.statusCode, 200, verified.body);

    // Same title and body: the verification stands, and the line says so.
    const same = await cli(['remember', 'Backup runbook', '--body', 'Steps', '--project', 'ops', '--tag', 'backup'], { cwd, url });
    assert.equal(same.code, 0, same.stderr);
    assert.match(same.stdout, /^Updated "Backup runbook" .* in ops — verified by Mark, at /);
    // A new body clears it.
    const changed = await cli(['remember', 'Backup runbook', '--body', 'New steps', '--project', 'ops'], { cwd, url });
    assert.match(changed.stdout, /^Updated "Backup runbook" .* in ops — unverified, at /);
  });
});
