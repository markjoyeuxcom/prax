// Git backup and restore (docs/backup-restore.md, "Git backup"). A private
// GitHub or GitLab repository holds one commit per backup: the validated
// SQLite snapshot the Full workspace backup already produces, its manifest,
// the bundled restore guide, and a readable Markdown copy of the Library.
// Restore stages the chosen commit's database beside the live one and the
// next start swaps it in: the server never replaces the file it has open.
//
// SQLite stays the single source of truth; git is a transport and a history.
// The system `git` does the work (SSH keys and HTTPS tokens both work the
// way they do on the command line); Prax never prompts, never stores the
// token in the database it backs up, and never writes to the repository
// except through its own clone under the data directory.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, readdirSync, unlinkSync,
} from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { assertRestorableSchema, finalSchemaVersion, restoreDatabaseFromBackup, validateSqliteBackup } from './sqliteBackup.js';
import { WORKSPACE_BACKUP_FORMAT, WORKSPACE_BACKUP_VERSION, assertManifestRestorable, praxVersion } from './backupManifest.js';

const execFileAsync = promisify(execFile);

export const GIT_BACKUP_SETTING = 'git_backup';
export const GIT_BACKUP_LAST_RUN_SETTING = 'git_backup_last_scheduled_run_at';
export const SCHEDULED_RUN_EVERY_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
export const HISTORY_LIMIT = 50;
export const GIT_TIMEOUT_MS = 10 * 60 * 1000;
// GitHub and GitLab refuse a single file above 100 MB; warn well before.
export const LARGE_SNAPSHOT_BYTES = 90 * 1024 * 1024;
export const AUTH_MODES = ['ssh', 'token'];
const COMMIT_SUBJECT = 'Prax backup';
const DEFAULT_SETTINGS = Object.freeze({ remote: '', branch: 'main', auth: 'ssh', username: '', scheduleEnabled: false });

// ---- paths ------------------------------------------------------------------
// Everything lives beside the database: <dir>/git-backup/{repo,token,askpass.sh,
// last-backup.json,last-restore.json} and <dir>/restore-pending/ for a staged
// restore. A ':memory:' database has no directory and no git backup.
export function gitBackupPaths(databaseFile) {
  if (!databaseFile || databaseFile === ':memory:') return null;
  const dataDir = dirname(resolve(databaseFile));
  const root = join(dataDir, 'git-backup');
  return {
    dataDir,
    databaseFile: resolve(databaseFile),
    root,
    repo: join(root, 'repo'),
    token: join(root, 'token'),
    askpass: join(root, 'askpass.sh'),
    lastBackup: join(root, 'last-backup.json'),
    lastRestore: join(root, 'last-restore.json'),
    pending: join(dataDir, 'restore-pending'),
  };
}

// ---- settings ---------------------------------------------------------------
const SSH_SCP = /^[\w.-]+@[\w.-]+:[\w./~-]+$/;
const URL_FORM = /^(ssh|https|file):\/\/\S+$/;

// Plain http is accepted for loopback only (a local test server); anything
// else must be https so a token never travels in the clear.
const LOOPBACK_HTTP = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/;

