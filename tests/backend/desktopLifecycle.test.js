import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import {
  announceDesktopReady,
  createGracefulShutdown,
  desktopReadyLine,
  installDesktopStdinControl,
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
