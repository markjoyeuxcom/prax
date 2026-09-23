// prax check — the cite-drift gate. Unit tests for the diff parser, the touch
// rule and the verdicts, then the command end to end: a temporary git
// repository, a throwaway in-process Prax on a random port, and the CLI run as
// a child process, including the fail-open path when Prax is unreachable.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCb, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseUnifiedDiff, parsePathList, touchingHunks, runCheck, formatCheck, formatCheckComment,
  checkExitCode, skippedReport, unquoteGitPath,
} from '../../cli/lib/check.js';
import { computeAnchors, resolveCitation } from '../../cli/lib/codeRefs.js';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';

const execFile = promisify(execFileCb);
const CLI = fileURLToPath(new URL('../../cli/prax.js', import.meta.url));
const lines = (...l) => `${l.join('\n')}\n`;

// ---- diff parsing ------------------------------------------------------------------

test('parseUnifiedDiff reads modified, added, deleted and renamed files with zero-context hunks', () => {
  const diff = [
    'diff --git a/src/a.js b/src/a.js',
    'index 1..2 100644',
    '--- a/src/a.js',
    '+++ b/src/a.js',
    '@@ -3,2 +3,3 @@ function x() {',
    '-old',
    '--- a removed line that looks like a header',
    '+new',
    '@@ -10,0 +12 @@',
    '+inserted',
    'diff --git a/new.js b/new.js',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/new.js',
    '@@ -0,0 +1 @@',
    '+x',
    'diff --git a/gone.js b/gone.js',
    'deleted file mode 100644',
    '--- a/gone.js',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-x',
    'diff --git a/old name.js b/lib/new name.js',
    'similarity index 100%',
    'rename from old name.js',
    'rename to lib/new name.js',
    'diff --git a/bin.png b/bin.png',
    'Binary files a/bin.png and b/bin.png differ',
  ].join('\n');
  assert.deepEqual(parseUnifiedDiff(diff), [
    { oldPath: 'src/a.js', newPath: 'src/a.js', status: 'modified', hunks: [
      { oldStart: 3, oldCount: 2, newStart: 3, newCount: 3 },
      { oldStart: 10, oldCount: 0, newStart: 12, newCount: 1 },
    ] },
    { oldPath: null, newPath: 'new.js', status: 'added', hunks: [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: 1 }] },
    { oldPath: 'gone.js', newPath: null, status: 'deleted', hunks: [{ oldStart: 1, oldCount: 1, newStart: 0, newCount: 0 }] },
    { oldPath: 'old name.js', newPath: 'lib/new name.js', status: 'renamed', hunks: [] },
    { oldPath: 'bin.png', newPath: 'bin.png', status: 'modified', hunks: [] },
  ]);
});

test('C-quoted git paths are decoded', () => {
  assert.equal(unquoteGitPath('"a/caf\\303\\251.js"'), 'a/café.js');
  assert.equal(unquoteGitPath('"a/tab\\there.js"'), 'a/tab\there.js');
  assert.equal(unquoteGitPath('plain.js'), 'plain.js');
});

test('path lists accept commas and newlines, and drop ./ and blanks', () => {
  assert.deepEqual(parsePathList('./src/a.js, src/b.js\n\nsrc/a.js\n'), ['src/a.js', 'src/b.js']);
});

test('the touch rule: overlapping old lines, and insertions strictly inside the range', () => {
  const hunks = [
    { oldStart: 5, oldCount: 2 }, // 5-6
    { oldStart: 20, oldCount: 0 }, // insertion after 20
  ];
  assert.equal(touchingHunks(hunks, 6, 10).length, 1);
  assert.equal(touchingHunks(hunks, 7, 10).length, 0);
  assert.equal(touchingHunks(hunks, 1, 4).length, 0);
  assert.equal(touchingHunks(hunks, 18, 25).length, 1, 'insertion inside the range');
  assert.equal(touchingHunks(hunks, 21, 25).length, 0, 'insertion just above the range');
  assert.equal(touchingHunks(hunks, 15, 20).length, 0, 'insertion just below the range');
});

// ---- verdicts over a fake client --------------------------------------------------------

const BASE = lines(
  'import a from "a";', //                            1
  '', //                                               2
  'export function loadConfig(env) {', //              3
  '  const port = Number(env.PORT || 3000);', //        4
  '  return { port };', //                              5
  '}', //                                               6
  '', //                                               7
  'export const other = 1;', //                         8
);

