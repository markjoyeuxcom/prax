import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';
import {
  applyPendingRestore, defaultTokenUsername, displayRemote, gitBackupPaths, pushUrl, remoteKind, validateSettings,
} from '../../server/gitBackup.js';

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' } });

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'prax-git-backup-test-'));
  const remote = join(directory, 'remote.git');
  mkdirSync(remote);
  git(['init', '--bare', '--quiet', '-b', 'main'], remote);
  const databaseFile = join(directory, 'data', 'prax.db');
  const open = () => buildApp({ config: loadConfig({ PRAX_DB_FILE: databaseFile, EMBEDDING_BACKEND: 'none' }), gitBackupSweep: false });
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  return { directory, remote, databaseFile, open };
}

async function call(app, method, url, payload, status = 200) {
  const response = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) });
  assert.equal(response.statusCode, status, `${method} ${url}: ${response.body}`);
  return response.json();
}

const createDoc = (app, title) => call(app, 'POST', '/api/library/documents', { title, body: `Body of ${title}`, project: 'memory', documentType: 'note' }, 201);

test('settings validation accepts SSH, HTTPS and local remotes and refuses embedded secrets', () => {
  assert.equal(remoteKind('git@gitlab.com:group/backups.git'), 'ssh');
  assert.equal(remoteKind('ssh://git@github.com/me/backups.git'), 'ssh');
  assert.equal(remoteKind('https://github.com/me/backups.git'), 'https');
  assert.equal(remoteKind('/srv/backups.git'), 'local');
  assert.equal(remoteKind('ftp://x'), null);
  assert.deepEqual(validateSettings({ remote: 'https://x:token@github.com/me/b.git' }).errors.length, 1);
  assert.ok(validateSettings({ remote: 'http://github.com/me/b.git' }).errors.some((e) => /https, not http/.test(e)));
  assert.ok(validateSettings({ remote: 'git@gitlab.com:g/b.git', auth: 'token' }).errors.some((e) => /HTTPS/.test(e)));
  assert.ok(validateSettings({ branch: 'bad..name' }).errors.length);
  assert.ok(validateSettings({ auth: 'password' }).errors.length);
  assert.ok(validateSettings({ scheduleEnabled: 'yes' }).errors.length);
  const ok = validateSettings({ remote: ' https://gitlab.com/g/b.git ', branch: '', auth: 'token', username: '' });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.settings.remote, 'https://gitlab.com/g/b.git');
  assert.equal(ok.settings.branch, 'main');
  assert.equal(defaultTokenUsername('https://github.com/me/b.git'), 'x-access-token');
  assert.equal(defaultTokenUsername('https://gitlab.example.com/g/b.git'), 'oauth2');
  assert.equal(pushUrl({ remote: 'https://github.com/me/b.git', auth: 'token', username: '' }), 'https://x-access-token@github.com/me/b.git');
  assert.equal(pushUrl({ remote: 'git@github.com:me/b.git', auth: 'ssh' }), 'git@github.com:me/b.git');
  assert.equal(displayRemote('https://oauth2@gitlab.com/g/b.git'), 'https://gitlab.com/g/b.git');
});

test('git backup is unavailable without the persistent database', async () => {
  const app = await buildApp({ skipDb: true, config: loadConfig({}) });
  await call(app, 'GET', '/api/workspace/git-backup', undefined, 503);
  await app.close();
});

