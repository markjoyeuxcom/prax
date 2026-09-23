import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
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

function launch(binary, dataDir, exitArgs) {
  const appArgs = ['--desktop-smoke', dataDir].concat(exitArgs);
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    return spawn('dbus-run-session', ['--', 'xvfb-run', '-a', binary, ...appArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  return spawn(binary, appArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
}

async function launchAndWait(binary, dataDir, timeoutMs, label, exitArgs = []) {
  let stdout = '';
  let stderr = '';
  const child = launch(binary, dataDir, exitArgs);
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
  return { stdout, stderr };
}

function count(text, needle) {
  return text.split(needle).length - 1;
}

// A graceful close checkpoints the WAL into prax.db; SQLite then deletes it
// (or leaves it empty). Committed pages left in it mean the sidecar was
// killed with the database open.
function assertCheckpointed(dataDir, label) {
  const wal = join(dataDir, 'prax.db-wal');
  if (existsSync(wal) && statSync(wal).size > 0) {
    throw new Error(`${label} left an un-checkpointed prax.db-wal (${statSync(wal).size} bytes): ${dataDir}`);
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const binary = resolve(options.binary || defaultBinary());
  if (!existsSync(binary)) throw new Error(`Desktop binary does not exist: ${binary}`);

  const dataDir = mkdtempSync(join(tmpdir(), 'prax-desktop-smoke-'));
  // Default smoke ending: the app menu's Quit handler (⌘Q, same graceful
  // shutdown as the tray's Quit Prax).
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
  assertCheckpointed(dataDir, 'First packaged launch');

  const portFile = join(dataDir, 'webview-port');
  const firstPort = Number(readFileSync(portFile, 'utf8'));
  if (!Number.isInteger(firstPort) || firstPort < 1024 || firstPort > 65535) {
    throw new Error('Desktop did not persist its browser storage origin');
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
  assertCheckpointed(dataDir, 'Second packaged launch');
  const reopened = new DatabaseSync(databaseFile, { readOnly: true });
  const sentinel = reopened.prepare('select title from tasks where id = ?').get(sentinelId);
  const migrationsAfter = reopened.prepare('select count(*) as count from schema_migrations').get().count;
  reopened.close();
  if (sentinel?.title !== 'Desktop update persistence sentinel' || migrationsAfter !== migrations) {
    throw new Error('Second packaged launch did not preserve the isolated app-data sentinel and migration state');
  }

  const finalLog = readFileSync(logFile, 'utf8');
  const ports = [...finalLog.matchAll(/PRAX_DESKTOP_READY \{"port":(\d+)\}/g)].map(match => Number(match[1]));
  if (Number(readFileSync(portFile, 'utf8')) !== firstPort || ports.some(port => port !== firstPort)) {
    throw new Error('Desktop restart changed its browser storage origin');
  }
  const readinessCount = count(finalLog, 'PRAX_DESKTOP_READY');
  const cleanExitCount = count(finalLog, '[prax] server-exit code=0 signal=none');
  if (readinessCount < 2 || cleanExitCount < 2) {
    throw new Error(`Desktop restart evidence is incomplete in ${logFile}`);
  }

  // macOS: NSApp terminate: is what the Dock's Quit, logout and system
  // shutdown send. It reaches RunEvent::Exit without ExitRequested, so only
  // the Exit barrier stands between it and a killed sidecar.
  const endings = ['menu quit'];
  if (process.platform === 'darwin') {
    await launchAndWait(binary, dataDir, options.timeoutMs, 'Terminate launch', ['--desktop-smoke-exit', 'terminate']);
    const terminateLog = readFileSync(logFile, 'utf8');
    if (count(terminateLog, '[prax] server-exit code=0 signal=none') !== cleanExitCount + 1) {
      throw new Error(`NSApp terminate: did not shut the sidecar down gracefully: ${logFile}`);
    }
    assertCheckpointed(dataDir, 'Terminate launch');
    endings.push('terminate:');
  }

  // A sidecar crash after the main window opened must leave the recovery
  // screen in that window; the app then quits from the menu handler.
  const logBeforeCrash = readFileSync(logFile, 'utf8').length;
  const crash = await launchAndWait(binary, dataDir, options.timeoutMs, 'Crash launch', ['--desktop-smoke-exit', 'crash']);
  if (!crash.stdout.includes('PRAX_DESKTOP_SMOKE recovery-shown')) {
    throw new Error(`Sidecar crash did not show the recovery screen\nstdout:\n${crash.stdout}\nstderr:\n${crash.stderr}\nsmoke data: ${dataDir}`);
  }
  if (!readFileSync(logFile, 'utf8').slice(logBeforeCrash).includes('[prax] server-exit code=none signal=9')) {
    throw new Error(`Crash launch did not record the killed sidecar's exit: ${logFile}`);
  }
  endings.push('crash recovery');

  // The same crash after the capture bar was opened: recovery replaces the
  // dead bar, and summoning capture again (tray or shortcut) brings the
  // hidden recovery window forward instead of the bar.
  const logBeforeCaptureCrash = readFileSync(logFile, 'utf8').length;
  const captureCrash = await launchAndWait(binary, dataDir, options.timeoutMs, 'Capture crash launch', ['--desktop-smoke-exit', 'capture-crash']);
  for (const checkpoint of ['capture-opened', 'capture-hidden-recovery-shown', 'capture-summon-shows-recovery']) {
    if (!captureCrash.stdout.includes(`PRAX_DESKTOP_SMOKE ${checkpoint}\n`)) {
      throw new Error(`Sidecar crash with the capture bar open missed "${checkpoint}"\nstdout:\n${captureCrash.stdout}\nstderr:\n${captureCrash.stderr}\nsmoke data: ${dataDir}`);
    }
  }
  if (!readFileSync(logFile, 'utf8').slice(logBeforeCaptureCrash).includes('[prax] server-exit code=none signal=9')) {
    throw new Error(`Capture crash launch did not record the killed sidecar's exit: ${logFile}`);
  }
  endings.push('crash recovery with the capture bar open');

  console.log(`[desktop-smoke] packaged runtime launched ${endings.length + 1} times, preserved data across ${migrations} migrations and the same browser storage origin, and passed: ${endings.join(', ')}`);
  rmSync(dataDir, { recursive: true, force: true });
}

run().catch(error => {
  console.error(`[desktop-smoke] ${error.message}`);
  process.exitCode = 1;
});