function citation(text, start, end, over = {}) {
  return {
    id: over.id || `ref-${start}`, path: over.path || 'src/config.js', startLine: start, endLine: end,
    ...computeAnchors(text, start, end, over.path || 'src/config.js'),
    commitSha: null,
    document: {
      id: over.docId || `doc-${start}`, title: over.title || 'Port default', documentType: 'decision', status: 'active',
      verified: false, updatedAt: '2026-09-20T00:00:00Z', projectSlug: 'app', projectRepoUrl: null,
    },
    ...over.ref,
  };
}

const fakeClient = (refs, seen = []) => ({
  listCodeRefsByPath: async (paths, options) => { seen.push({ paths, options }); return refs.filter((r) => paths.includes(r.path)); },
});

const diffOf = (hunks, over = {}) => [{ oldPath: 'src/config.js', newPath: 'src/config.js', status: 'modified', hunks, ...over }];
const reader = (files) => (path) => (Object.hasOwn(files, path) ? files[path] : null);

test('drift: the change breaks a citation that held at the base', async () => {
  const head = BASE.replace('3000', '8080');
  const report = await runCheck(fakeClient([citation(BASE, 4, 5)]), {
    mode: 'diff', changes: diffOf([{ oldStart: 4, oldCount: 1, newStart: 4, newCount: 1 }]),
    readBase: reader({ 'src/config.js': BASE }), readHead: reader({ 'src/config.js': head }),
  });
  assert.equal(report.status, 'drift');
  assert.equal(report.drift, 1);
  const [f] = report.findings;
  assert.equal(f.verdict, 'drift');
  assert.deepEqual(f.touched, ['line 4']);
  assert.match(f.note, /src\/config\.js changed since this was written \(loadConfig is now at line 3\)/);
  assert.equal(checkExitCode(report), 1);
});

test('holds: a whitespace-only change, and a move, do not fail', async () => {
  const reformatted = BASE.replace('  const port = Number(env.PORT || 3000);', '    const port = Number( env.PORT || 3000 );');
  let report = await runCheck(fakeClient([citation(BASE, 4, 5)]), {
    mode: 'diff', changes: diffOf([{ oldStart: 4, oldCount: 1, newStart: 4, newCount: 1 }]),
    readBase: reader({ 'src/config.js': BASE }), readHead: reader({ 'src/config.js': reformatted }),
  });
  assert.equal(report.status, 'clean');
  assert.equal(report.findings[0].verdict, 'holds');
  assert.match(report.findings[0].note, /whitespace changed/);
  assert.equal(checkExitCode(report), 0);

  // Lines inserted INSIDE a whole-function citation that leave the cited
  // lines intact elsewhere: moved, still holds.
  const moved = `// banner\n// banner\n${BASE}`;
  report = await runCheck(fakeClient([citation(BASE, 3, 6)]), {
    mode: 'diff', changes: diffOf([{ oldStart: 0, oldCount: 0, newStart: 1, newCount: 2 }, { oldStart: 4, oldCount: 0, newStart: 7, newCount: 0 }]),
    readBase: reader({ 'src/config.js': BASE }), readHead: reader({ 'src/config.js': moved }),
  });
  assert.equal(report.findings[0].verdict, 'holds');
  assert.match(report.findings[0].note, /moved to src\/config\.js:5-8/);
});

test('untouched citations in a changed file are not reported', async () => {
  const head = BASE.replace('other = 1', 'other = 2');
  const report = await runCheck(fakeClient([citation(BASE, 4, 5)]), {
    mode: 'diff', changes: diffOf([{ oldStart: 8, oldCount: 1, newStart: 8, newCount: 1 }]),
    readBase: reader({ 'src/config.js': BASE }), readHead: reader({ 'src/config.js': head }),
  });
  assert.equal(report.findings.length, 0);
  assert.equal(report.untouched, 1);
  assert.equal(report.status, 'clean');
});