test('backs up to a repository, skips unchanged runs, lists history, stages a restore and applies it at the next start', async (t) => {
  const { directory, remote, databaseFile, open } = await workspace(t);
  let app = await open();

  const unconfigured = await call(app, 'GET', '/api/workspace/git-backup');
  assert.equal(unconfigured.configured, false);
  await call(app, 'POST', '/api/workspace/git-backup/run', {}, 409);

  const saved = await call(app, 'PUT', '/api/workspace/git-backup', { remote, branch: 'main', auth: 'ssh' });
  assert.equal(saved.configured, true);
  assert.equal(saved.remote, remote);
  assert.equal(saved.hasToken, false);

  const first = await createDoc(app, 'Keep me');
  const run1 = await call(app, 'POST', '/api/workspace/git-backup/run', {});
  assert.equal(run1.changed, true);
  assert.match(run1.commit, /^[a-f0-9]{40}$/);
  assert.equal(run1.error, null);
  const tree = git(['ls-tree', '-r', '--name-only', 'main'], remote).trim().split('\n');
  assert.ok(tree.includes('prax.db'));
  assert.ok(tree.includes('manifest.json'));
  assert.ok(tree.includes('RESTORE.md'));
  assert.ok(tree.includes('tasks.json'));
  assert.ok(tree.some((path) => path.startsWith('library/memory/') && path.endsWith('keep-me.md')), tree.join('\n'));
  const manifest = JSON.parse(git(['show', 'main:manifest.json'], remote));
  assert.equal(manifest.format, 'prax.workspace-backup');
  assert.equal(manifest.database.sha256, run1.sha256);
  assert.equal(manifest.source, 'git-backup');

  // Nothing changed: no second commit.
  const run2 = await call(app, 'POST', '/api/workspace/git-backup/run', {});
  assert.equal(run2.changed, false);
  assert.equal(run2.commit, run1.commit);
  assert.equal(git(['rev-list', '--count', 'main'], remote).trim(), '1');

  const second = await createDoc(app, 'Lose me');
  const run3 = await call(app, 'POST', '/api/workspace/git-backup/run', {});
  assert.equal(run3.changed, true);
  assert.notEqual(run3.commit, run1.commit);
  assert.equal(git(['rev-list', '--count', 'main'], remote).trim(), '2');

  const status = await call(app, 'GET', '/api/workspace/git-backup');
  assert.equal(status.lastBackup.commit, run3.commit);
  assert.equal(status.pendingRestore, null);

  const history = await call(app, 'GET', '/api/workspace/git-backup/history');
  assert.equal(history.backups.length, 2);
  assert.equal(history.backups[0].commit, run3.commit);
  assert.equal(history.backups[1].commit, run1.commit);
  assert.equal(history.backups[1].sha256, run1.sha256);
  assert.match(history.backups[0].subject, /^Prax backup /);

  await call(app, 'POST', '/api/workspace/git-backup/restore', { commit: 'nope' }, 400);
  await call(app, 'POST', '/api/workspace/git-backup/restore', { commit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }, 404);
  const staged = await call(app, 'POST', '/api/workspace/git-backup/restore', { commit: run1.commit.slice(0, 12) }, 202);
  assert.equal(staged.commit, run1.commit);
  assert.equal(staged.sha256, run1.sha256);
  const paths = gitBackupPaths(databaseFile);
  assert.ok(existsSync(join(paths.pending, 'prax.db')));
  const pending = await call(app, 'GET', '/api/workspace/git-backup');
  assert.equal(pending.pendingRestore.commit, run1.commit);

  // Both documents are still live: staging never touches the open database.
  await call(app, 'GET', `/api/library/documents/${second.id}`);
  await app.close();

  // The next start applies the staged restore.
  app = await open();
  await call(app, 'GET', `/api/library/documents/${first.id}`);
  await call(app, 'GET', `/api/library/documents/${second.id}`, undefined, 404);
  const after = await call(app, 'GET', '/api/workspace/git-backup');
  assert.equal(after.pendingRestore, null);
  assert.equal(after.lastRestore.ok, true);
  assert.equal(after.lastRestore.commit, run1.commit);
  assert.ok(after.lastRestore.rollbackDir.startsWith(join(directory, 'data', 'restore-rollback-')));
  assert.ok(existsSync(join(after.lastRestore.rollbackDir, 'prax.db')));
  assert.ok(!existsSync(paths.pending));

  // Cancelling a staged restore removes it.
  await call(app, 'POST', '/api/workspace/git-backup/restore', { commit: run3.commit }, 202);
  assert.deepEqual(await call(app, 'DELETE', '/api/workspace/git-backup/restore'), { cancelled: true });
  assert.ok(!existsSync(paths.pending));
  await app.close();
});

test('a token is kept beside the database, never in it, and never returned', async (t) => {
  const { databaseFile, open } = await workspace(t);
  const app = await open();
  const saved = await call(app, 'PUT', '/api/workspace/git-backup', { remote: 'https://gitlab.com/group/backups.git', auth: 'token', token: 'glpat-secret-value' });
  assert.equal(saved.hasToken, true);
  assert.equal(saved.username, '');
  assert.ok(!JSON.stringify(saved).includes('glpat-secret-value'));
  const paths = gitBackupPaths(databaseFile);
  assert.equal(readFileSync(paths.token, 'utf8').trim(), 'glpat-secret-value');
  const stored = await app.appSettingsRepository.getSetting('git_backup', null);
  assert.ok(!JSON.stringify(stored).includes('glpat-secret-value'));
  await call(app, 'PUT', '/api/workspace/git-backup', { token: '' });
  assert.ok(!existsSync(paths.token));
  // A token with an SSH remote is refused.
  const refused = await call(app, 'PUT', '/api/workspace/git-backup', { remote: 'git@gitlab.com:group/backups.git', auth: 'token' }, 400);
  assert.match(refused.message, /HTTPS/);
  await app.close();
});

