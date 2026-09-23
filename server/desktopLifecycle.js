import { dirname, join } from 'node:path';
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeFileSync } from 'node:fs';

// Keep webview localStorage on the same origin across launches. The first
// child asks the OS for a port; future children must bind that exact saved
// port themselves. A collision fails closed instead of opening another
// process or silently abandoning this installation's drafts/preferences.
export function savedDesktopPort(file) {
  if (!file) return 0;
  let value;
  try { value = readFileSync(file, 'utf8').trim(); }
  catch (error) { if (error.code === 'ENOENT') return previousDesktopPort(file); throw error; }
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Invalid saved desktop port. Preserve the webview-port file and browser data when repairing this installation.');
  }
  return port;
}

export function persistDesktopPort(file, address) {
  if (!file) return;
  const port = Number(new URL(address).port);
  const saved = existsSync(file) ? savedDesktopPort(file) : 0;
  if (saved === port) return;
  if (saved) throw new Error('The bound port differs from the saved desktop port; refusing to change the storage origin.');
  const descriptor = openSync(file, 'wx', 0o600);
  try { writeFileSync(descriptor, String(port)); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
}

const DESKTOP_READY_PREFIX = 'PRAX_DESKTOP_READY ';

export function desktopReadyLine(address) {
  const url = new URL(String(address));
  const port = Number(url.port);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Desktop server announced an invalid loopback address: ${address}`);
  }
  return `${DESKTOP_READY_PREFIX}${JSON.stringify({ port })}\n`;
}

export function createGracefulShutdown({ close, exit = () => {} }) {
  let outcome;
  return function shutdown() {
    if (outcome) return outcome;
    outcome = (async () => {
      try {
        await close();
        exit(0);
        return 0;
      } catch (error) {
        exit(1, error);
        return 1;
      }
    })();
    return outcome;
  };
}

export function installDesktopStdinControl({ input, shutdown }) {
  let buffer = '';
  let disposed = false;

  function dispose() {
    if (disposed) return;
    disposed = true;
    input.off('data', onData);
    input.off('end', onParentGone);
    input.off('close', onParentGone);
  }

  function onData(chunk) {
    buffer += String(chunk);
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const command = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (command === 'shutdown') {
        dispose();
        void shutdown();
        return;
      }
    }
  }

  // Stdin EOF means the Tauri parent is gone — crash, force-quit, OOM-kill —
  // without ever writing 'shutdown'. Ignoring it left the sidecar running
  // forever as an orphan holding the database open (and, after an update, an
  // old-version server still mutating it).
  function onParentGone() {
    dispose();
    void shutdown();
  }

  input.setEncoding?.('utf8');
  input.on('data', onData);
  input.on('end', onParentGone);
  input.on('close', onParentGone);
  input.resume?.();
  return dispose;
}

export function announceDesktopReady(output, address) {
  output.write(desktopReadyLine(address));
}

// A failed start ends with one structured line on stdout. The shell turns
// its reason into advice the person can act on; the stack stays in the log.
const DESKTOP_FAILED_PREFIX = 'PRAX_DESKTOP_FAILED ';

export function desktopFailureReason(error) {
  if (error?.code === 'EADDRINUSE') return 'port-in-use';
  if (/^migration failed:/.test(String(error?.message || ''))) return 'migration-failed';
  return 'startup-error';
}

export function desktopFailedLine(error, port) {
  const reason = desktopFailureReason(error);
  const payload = reason === 'port-in-use' && Number.isInteger(port) && port > 0 && port <= 65535
    ? { reason, port }
    : { reason };
  return `${DESKTOP_FAILED_PREFIX}${JSON.stringify(payload)}\n`;
}

export function announceDesktopFailure(output, error, port) {
  output.write(desktopFailedLine(error, port));
}

// Upgrade migrations run before the server listens, inside the shell's
// startup budget. Reporting each one lets the shell give a long upgrade the
// time it needs instead of declaring the start hung.
const DESKTOP_PROGRESS_PREFIX = 'PRAX_DESKTOP_PROGRESS ';

export function desktopProgressLine(event) {
  if (event?.phase === 'migrating') {
    return `${DESKTOP_PROGRESS_PREFIX}${JSON.stringify({ phase: 'migrating', index: event.index, total: event.total })}\n`;
  }
  if (event?.phase === 'migrated') {
    return `${DESKTOP_PROGRESS_PREFIX}${JSON.stringify({ phase: 'migrated', total: event.total })}\n`;
  }
  throw new Error(`Unknown desktop startup phase: ${event?.phase}`);
}

// Write the progress line, then yield a full event-loop turn: migrations are
// synchronous SQLite work, so this is when a stdin shutdown or a signal that
// arrived during the previous migration gets handled.
export function reportDesktopStartupProgress(output, event) {
  output.write(desktopProgressLine(event));
  return new Promise((resolve) => { setImmediate(resolve); });
}

// Before origin pinning, the parent already recorded the exact child readiness
// messages. Reuse the latest recorded origin on upgrade so the last session's
// localStorage remains reachable. Logs rotate before startup, hence both names.
function previousDesktopPort(file) {
  for (const name of ['server.log', 'server.log.1']) {
    let text;
    try { text = readFileSync(join(dirname(file), 'logs', name), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const lines = text.split('\n').reverse();
    for (const line of lines) {
      if (!line.startsWith(DESKTOP_READY_PREFIX)) continue;
      try {
        const port = JSON.parse(line.slice(DESKTOP_READY_PREFIX.length)).port;
        if (Number.isInteger(port) && port >= 1024 && port <= 65535) return port;
      } catch { /* malformed lines never selected an old webview origin */ }
    }
  }
  return 0;
}