test('stale: a citation already broken at the base is reported but does not fail', async () => {
  const stale = { ...citation(BASE, 4, 5), contentHash: 'f'.repeat(64), normalizedHash: 'e'.repeat(64) };
  const head = BASE.replace('3000', '8080');
  const report = await runCheck(fakeClient([stale]), {
    mode: 'diff', changes: diffOf([{ oldStart: 5, oldCount: 1, newStart: 5, newCount: 1 }]),
    readBase: reader({ 'src/config.js': BASE }), readHead: reader({ 'src/config.js': head }),
  });
  assert.equal(report.findings[0].verdict, 'stale');
  assert.equal(report.status, 'clean');
  assert.equal(checkExitCode(report), 0);
});

test('a change that repairs an already-broken citation reports it as holding', async () => {
  const broken = BASE.replace('3000', '9999');
  const report = await runCheck(fakeClient([citation(BASE, 4, 5)]), {
    mode: 'diff', changes: diffOf([{ oldStart: 4, oldCount: 1, newStart: 4, newCount: 1 }]),
    readBase: reader({ 'src/config.js': broken }), readHead: reader({ 'src/config.js': BASE }),
  });
  assert.equal(report.findings[0].verdict, 'holds');
  assert.equal(report.status, 'clean');
});

test('a stale citation is found through its symbol block when its recorded lines are elsewhere', async () => {
  const stale = { ...citation(BASE, 1, 1), contentHash: 'f'.repeat(64), normalizedHash: 'e'.repeat(64), symbol: 'loadConfig' };
  const report = await runCheck(fakeClient([stale]), {
    mode: 'diff', changes: diffOf([{ oldStart: 5, oldCount: 1, newStart: 5, newCount: 1 }]),
    readBase: reader({ 'src/config.js': BASE }), readHead: reader({ 'src/config.js': BASE.replace('{ port }', '{ port, host }') }),
  });
  assert.equal(report.findings[0]?.verdict, 'stale');
});

test('a renamed or deleted file breaks its citations', async () => {
  let report = await runCheck(fakeClient([citation(BASE, 4, 5)]), {
    mode: 'diff', changes: [{ oldPath: 'src/config.js', newPath: 'lib/config.js', status: 'renamed', hunks: [] }],
    readBase: reader({ 'src/config.js': BASE }), readHead: reader({ 'lib/config.js': BASE }),
  });
  assert.equal(report.findings[0].verdict, 'drift');
  assert.equal(report.findings[0].renamedTo, 'lib/config.js');
  assert.match(report.findings[0].note, /renamed to lib\/config\.js \(content intact\)/);

  report = await runCheck(fakeClient([citation(BASE, 4, 5)]), {
    mode: 'diff', changes: [{ oldPath: 'src/config.js', newPath: null, status: 'deleted', hunks: [{ oldStart: 1, oldCount: 8, newStart: 0, newCount: 0 }] }],
    readBase: reader({ 'src/config.js': BASE }), readHead: reader({}),
  });
  assert.equal(report.findings[0].verdict, 'drift');
  assert.match(report.findings[0].note, /was deleted/);
});

test('file mode: every citation on a listed file is checked against the working tree', async () => {
  const head = BASE.replace('3000', '8080');
  const refs = [citation(BASE, 4, 5), citation(BASE, 8, 8, { title: 'Other export' })];
  const seen = [];
  const report = await runCheck(fakeClient(refs, seen), {
    mode: 'files', changes: [{ oldPath: 'src/config.js', newPath: 'src/config.js', status: 'modified', hunks: [] }],
    readHead: reader({ 'src/config.js': head }), project: 'app',
  });
  assert.deepEqual(seen, [{ paths: ['src/config.js'], options: { project: 'app' } }]);
  assert.deepEqual(report.findings.map((f) => f.verdict), ['drift', 'holds']);
});

test('citations from another repository are counted as not checked, never reported', async () => {
  const foreign = citation(BASE, 4, 5);
  foreign.document.projectRepoUrl = 'git@gitlab.com:org/other.git';
  const checkout = { repoUrl: 'https://gitlab.com/org/app.git', hasCommit: () => false };
  const input = {
    mode: 'files', changes: [{ oldPath: 'src/config.js', newPath: 'src/config.js', status: 'modified', hunks: [] }],
    readHead: reader({ 'src/config.js': '' }), checkout,
  };
  let report = await runCheck(fakeClient([foreign]), input);
  assert.equal(report.findings.length, 0);
  assert.deepEqual(report.unchecked, { count: 1, reasons: ['other-repository'] });
  assert.match(formatCheck(report), /1 citation not checked \(cited in another repository\)/);
  // An explicit --project vouches for its citations.
  report = await runCheck(fakeClient([foreign]), { ...input, project: 'app' });
  assert.equal(report.findings[0].verdict, 'drift');
});