test('a staged restore from a newer Prax or with a changed file is refused and the live database stays', async (t) => {
  const { databaseFile, open } = await workspace(t);
  let app = await open();
  const doc = await createDoc(app, 'Still here');
  const paths = gitBackupPaths(databaseFile);
  // Stage by hand: a copy of the live database claiming a newer Prax.
  mkdirSync(paths.pending, { recursive: true });
  await app.db.snapshot(join(paths.pending, 'prax.db'));
  const { validateSqliteBackup } = await import('../../server/sqliteBackup.js');
  const proof = validateSqliteBackup(join(paths.pending, 'prax.db'));
  writeFileSync(join(paths.pending, 'manifest.json'), JSON.stringify({ format: 'prax.workspace-backup', version: 1, praxVersion: '99.0.0', schema: { finalMigration: '0001' }, database: { sha256: proof.sha256 } }));
  writeFileSync(join(paths.pending, 'restore.json'), JSON.stringify({ commit: 'abc', sha256: proof.sha256 }));
  await app.close();

  const outcome = applyPendingRestore(databaseFile);
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /newer|99\.0\.0/i);
  assert.ok(!existsSync(paths.pending));
  assert.ok(readdirSync(join(databaseFile, '..')).some((name) => name.startsWith('restore-failed-')));
  assert.ok(!readdirSync(join(databaseFile, '..')).some((name) => name.startsWith('restore-rollback-')));

  app = await open();
  await call(app, 'GET', `/api/library/documents/${doc.id}`);
  const status = await call(app, 'GET', '/api/workspace/git-backup');
  assert.equal(status.lastRestore.ok, false);
  await app.close();
});

// A loopback git server with HTTP Basic auth in front of the bare repository
// (git http-backend over CGI): proves the token path end to end — the askpass
// helper answers git's prompt, a wrong token is refused and reported as such,
// and the token never appears in a response or in the recorded error.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

function gitHttpServer(root, { username, token }) {
  const expected = `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`;
  const server = createServer((request, response) => {
    if (request.headers.authorization !== expected) {
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="prax-test"' });
      response.end('auth required');
      return;
    }
    const url = new URL(request.url, 'http://127.0.0.1');
    const env = {
      ...process.env, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: '1', PATH_INFO: url.pathname, QUERY_STRING: url.search.slice(1),
      REQUEST_METHOD: request.method, CONTENT_TYPE: request.headers['content-type'] || '', REMOTE_USER: username, REMOTE_ADDR: '127.0.0.1',
    };
    const backend = spawn('git', ['http-backend'], { env });
    request.pipe(backend.stdin);
    let head = Buffer.alloc(0); let headersDone = false;
    backend.stdout.on('data', (chunk) => {
      if (headersDone) { response.write(chunk); return; }
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end === -1) return;
      const headers = {}; let status = 200;
      for (const line of head.subarray(0, end).toString().split('\r\n')) {
        const [name, ...rest] = line.split(':');
        if (name.toLowerCase() === 'status') status = Number(rest.join(':').trim().split(' ')[0]);
        else headers[name.trim()] = rest.join(':').trim();
      }
      response.writeHead(status, headers);
      headersDone = true;
      response.write(head.subarray(end + 4));
    });
    backend.on('close', () => response.end());
  });
  return server;
}

test('an HTTPS token signs in through the askpass helper, a wrong token is refused, and the token stays out of responses', async (t) => {
  const { directory, remote, open } = await workspace(t);
  const username = 'oauth2', token = 'glpat-test-token-value';
  const server = gitHttpServer(directory, { username, token });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/remote.git`;
  const app = await open();

  await call(app, 'PUT', '/api/workspace/git-backup', { remote: url, branch: 'main', auth: 'token', username, token: 'wrong-token' });
  await createDoc(app, 'Token doc');
  const refused = await call(app, 'POST', '/api/workspace/git-backup/run', {}, 500);
  assert.equal(refused.code, 'GIT_AUTH', refused.message);
  assert.ok(!JSON.stringify(refused).includes('wrong-token'));
  const failedStatus = await call(app, 'GET', '/api/workspace/git-backup');
  assert.ok(!JSON.stringify(failedStatus).includes('wrong-token'));
  assert.equal(failedStatus.lastBackup.error.code, 'GIT_AUTH');

  await call(app, 'PUT', '/api/workspace/git-backup', { token });
  const run = await call(app, 'POST', '/api/workspace/git-backup/run', {});
  assert.equal(run.changed, true);
  assert.equal(git(['rev-list', '--count', 'main'], remote).trim(), '1');
  assert.ok(!JSON.stringify(run).includes(token));
  const history = await call(app, 'GET', '/api/workspace/git-backup/history');
  assert.equal(history.backups.length, 1);
  const staged = await call(app, 'POST', '/api/workspace/git-backup/restore', { commit: run.commit }, 202);
  assert.equal(staged.commit, run.commit);
  assert.ok(!JSON.stringify(await call(app, 'GET', '/api/workspace/git-backup')).includes(token));
  await app.close();
});