export function remoteKind(remote) {
  const value = String(remote || '').trim();
  if (!value) return null;
  if (/^https:\/\//.test(value) || LOOPBACK_HTTP.test(value)) return 'https';
  if (/^ssh:\/\//.test(value) || SSH_SCP.test(value)) return 'ssh';
  if (/^file:\/\//.test(value) || value.startsWith('/')) return 'local';
  return null;
}

export function validateSettings(patch, current = DEFAULT_SETTINGS) {
  const next = { ...DEFAULT_SETTINGS, ...current };
  const errors = [];
  if (patch.remote !== undefined) {
    const remote = String(patch.remote ?? '').trim();
    if (remote && !remoteKind(remote)) errors.push('remote must be an SSH (git@host:group/repo.git), HTTPS (https://host/group/repo.git) or local repository address');
    if (/^https?:\/\/[^/]*:[^/@]*@/.test(remote)) errors.push('remote must not embed a password or token; use the token field');
    if (/^http:\/\//.test(remote) && !LOOPBACK_HTTP.test(remote)) errors.push('remote must use https, not http');
    next.remote = remote;
  }
  if (patch.branch !== undefined) {
    const branch = String(patch.branch ?? '').trim() || 'main';
    if (!/^[\w][\w./-]*$/.test(branch) || branch.includes('..') || branch.endsWith('/') || branch.endsWith('.lock')) errors.push('branch is not a valid git branch name');
    next.branch = branch;
  }
  if (patch.auth !== undefined) {
    if (!AUTH_MODES.includes(patch.auth)) errors.push(`auth must be ${AUTH_MODES.join(' or ')}`);
    else next.auth = patch.auth;
  }
  if (patch.username !== undefined) {
    const username = String(patch.username ?? '').trim();
    if (/[\s/@:]/.test(username)) errors.push('username must not contain spaces, slashes, @ or :');
    next.username = username;
  }
  if (patch.scheduleEnabled !== undefined) {
    if (typeof patch.scheduleEnabled !== 'boolean') errors.push('scheduleEnabled must be true or false');
    else next.scheduleEnabled = patch.scheduleEnabled;
  }
  if (patch.token !== undefined && typeof patch.token !== 'string') errors.push('token must be a string');
  if (next.auth === 'token' && next.remote && remoteKind(next.remote) !== 'https') errors.push('a token needs an HTTPS remote');
  return { settings: next, errors };
}

// The username git sends with a token. GitHub accepts any username with a
// personal access token; GitLab accepts `oauth2` with a project or personal
// token. Either can be overridden in the settings.
export function defaultTokenUsername(remote) {
  try {
    const host = new URL(remote).hostname;
    if (/(^|\.)github\.com$/.test(host)) return 'x-access-token';
    if (/gitlab/.test(host)) return 'oauth2';
  } catch { /* not a URL */ }
  return 'oauth2';
}

// The URL git talks to: the username goes in the URL so an askpass helper is
// only asked for the password. Never logged or returned to a client.
export function pushUrl(settings) {
  if (settings.auth !== 'token' || remoteKind(settings.remote) !== 'https') return settings.remote;
  const url = new URL(settings.remote);
  url.username = settings.username || defaultTokenUsername(settings.remote);
  return url.toString();
}

// What a client sees: the remote without any user part, never the token.
export function displayRemote(remote) {
  if (remoteKind(remote) !== 'https') return remote;
  try { const url = new URL(remote); url.username = ''; url.password = ''; return url.toString(); } catch { return remote; }
}

// ---- git --------------------------------------------------------------------
export function createGitRunner({ git = process.env.PRAX_GIT || 'git', paths, env = process.env, timeoutMs = GIT_TIMEOUT_MS } = {}) {
  async function run(args, { cwd = paths?.repo, secret = null, allowFailure = false } = {}) {
    const runEnv = {
      ...env,
      GIT_TERMINAL_PROMPT: '0',
      // Never block on a host-key or passphrase prompt: fail and report instead.
      GIT_SSH_COMMAND: env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes',
      GIT_CONFIG_NOSYSTEM: env.GIT_CONFIG_NOSYSTEM ?? '1',
      LC_ALL: 'C',
    };
    delete runEnv.GIT_DIR; delete runEnv.GIT_WORK_TREE;
    if (secret) {
      runEnv.GIT_ASKPASS = paths.askpass;
      runEnv.PRAX_GIT_BACKUP_SECRET = secret;
    }
    try {
      const { stdout, stderr } = await execFileAsync(git, args, { cwd, env: runEnv, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
      return { ok: true, stdout, stderr, code: 0 };
    } catch (error) {
      const result = { ok: false, stdout: error.stdout || '', stderr: error.stderr || '', code: error.code, error };
      if (allowFailure) return result;
      throw gitError(args, result, secret);
    }
  }
  async function version() {
    try {
      const { stdout } = await execFileAsync(git, ['--version'], { env: { ...env, GIT_TERMINAL_PROMPT: '0' }, timeout: 15000, windowsHide: true });
      return stdout.trim();
    } catch {
      return null;
    }
  }
  return { run, version, git };
}

export class GitBackupError extends Error {
  constructor(message, { code = 'GIT_BACKUP_FAILED', status = 500, detail } = {}) {
    super(message);
    this.code = code; this.status = status; this.detail = detail;
  }
}

function gitError(args, result, secret) {
  const text = scrub(`${result.stderr || ''}\n${result.stdout || ''}`.trim(), secret);
  const lower = text.toLowerCase();
  let message = `git ${args[0]} failed`;
  let code = 'GIT_FAILED';
  if (/could not read username|authentication failed|invalid username or password|http basic: access denied|403/.test(lower)) { message = 'The repository refused the credentials. Check the token or SSH key and that it may write to this repository.'; code = 'GIT_AUTH'; }
  else if (/repository not found|does not appear to be a git repository|repository '.*' not found/.test(lower)) { message = 'The repository was not found. Create it first (private) and check the address.'; code = 'GIT_REMOTE'; }
  else if (/permission denied \(publickey\)|host key verification failed|could not resolve hostname|connection (refused|timed out)|could not read from remote repository/.test(lower)) { message = 'Prax could not reach the repository over SSH. Check the address, the host key and that the key is loaded (ssh -T).'; code = 'GIT_REMOTE'; }
  else if (/enoent/.test(lower) || result.error?.code === 'ENOENT') { message = 'git is not installed or not on the PATH Prax runs with (set PRAX_GIT to its path).'; code = 'GIT_MISSING'; }
  else if (/rejected|non-fast-forward|fetch first/.test(lower)) { message = 'The remote branch moved since the last backup. Prax only appends to its own branch; restore from the remote history or use a new branch.'; code = 'GIT_DIVERGED'; }
  return new GitBackupError(message, { code, detail: text.slice(-2000) });
}

function scrub(text, secret) {
  if (!secret) return text;
  return text.split(secret).join('[redacted]');
}

// ---- files beside the database ----------------------------------------------
function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, path);
}

export function readToken(paths) {
  try { return readFileSync(paths.token, 'utf8').replace(/\r?\n$/, ''); } catch { return ''; }
}

async function writeToken(paths, token) {
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  await chmod(paths.root, 0o700).catch(() => {});
  if (!token) { await rm(paths.token, { force: true }); return; }
  await writeFile(paths.token, `${token}\n`, { mode: 0o600 });
  await chmod(paths.token, 0o600);
}

async function ensureAskpass(paths) {
  const body = '#!/bin/sh\n# Written by Prax: answers git\'s password prompt from the environment.\nprintf \'%s\\n\' "$PRAX_GIT_BACKUP_SECRET"\n';
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  await writeFile(paths.askpass, body, { mode: 0o700 });
  await chmod(paths.askpass, 0o700);
}

export function pendingRestoreInfo(paths) {
  if (!paths) return null;
  const info = readJson(join(paths.pending, 'restore.json'));
  if (!info || !existsSync(join(paths.pending, 'prax.db'))) return null;
  return info;
}

// ---- the readable copy --------------------------------------------------------
// library/<project>/<file>.md (retired/ for superseded and deprecated) rendered
// by the one Library exporter, plus tasks.json from the task export. Both are
// for people reading the repository; restore uses prax.db only.
async function readableCopy(app) {
  const files = new Map();
  const library = await app.inject({ method: 'GET', url: '/api/library/export?project=all&format=json&layout=mirror&includeArchived=false' });
  if (library.statusCode === 200) {
    for (const doc of library.json().documents || []) files.set(`library/${doc.path}`, doc.markdown);
  }
  const tasks = await app.inject({ method: 'GET', url: '/api/tasks/export?project=all' });
  if (tasks.statusCode === 200) files.set('tasks.json', `${JSON.stringify(tasks.json(), null, 2)}\n`);
  return files;
}

async function syncReadableCopy(repo, files) {
  const libraryDir = join(repo, 'library');
  await rm(libraryDir, { recursive: true, force: true });
  for (const [path, body] of files) {
    const target = join(repo, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
  }
  if (!files.has('tasks.json')) await rm(join(repo, 'tasks.json'), { force: true });
}

// ---- the service ---------------------------------------------------------------
export function createGitBackupService({ app, db, appSettings, paths, git, log, now = () => new Date() }) {
  let busy = null;

  async function settings() {
    const stored = await appSettings.getSetting(GIT_BACKUP_SETTING, null).catch(() => null);
    return { ...DEFAULT_SETTINGS, ...(stored && typeof stored === 'object' ? stored : {}) };
  }

  async function status() {
    const current = await settings();
    const [gitVersion, lastRun] = await Promise.all([
      git.version(),
      appSettings.getSetting(GIT_BACKUP_LAST_RUN_SETTING, null).catch(() => null),
    ]);
    const lastBackup = readJson(paths.lastBackup);
    const lastRestore = readJson(paths.lastRestore);
    return {
      configured: Boolean(current.remote),
      remote: displayRemote(current.remote),
      branch: current.branch,
      auth: current.auth,
      username: current.username,
      hasToken: Boolean(readToken(paths)),
      scheduleEnabled: current.scheduleEnabled,
      lastScheduledRunAt: lastRun ?? null,
      gitAvailable: Boolean(gitVersion),
      gitVersion,
      busy: busy ? busy.kind : null,
      lastBackup,
      lastRestore,
      pendingRestore: pendingRestoreInfo(paths),
      largeSnapshotBytes: LARGE_SNAPSHOT_BYTES,
    };
  }

  async function update(patch) {
    const current = await settings();
    const { settings: next, errors } = validateSettings(patch, current);
    if (errors.length) throw new GitBackupError(errors.join('; '), { code: 'INVALID', status: 400 });
    await appSettings.putSetting(GIT_BACKUP_SETTING, next);
    if (patch.token !== undefined) await writeToken(paths, patch.token.trim());
    // A changed remote invalidates the clone; the next run clones afresh.
    if (patch.remote !== undefined && patch.remote !== current.remote) await rm(paths.repo, { recursive: true, force: true });
    return status();
  }

  function secretFor(current) {
    if (current.auth !== 'token') return null;
    const token = readToken(paths);
    if (!token) throw new GitBackupError('No token is saved. Enter the repository token in Settings.', { code: 'NO_TOKEN', status: 409 });
    return token;
  }

  async function requireConfigured() {
    const current = await settings();
    if (!current.remote) throw new GitBackupError('Git backup is not configured. Enter the repository address in Settings.', { code: 'NOT_CONFIGURED', status: 409 });
    if (!(await git.version())) throw new GitBackupError('git is not installed or not on the PATH Prax runs with (set PRAX_GIT to its path).', { code: 'GIT_MISSING', status: 503 });
    return current;
  }

  function lock(kind) {
    if (busy) throw new GitBackupError(`A git ${busy.kind} is already running. Retry when it finishes.`, { code: 'BUSY', status: 409 });
    busy = { kind, startedAt: now().toISOString() };
    return () => { busy = null; };
  }

  // The clone: created on first use, its remote URL re-pointed every run so a
  // username change or saved token applies, and fetched before each run.
  async function prepareRepo(current, secret) {
    const url = pushUrl(current);
    const runOptions = { secret };
    if (secret) await ensureAskpass(paths);
    if (!existsSync(join(paths.repo, '.git'))) {
      await rm(paths.repo, { recursive: true, force: true });
      await mkdir(paths.repo, { recursive: true, mode: 0o700 });
      await git.run(['init', '--quiet', '-b', current.branch], { cwd: paths.repo });
      await git.run(['remote', 'add', 'origin', url]);
    } else {
      await git.run(['remote', 'set-url', 'origin', url]);
    }
    await git.run(['config', 'user.name', 'Prax']);
    await git.run(['config', 'user.email', 'prax@localhost']);
    await git.run(['config', 'core.autocrlf', 'false']);
    await git.run(['config', 'gc.auto', '0']);
    // The remote branch may not exist yet (a new, empty repository).
    const fetched = await git.run(['fetch', '--quiet', 'origin', current.branch], { ...runOptions, allowFailure: true });
    if (!fetched.ok) {
      const text = `${fetched.stderr}\n${fetched.stdout}`.toLowerCase();
      const emptyRemote = /couldn't find remote ref|remote branch .* not found|fatal: couldn't find remote ref/.test(text)
        || (/warning: you appear to have cloned an empty repository|fatal: no such ref/.test(text));
      if (!emptyRemote) throw gitError(['fetch'], fetched, secret);
      return { remoteBranch: null };
    }
    // Local state is disposable: the remote branch is the truth.
    await git.run(['checkout', '--quiet', '-B', current.branch, 'FETCH_HEAD']);
    const { stdout } = await git.run(['rev-parse', 'FETCH_HEAD']);
    return { remoteBranch: stdout.trim() };
  }

  async function run({ trigger = 'manual' } = {}) {
    const current = await requireConfigured();
    const release = lock('backup');
    const startedAt = now();
    try {
      const secret = secretFor(current);
      const { remoteBranch } = await prepareRepo(current, secret);
      // Snapshot into a private temporary file first; the validated copy then
      // moves into the clone so git never sees a half-written database.
      const scratch = await mkdtemp(join(tmpdir(), 'prax-git-backup-'));
      let proof, manifest;
      try {
        const snapshot = join(scratch, 'prax.db');
        await db.snapshot(snapshot);
        await chmod(snapshot, 0o600);
        proof = validateSqliteBackup(snapshot);
        manifest = {
          format: WORKSPACE_BACKUP_FORMAT, version: WORKSPACE_BACKUP_VERSION, praxVersion: praxVersion(),
          schema: { finalMigration: finalSchemaVersion(snapshot) },
          createdAt: startedAt.toISOString(),
          database: { file: 'prax.db', sha256: proof.sha256, bytes: proof.bytes, integrityCheck: proof.integrityCheck, foreignKeyViolations: proof.foreignKeyViolations },
          includes: ['all committed SQLite tables', 'all projects and archived content', 'provider settings and saved credentials', 'a readable Markdown copy of the Library and a JSON copy of the tasks'],
          excludes: ['unsaved drafts', 'browser-only preferences and pending decisions', 'the git backup token', 'external files and environment configuration'],
          source: 'git-backup',
        };
        await rename(snapshot, join(paths.repo, 'prax.db')).catch(async () => {
          // Across filesystems rename fails; copy then remove.
          await writeFile(join(paths.repo, 'prax.db'), await readFile(snapshot), { mode: 0o600 });
        });
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
      await writeFile(join(paths.repo, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      const guide = await readFile(new URL('../public/starter-content/workspace-restore.md', import.meta.url), 'utf8');
      await writeFile(join(paths.repo, 'RESTORE.md'), guide);
      await writeFile(join(paths.repo, '.gitattributes'), 'prax.db binary\n');
      await syncReadableCopy(paths.repo, await readableCopy(app));

      await git.run(['add', '--all']);
      // The database decides whether anything happened: every write moves
      // it, while manifest.json and tasks.json carry a timestamp that moves
      // on every run. An unchanged database means no commit, and the
      // regenerated files are discarded so the clone stays at the remote.
      const diff = await git.run(['diff', '--cached', '--quiet', '--', 'prax.db'], { allowFailure: true });
      let commit = remoteBranch, changed = false;
      if (diff.ok && remoteBranch) {
        await git.run(['reset', '--hard', '--quiet', remoteBranch]);
      } else {
        changed = true;
        const subject = `${COMMIT_SUBJECT} ${startedAt.toISOString()} (v${manifest.praxVersion})`;
        await git.run(['commit', '--quiet', '-m', subject, '-m', `sha256 ${proof.sha256}\nbytes ${proof.bytes}\ntrigger ${trigger}`]);
        await git.run(['push', '--quiet', 'origin', `${current.branch}:${current.branch}`], { secret });
        commit = (await git.run(['rev-parse', 'HEAD'])).stdout.trim();
      }
      const report = {
        at: startedAt.toISOString(), finishedAt: now().toISOString(), trigger, changed, commit,
        bytes: proof.bytes, sha256: proof.sha256, branch: current.branch, remote: displayRemote(current.remote),
        large: proof.bytes >= LARGE_SNAPSHOT_BYTES, error: null,
      };
      await writeJson(paths.lastBackup, report);
      log?.info?.({ commit, changed, bytes: proof.bytes }, 'git backup finished');
      return report;
    } catch (error) {
      const failure = error instanceof GitBackupError ? error : new GitBackupError(scrub(error.message, readToken(paths)), { detail: scrub(String(error.stack || ''), readToken(paths)).slice(-2000) });
      await writeJson(paths.lastBackup, { at: startedAt.toISOString(), finishedAt: now().toISOString(), trigger, changed: false, commit: null, error: { code: failure.code, message: failure.message, detail: failure.detail ?? null } }).catch(() => {});
      log?.warn?.({ err: failure }, 'git backup failed');
      throw failure;
    } finally {
      release();
    }
  }

  async function history({ limit = HISTORY_LIMIT } = {}) {
    const current = await requireConfigured();
    const release = lock('history');
    try {
      const secret = secretFor(current);
      const { remoteBranch } = await prepareRepo(current, secret);
      if (!remoteBranch) return { branch: current.branch, backups: [] };
      const format = '%H%x1f%cI%x1f%s%x1f%b%x1e';
      const { stdout } = await git.run(['log', `--max-count=${Math.min(Math.max(1, Number(limit) || HISTORY_LIMIT), 500)}`, `--format=${format}`, '--', 'prax.db']);
      const backups = stdout.split('\x1e').map((line) => line.trim()).filter(Boolean).map((line) => {
        const [commit, at, subject, body = ''] = line.split('\x1f');
        const sha256 = /sha256 ([a-f0-9]{64})/.exec(body)?.[1] ?? null;
        const bytes = Number(/bytes (\d+)/.exec(body)?.[1]) || null;
        const praxVersion = /\(v([^)]+)\)/.exec(subject)?.[1] ?? null;
        return { commit, at, subject, sha256, bytes, praxVersion };
      });
      return { branch: current.branch, backups };
    } finally {
      release();
    }
  }

  // Stage a restore: the commit's prax.db and manifest.json land in
  // restore-pending/ after every guard the restore command applies. Nothing
  // touches the live database; applyPendingRestore does that at the next start.
  async function stageRestore({ commit } = {}) {
    if (!/^[a-f0-9]{7,40}$/i.test(String(commit || ''))) throw new GitBackupError('commit must be a git commit id', { code: 'INVALID', status: 400 });
    const current = await requireConfigured();
    const release = lock('restore');
    try {
      const secret = secretFor(current);
      const { remoteBranch } = await prepareRepo(current, secret);
      if (!remoteBranch) throw new GitBackupError('The remote branch holds no backups yet.', { code: 'NO_BACKUPS', status: 409 });
      const resolved = await git.run(['rev-parse', '--verify', `${commit}^{commit}`], { allowFailure: true });
      if (!resolved.ok) throw new GitBackupError('That commit is not in the backup branch.', { code: 'UNKNOWN_COMMIT', status: 404 });
      const full = resolved.stdout.trim();
      const reachable = await git.run(['merge-base', '--is-ancestor', full, remoteBranch], { allowFailure: true });
      if (!reachable.ok) throw new GitBackupError('That commit is not in the backup branch.', { code: 'UNKNOWN_COMMIT', status: 404 });

      const staging = `${paths.pending}.${process.pid}.tmp`;
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true, mode: 0o700 });
      try {
        const manifestText = (await git.run(['show', `${full}:manifest.json`], { allowFailure: true }));
        if (!manifestText.ok) throw new GitBackupError('That commit has no manifest.json; it is not a Prax backup.', { code: 'NOT_A_BACKUP', status: 409 });
        let manifest;
        try { manifest = JSON.parse(manifestText.stdout); } catch { throw new GitBackupError('The manifest in that commit is not valid JSON.', { code: 'NOT_A_BACKUP', status: 409 }); }
        try { assertManifestRestorable(manifest); } catch (error) { throw new GitBackupError(error.message, { code: 'NOT_RESTORABLE', status: 409 }); }
        const dbPath = join(staging, 'prax.db');
        // git show streams the blob; cat-file with --filters keeps it byte-exact.
        await new Promise((resolvePromise, reject) => {
          const child = execFile(git.git, ['cat-file', 'blob', `${full}:prax.db`], { cwd: paths.repo, maxBuffer: Infinity, encoding: 'buffer', timeout: GIT_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
            if (error) return reject(new GitBackupError('That commit has no prax.db; it is not a Prax backup.', { code: 'NOT_A_BACKUP', status: 409 }));
            try { writeFileSync(dbPath, stdout, { mode: 0o600 }); resolvePromise(); } catch (writeError) { reject(writeError); }
          });
          child.on('error', reject);
        });
        const proof = validateSqliteBackup(dbPath);
        if (manifest.database?.sha256 && manifest.database.sha256.toLowerCase() !== proof.sha256) {
          throw new GitBackupError('The database in that commit does not match its manifest checksum.', { code: 'CHECKSUM', status: 409 });
        }
        try { assertRestorableSchema(dbPath); } catch (error) { throw new GitBackupError(error.message, { code: 'NOT_RESTORABLE', status: 409 }); }
        writeFileSync(join(staging, 'manifest.json'), manifestText.stdout);
        const info = {
          requestedAt: now().toISOString(), commit: full, remote: displayRemote(current.remote), branch: current.branch,
          backupCreatedAt: manifest.createdAt ?? null, praxVersion: manifest.praxVersion ?? null, sha256: proof.sha256, bytes: proof.bytes,
        };
        writeFileSync(join(staging, 'restore.json'), `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 });
        await rm(paths.pending, { recursive: true, force: true });
        await rename(staging, paths.pending);
        log?.info?.({ commit: full }, 'git restore staged; applies at the next start');
        return info;
      } catch (error) {
        await rm(staging, { recursive: true, force: true });
        throw error;
      }
    } finally {
      release();
    }
  }

  async function cancelRestore() {
    const info = pendingRestoreInfo(paths);
    await rm(paths.pending, { recursive: true, force: true });
    return { cancelled: Boolean(info) };
  }

  // The daily run, after the librarian sweep: a tick every quarter hour, and
  // once a day, when the person turned the schedule on, a backup.
  async function sweep(at = Date.now()) {
    const current = await settings();
    if (!current.scheduleEnabled || !current.remote) return { ran: false };
    const last = Date.parse(await appSettings.getSetting(GIT_BACKUP_LAST_RUN_SETTING, '').catch(() => '') || '');
    if (Number.isFinite(last) && at - last < SCHEDULED_RUN_EVERY_MS) return { ran: false };
    if (busy) return { ran: false };
    await appSettings.putSetting(GIT_BACKUP_LAST_RUN_SETTING, new Date(at).toISOString());
    try {
      const report = await run({ trigger: 'scheduled' });
      return { ran: true, changed: report.changed, commit: report.commit };
    } catch (error) {
      return { ran: true, error: error.message };
    }
  }

  return { settings, status, update, run, history, stageRestore, cancelRestore, sweep };
}

// ---- startup: apply a staged restore -------------------------------------------
// Runs before the database opens. The live database (and its WAL/SHM) moves to
// restore-rollback-<time>/ beside it, the staged copy is restored through the
// same guarded routine as `npm run restore`, and the outcome is recorded in
// git-backup/last-restore.json for Settings to show. A failure puts the live
// files back and keeps the staged copy under restore-failed-<time>/ so nothing
// is lost; the server then starts on the previous database.
export function applyPendingRestore(databaseFile, { log, now = () => new Date() } = {}) {
  const paths = gitBackupPaths(databaseFile);
  if (!paths) return null;
  const info = pendingRestoreInfo(paths);
  if (!info) return null;
  const stamp = now().toISOString().replace(/[:.]/g, '-');
  const rollbackDir = join(paths.dataDir, `restore-rollback-${stamp}`);
  const target = paths.databaseFile;
  const artifacts = [target, `${target}-wal`, `${target}-shm`];
  const moved = [];
  const record = (outcome) => {
    try {
      mkdirSync(paths.root, { recursive: true, mode: 0o700 });
      writeFileSync(paths.lastRestore, `${JSON.stringify({ ...info, ...outcome, appliedAt: now().toISOString() }, null, 2)}\n`, { mode: 0o600 });
    } catch { /* the outcome is also logged */ }
    return outcome;
  };
  try {
    // Guards before anything moves: the staged file must still be what was
    // validated, and the running build must still accept it.
    const staged = join(paths.pending, 'prax.db');
    const proof = validateSqliteBackup(staged);
    if (proof.sha256 !== String(info.sha256 || '').toLowerCase()) throw new Error('The staged database changed after it was validated; refusing to restore it.');
    const manifest = readJson(join(paths.pending, 'manifest.json'));
    if (manifest) assertManifestRestorable(manifest);
    assertRestorableSchema(staged);

    mkdirSync(rollbackDir, { recursive: true, mode: 0o700 });
    for (const artifact of artifacts) {
      if (!existsSync(artifact)) continue;
      renameSync(artifact, join(rollbackDir, basename(artifact)));
      moved.push(artifact);
    }
    const result = restoreDatabaseFromBackup(staged, target, { ownerDirectory: paths.dataDir });
    chmodSync(target, 0o600);
    rmSync(paths.pending, { recursive: true, force: true });
    if (moved.length === 0) rmSync(rollbackDir, { recursive: true, force: true });
    const outcome = record({ ok: true, rollbackDir: moved.length ? rollbackDir : null, restoredBytes: result.bytes, restoredSha256: result.sha256 });
    log?.info?.({ commit: info.commit, rollbackDir }, 'git restore applied');
    return outcome;
  } catch (error) {
    // Put the live database back exactly as it was.
    for (const artifact of moved) {
      const saved = join(rollbackDir, basename(artifact));
      if (existsSync(saved)) {
        if (existsSync(artifact)) unlinkSync(artifact);
        renameSync(saved, artifact);
      }
    }
    if (existsSync(rollbackDir) && readdirSync(rollbackDir).length === 0) rmSync(rollbackDir, { recursive: true, force: true });
    const failedDir = join(paths.dataDir, `restore-failed-${stamp}`);
    try { renameSync(paths.pending, failedDir); } catch { /* leave it in place */ }
    const outcome = record({ ok: false, error: error.message, failedDir: existsSync(failedDir) ? failedDir : null });
    log?.error?.({ err: error }, 'git restore failed; the previous database is in use');
    return outcome;
  }
}

// ---- routes ------------------------------------------------------------------------
export function registerGitBackupRoutes(app, { config, appSettingsRepository, db, gitRunner, sweepIntervalMs, sweep: sweepEnabled = true, now } = {}) {
  const paths = gitBackupPaths(config?.databaseFile);
  const available = Boolean(db && appSettingsRepository && paths && typeof db.snapshot === 'function');
  const git = gitRunner || createGitRunner({ paths });
  const service = available ? createGitBackupService({ app, db, appSettings: appSettingsRepository, paths, git, log: app.log, now }) : null;
  app.decorate('gitBackup', service);

  const unavailable = (reply) => reply.code(503).send({ message: 'Git backup requires the persistent Prax server.' });
  const fail = (reply, error) => {
    if (error instanceof GitBackupError) return reply.code(error.status).send({ message: error.message, code: error.code, detail: error.detail ?? undefined });
    throw error;
  };

  app.get('/api/workspace/git-backup', async (request, reply) => {
    if (!service) return unavailable(reply);
    return service.status();
  });

  app.put('/api/workspace/git-backup', async (request, reply) => {
    if (!service) return unavailable(reply);
    const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body : {};
    try { return await service.update(body); } catch (error) { return fail(reply, error); }
  });

  app.post('/api/workspace/git-backup/run', async (request, reply) => {
    if (!service) return unavailable(reply);
    try { return await service.run({ trigger: 'manual' }); } catch (error) { return fail(reply, error); }
  });

  app.get('/api/workspace/git-backup/history', async (request, reply) => {
    if (!service) return unavailable(reply);
    try { return await service.history({ limit: request.query.limit }); } catch (error) { return fail(reply, error); }
  });

  app.post('/api/workspace/git-backup/restore', async (request, reply) => {
    if (!service) return unavailable(reply);
    const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body : {};
    try {
      const info = await service.stageRestore({ commit: body.commit });
      reply.code(202);
      return { ...info, message: 'Restore staged. It is applied the next time Prax starts.' };
    } catch (error) { return fail(reply, error); }
  });

  app.delete('/api/workspace/git-backup/restore', async (request, reply) => {
    if (!service) return unavailable(reply);
    return service.cancelRestore();
  });

  if (service && sweepEnabled) {
    const timer = setInterval(() => { service.sweep().catch((err) => app.log?.warn?.({ err }, 'git backup sweep failed')); }, sweepIntervalMs ?? SWEEP_INTERVAL_MS);
    timer.unref?.();
    app.addHook('onClose', async () => clearInterval(timer));
  }
}