test('the comment body: a marker, a table of drifted memories, and how to fix them', async () => {
  const head = BASE.replace('3000', '8080');
  const report = await runCheck(fakeClient([citation(BASE, 4, 5, { title: 'Port | default' })]), {
    mode: 'diff', changes: diffOf([{ oldStart: 4, oldCount: 1, newStart: 4, newCount: 1 }]),
    readBase: reader({ 'src/config.js': BASE }), readHead: reader({ 'src/config.js': head }),
  });
  const body = formatCheckComment(report, new Date('2026-09-23T00:00:00Z'));
  assert.match(body, /^<!-- prax-check -->\n### Prax memory check/);
  assert.match(body, /:x: This change breaks the code cited by \*\*1\*\* memory/);
  assert.match(body, /#### Drifted/);
  assert.match(body, /\| Port \\\| default `doc-4` \| app · unverified · 3d old \| `src\/config\.js:4-5` \|/);
  assert.match(body, /prax supersede/);
  const skipped = formatCheckComment(skippedReport({ mode: 'diff', reason: 'Prax is not reachable' }));
  assert.match(skipped, /:warning: \*\*Skipped\*\* — Prax is not reachable/);
  assert.equal(checkExitCode(skippedReport({ mode: 'diff', reason: 'x' })), 0);
  assert.equal(checkExitCode(skippedReport({ mode: 'diff', reason: 'x' }), { strict: true }), 2);
});

// ---- end to end: temp git repository + throwaway Prax + the CLI --------------------------

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
};

function git(repo, ...args) {
  return execFileSync('git', args, { cwd: repo, env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' }).trim();
}

async function runCli(repo, args, { url, input, env = {} } = {}) {
  const child = execFile(process.execPath, [CLI, ...args], {
    cwd: repo,
    env: { ...process.env, ...GIT_ENV, PRAX_API_URL: url, PRAX_PROJECT: '', PRAX_TIMEOUT_MS: '3000', ...env },
  });
  if (input !== undefined) { child.child.stdin.end(input); } else { child.child.stdin.end(); }
  try {
    const { stdout, stderr } = await child;
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code, stdout: err.stdout, stderr: err.stderr };
  }
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'prax-check-e2e-'));
  const repo = join(directory, 'repo');
  await mkdir(join(repo, 'src'), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  await writeFile(join(repo, 'src', 'config.js'), BASE);
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  const base = git(repo, 'rev-parse', 'HEAD');

  const app = await buildApp({ config: loadConfig({ PRAX_DB_FILE: join(directory, 'prax.db'), EMBEDDING_BACKEND: 'none' }) });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });

  const remember = async (title, spec) => {
    const doc = (await app.inject({ method: 'POST', url: '/api/library/documents', payload: { title, body: `${title}.`, project: 'work', documentType: 'decision' } })).json();
    const pin = resolveCitation(spec, { readFile: (p) => (p === 'src/config.js' ? BASE : null), headSha: base });
    const res = await app.inject({ method: 'POST', url: `/api/library/documents/${doc.id}/code-refs`, payload: pin });
    assert.equal(res.statusCode, 201, res.body);
    return doc;
  };
  return { repo, base, url, app, remember };
}

