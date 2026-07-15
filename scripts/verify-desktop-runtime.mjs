import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function parseArgs(args) {
  const options = { binary: null, timeoutMs: 60_000 };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--binary') options.binary = args[++index] || null;
    else if (args[index] === '--timeout-ms') options.timeoutMs = Number(args[++index]);
    else throw new Error(`Unknown desktop smoke option: ${args[index]}`);
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1_000) throw new Error('Desktop smoke timeout must be at least 1000ms');
  return options;
}

function defaultBinary() {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  return resolve('src-tauri', 'target', 'release', `prax${suffix}`);
}

function launch(binary, dataDir) {
  const appArgs = ['--desktop-smoke', dataDir];
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    return spawn('dbus-run-session', ['--', 'xvfb-run', '-a', binary, ...appArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  return spawn(binary, appArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
}

async function launchAndWait(binary, dataDir, timeoutMs, label) {
  let stdout = '';
  let stderr = '';
  const child = launch(binary, dataDir);
  child.stdout?.on('data', chunk => { stdout += String(chunk); });
  child.stderr?.on('data', chunk => { stderr += String(chunk); });

  const exit = await new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); resolveExit({ code, signal }); });
  }).catch(error => {
    error.message += `\nstdout:\n${stdout}\nstderr:\n${stderr}\nsmoke data: ${dataDir}`;
    throw error;
  });

  if (exit.code !== 0) {
    throw new Error(`${label} exited with code ${exit.code} signal ${exit.signal || 'none'}\nstdout:\n${stdout}\nstderr:\n${stderr}\nsmoke data: ${dataDir}`);
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const binary = resolve(options.binary || defaultBinary());
  if (!existsSync(binary)) throw new Error(`Desktop binary does not exist: ${binary}`);

  const dataDir = mkdtempSync(join(tmpdir(), 'prax-desktop-smoke-'));
  await launchAndWait(binary, dataDir, options.timeoutMs, 'First packaged launch');

  const databaseFile = join(dataDir, 'prax.db');
  const logFile = join(dataDir, 'logs', 'server.log');
  if (!existsSync(databaseFile) || !existsSync(logFile)) {
    throw new Error(`Desktop smoke did not create its isolated database and log: ${dataDir}`);
  }
  const log = readFileSync(logFile, 'utf8');
  if (!log.includes('PRAX_DESKTOP_READY')) throw new Error(`Desktop log has no readiness evidence: ${logFile}`);
  if (!log.includes('[prax] server-exit code=0 signal=none')) {
    throw new Error(`Desktop sidecar did not report a graceful zero-code shutdown: ${logFile}`);
  }

  const db = new DatabaseSync(databaseFile);
  const migrations = db.prepare('select count(*) as count from schema_migrations').get().count;
  const projects = db.prepare('select count(*) as count from projects').get().count;
  const projectId = db.prepare('select id from projects order by sort_order, id limit 1').get().id;
  const sentinelId = '4f105a75-5cd1-4a69-b36a-68094c68fa4e';
  db.prepare(`
    insert into tasks (id, title, priority, status, project_id)
    values (?, 'Desktop update persistence sentinel', 'medium', 'planned', ?)
  `).run(sentinelId, projectId);
  db.close();
  if (migrations < 1 || projects < 1) throw new Error('Desktop smoke database is not fully migrated');

  await launchAndWait(binary, dataDir, options.timeoutMs, 'Second packaged launch');
  const reopened = new DatabaseSync(databaseFile, { readOnly: true });
  const sentinel = reopened.prepare('select title from tasks where id = ?').get(sentinelId);
  const migrationsAfter = reopened.prepare('select count(*) as count from schema_migrations').get().count;
  reopened.close();
  if (sentinel?.title !== 'Desktop update persistence sentinel' || migrationsAfter !== migrations) {
    throw new Error('Second packaged launch did not preserve the isolated app-data sentinel and migration state');
  }

  const finalLog = readFileSync(logFile, 'utf8');
  const readinessCount = finalLog.split('PRAX_DESKTOP_READY').length - 1;
  const cleanExitCount = finalLog.split('[prax] server-exit code=0 signal=none').length - 1;
  if (readinessCount < 2 || cleanExitCount < 2) {
    throw new Error(`Desktop restart evidence is incomplete in ${logFile}`);
  }

  console.log(`[desktop-smoke] packaged runtime launched twice, preserved data across ${migrations} migrations, and exited cleanly`);
  rmSync(dataDir, { recursive: true, force: true });
}

run().catch(error => {
  console.error(`[desktop-smoke] ${error.message}`);
  process.exitCode = 1;
});
