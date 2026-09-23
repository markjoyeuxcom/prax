import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import {
  announceDesktopFailure,
  announceDesktopReady,
  createGracefulShutdown,
  desktopFailedLine,
  desktopFailureReason,
  desktopProgressLine,
  desktopReadyLine,
  installDesktopStdinControl,
  reportDesktopStartupProgress,
} from '../../server/desktopLifecycle.js';

test('desktop readiness announces only a concrete IPv4 loopback port', () => {
  assert.equal(desktopReadyLine('http://127.0.0.1:43127'), 'PRAX_DESKTOP_READY {"port":43127}\n');
  for (const address of [
    'http://localhost:43127',
    'http://0.0.0.0:43127',
    'https://127.0.0.1:43127',
    'http://127.0.0.1',
  ]) {
    assert.throws(() => desktopReadyLine(address), /invalid loopback address/);
  }

  let written = '';
  announceDesktopReady({ write(value) { written += value; } }, 'http://127.0.0.1:54321');
  assert.equal(written, 'PRAX_DESKTOP_READY {"port":54321}\n');
});

test('a failed desktop start names its reason, and the saved port only for a collision', () => {
  const inUse = Object.assign(new Error('listen EADDRINUSE: address already in use 127.0.0.1:43127'), { code: 'EADDRINUSE' });
  assert.equal(desktopFailureReason(inUse), 'port-in-use');
  assert.equal(desktopFailedLine(inUse, 43127), 'PRAX_DESKTOP_FAILED {"reason":"port-in-use","port":43127}\n');
  // Port 0 is the first launch asking the OS; there is no port to name.
  assert.equal(desktopFailedLine(inUse, 0), 'PRAX_DESKTOP_FAILED {"reason":"port-in-use"}\n');
  assert.equal(
    desktopFailedLine(new Error('migration failed: 0014_x.sql: no such table'), 43127),
    'PRAX_DESKTOP_FAILED {"reason":"migration-failed"}\n',
  );
  assert.equal(desktopFailedLine(new Error('Invalid saved desktop port.'), 43127), 'PRAX_DESKTOP_FAILED {"reason":"startup-error"}\n');

  let written = '';
  announceDesktopFailure({ write(value) { written += value; } }, inUse, 50000);
  assert.equal(written, 'PRAX_DESKTOP_FAILED {"reason":"port-in-use","port":50000}\n');
});

test('desktop startup progress reports migrations and yields to the event loop', async () => {
  assert.equal(
    desktopProgressLine({ phase: 'migrating', version: '0002_x.sql', index: 2, total: 3 }),
    'PRAX_DESKTOP_PROGRESS {"phase":"migrating","index":2,"total":3}\n',
  );
  assert.equal(desktopProgressLine({ phase: 'migrated', total: 3 }), 'PRAX_DESKTOP_PROGRESS {"phase":"migrated","total":3}\n');
  assert.throws(() => desktopProgressLine({ phase: 'other' }), /Unknown desktop startup phase/);

  // The yield is a macrotask turn, so an immediate queued before it (standing
  // in for stdin data or a signal) runs before the next migration starts.
  let written = '';
  let handled = false;
  setImmediate(() => { handled = true; });
  await reportDesktopStartupProgress({ write(value) { written += value; } }, { phase: 'migrating', index: 1, total: 1 });
  assert.equal(handled, true);
  assert.equal(written, 'PRAX_DESKTOP_PROGRESS {"phase":"migrating","index":1,"total":1}\n');
});

test('desktop stdin shutdown is newline-framed, exact-match, and single-flight', async () => {
  const input = new PassThrough();
  let closes = 0;
  const exits = [];
  const shutdown = createGracefulShutdown({
    async close() { closes += 1; },
    exit(code) { exits.push(code); },
  });
  installDesktopStdinControl({ input, shutdown });

  input.write('shut');
  input.write('down-now\nshutdown');
  assert.equal(closes, 0);
  input.write('\nshutdown\n');
  await shutdown();

  assert.equal(closes, 1);
  assert.deepEqual(exits, [0]);
});

test('signal and stdin shutdown callers share one failing close outcome', async () => {
  const error = new Error('database close failed');
  let closes = 0;
  const exits = [];
  const shutdown = createGracefulShutdown({
    async close() { closes += 1; throw error; },
    exit(code, cause) { exits.push([code, cause]); },
  });

  const [first, second] = await Promise.all([shutdown(), shutdown()]);
  assert.equal(first, 1);
  assert.equal(second, 1);
  assert.equal(closes, 1);
  assert.deepEqual(exits, [[1, error]]);
});
