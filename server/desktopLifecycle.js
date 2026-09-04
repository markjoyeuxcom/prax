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