test('prax check --diff exits 1 on drift the change introduced, with text, JSON and comment output', async (t) => {
  const { repo, base, url, remember } = await fixture(t);
  const doc = await remember('Default port is 3000', 'src/config.js:4-5');
  await remember('Other export exists', 'src/config.js:8');
  await writeFile(join(repo, 'src', 'config.js'), BASE.replace('3000', '8080'));
  git(repo, 'commit', '-q', '-am', 'change the port');

  const text = await runCli(repo, ['check', '--diff', `${base}..HEAD`], { url });
  assert.equal(text.code, 1, text.stderr);
  assert.match(text.stdout, /1 drifted, 0 already stale, 0 still hold/);
  assert.match(text.stdout, new RegExp(`DRIFT Default port is 3000 — ${doc.id}`));
  assert.match(text.stdout, /touched: line 4/);
  assert.doesNotMatch(text.stdout, /Other export/);

  const json = await runCli(repo, ['check', '--diff', `${base}..HEAD`, '--json'], { url });
  assert.equal(json.code, 1);
  const report = JSON.parse(json.stdout);
  assert.equal(report.status, 'drift');
  assert.equal(report.findings[0].document.id, doc.id);
  assert.equal(report.untouched, 1);

  const comment = await runCli(repo, ['check', '--diff', `main~1...main`, '--comment'], { url });
  assert.equal(comment.code, 1);
  assert.match(comment.stdout, /^<!-- prax-check -->/);
  assert.match(comment.stdout, /#### Drifted/);
});

test('prax check passes a change that leaves every cited line intact, and a working-tree diff', async (t) => {
  const { repo, base, url, remember } = await fixture(t);
  await remember('Default port is 3000', 'src/config.js:4-5');
  await writeFile(join(repo, 'src', 'config.js'), `// moved down\n${BASE.replace('other = 1', 'other = 2')}`);
  git(repo, 'commit', '-q', '-am', 'unrelated edit');
  const clean = await runCli(repo, ['check', '--diff', `${base}..HEAD`], { url });
  assert.equal(clean.code, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /No cited memories touched/);

  // Uncommitted edit: `--diff HEAD` compares against the working tree.
  await writeFile(join(repo, 'src', 'config.js'), BASE.replace('return { port };', 'return { port, host };'));
  const dirty = await runCli(repo, ['check', '--diff', 'HEAD'], { url });
  assert.equal(dirty.code, 1, dirty.stdout + dirty.stderr);
});

test('prax check --files and stdin check whole files against the working tree', async (t) => {
  const { repo, url, remember } = await fixture(t);
  await remember('Default port is 3000', 'src/config.js:4-5');
  let res = await runCli(repo, ['check', '--files', 'src/config.js'], { url });
  assert.equal(res.code, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /1 still hold/);
  await writeFile(join(repo, 'src', 'config.js'), BASE.replace('3000', '8080'));
  res = await runCli(repo, ['check'], { url, input: 'src/config.js\nREADME.md\n' });
  assert.equal(res.code, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /DRIFT Default port is 3000/);
});

test('fail-open: an unreachable Prax exits 0 with a warning; --strict exits 2', async (t) => {
  const { repo, base } = await fixture(t);
  await writeFile(join(repo, 'src', 'config.js'), BASE.replace('3000', '8080'));
  git(repo, 'commit', '-q', '-am', 'change');
  const dead = 'http://127.0.0.1:9';
  // Nothing changed = nothing to ask: Prax is not contacted at all.
  const empty = await runCli(repo, ['check', '--diff', 'HEAD..HEAD', '--strict'], { url: dead });
  assert.equal(empty.code, 0);
  assert.match(empty.stdout, /No cited memories touched/);
  const open = await runCli(repo, ['check', '--diff', `${base}..HEAD`], { url: dead });
  assert.equal(open.code, 0);
  assert.match(open.stderr, /prax check: skipped — Prax is not reachable at http:\/\/127\.0\.0\.1:9/);
  assert.match(open.stderr, /fail-open; pass --strict/);

  const comment = await runCli(repo, ['check', '--files', 'src/config.js', '--comment'], { url: dead });
  assert.equal(comment.code, 0);
  assert.match(comment.stdout, /\*\*Skipped\*\*/);

  const strict = await runCli(repo, ['check', '--diff', `${base}..HEAD`, '--strict'], { url: dead });
  assert.equal(strict.code, 2);
});

test('prax check exits 2 when it cannot run: bad range, usage, outside a checkout', async (t) => {
  const { repo, url } = await fixture(t);
  const badRange = await runCli(repo, ['check', '--diff', 'no-such-branch..HEAD'], { url });
  assert.equal(badRange.code, 2);
  assert.match(badRange.stderr, /unknown revision "no-such-branch"/);
  const both = await runCli(repo, ['check', '--diff', 'HEAD', '--files', 'a.js'], { url });
  assert.equal(both.code, 2);
  const unknownFlag = await runCli(repo, ['check', '--bogus'], { url });
  assert.equal(unknownFlag.code, 2);
  const outside = await runCli(tmpdir(), ['check', '--files', 'a.js'], { url, env: { GIT_CEILING_DIRECTORIES: tmpdir() } });
  assert.equal(outside.code, 2);
  assert.match(outside.stderr, /inside a git checkout/);
});
