import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANGE_CHANNEL,
  CHANGE_STORAGE_KEY,
  announceChange,
  collectionFingerprint,
  createExternalRefresh,
  installExternalRefreshTriggers,
} from '../../public/js/externalRefresh.js';

// A manual clock and timer so the throttle is deterministic.
function harness({ minIntervalMs = 1000 } = {}) {
  let time = 0;
  const timers = [];
  const loads = [];
  let resolveLoad = null;
  const refresh = createExternalRefresh({
    minIntervalMs,
    now: () => time,
    schedule: (fn, ms) => { timers.push({ at: time + ms, fn }); },
    load: (reason) => new Promise((resolve) => { loads.push(reason); resolveLoad = resolve; }),
  });
  const advance = async (ms) => {
    time += ms;
    for (const timer of timers.splice(0).sort((a, b) => a.at - b.at)) {
      if (timer.at <= time) timer.fn(); else timers.push(timer);
    }
    await Promise.resolve();
  };
  const finishLoad = async () => { resolveLoad?.(true); resolveLoad = null; for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
  return { refresh, loads, advance, finishLoad, timers };
}

test('collectionFingerprint changes when an item is added, updated, archived, or changes status', () => {
  const a = [{ id: '1', updatedAt: 't1', status: 'planned' }];
  assert.equal(collectionFingerprint(a), collectionFingerprint([...a]));
  assert.notEqual(collectionFingerprint(a), collectionFingerprint([...a, { id: '2', updatedAt: 't1' }]));
  assert.notEqual(collectionFingerprint(a), collectionFingerprint([{ id: '1', updatedAt: 't2', status: 'planned' }]));
  assert.notEqual(collectionFingerprint(a), collectionFingerprint([{ id: '1', updatedAt: 't1', status: 'planned', archivedAt: 'x' }]));
  assert.notEqual(collectionFingerprint(a), collectionFingerprint([{ id: '1', updatedAt: 't1', status: 'completed' }]));
  assert.equal(collectionFingerprint(null), '');
});

test('concurrent triggers share one in-flight load', async () => {
  const h = harness();
  const p1 = h.refresh.trigger('focus');
  const p2 = h.refresh.trigger('visible');
  assert.equal(p1, p2);
  assert.deepEqual(h.loads, ['focus']);
  await h.finishLoad();
  assert.equal(h.refresh.inFlight, null);
});

test('a trigger inside the throttle window is not dropped: it runs at the end of the window', async () => {
  const h = harness({ minIntervalMs: 1000 });
  h.refresh.trigger('focus');
  await h.finishLoad();
  await h.advance(300);
  assert.equal(h.refresh.trigger('focus'), null, 'throttled, no immediate load');
  assert.deepEqual(h.loads, ['focus']);
  assert.equal(h.refresh.pending, 'focus');
  await h.advance(700);
  assert.deepEqual(h.loads, ['focus', 'focus'], 'the trailing refresh ran when the window closed');
  await h.finishLoad();
  await h.advance(2000);
  assert.deepEqual(h.loads, ['focus', 'focus'], 'no extra runs without new triggers');
});

test('a trigger while a load is in flight queues exactly one follow-up load', async () => {
  const h = harness({ minIntervalMs: 1000 });
  h.refresh.trigger('focus');
  h.refresh.trigger('broadcast');
  h.refresh.trigger('storage');
  await h.finishLoad();
  assert.equal(h.refresh.pending, 'storage');
  await h.advance(1000);
  assert.deepEqual(h.loads, ['focus', 'storage']);
});

test('a failing load does not poison later triggers', async () => {
  let calls = 0;
  const refresh = createExternalRefresh({ minIntervalMs: 0, load: async () => { calls += 1; if (calls === 1) throw new Error('server down'); return true; } });
  assert.equal(await refresh.trigger('focus'), false);
  assert.equal(await refresh.trigger('focus'), true);
});

test('installer wires focus, visibility, storage and broadcast to the refresher and uninstalls cleanly', () => {
  const reasons = [];
  const refresh = { trigger: (reason) => { reasons.push(reason); } };
  const listeners = new Map();
  const node = (name) => ({
    visibilityState: 'visible',
    addEventListener: (event, handler) => listeners.set(`${name}:${event}`, handler),
    removeEventListener: (event) => listeners.delete(`${name}:${event}`),
  });
  const target = node('window');
  const doc = node('document');
  let closed = false;
  class FakeChannel {
    constructor(name) { this.name = name; FakeChannel.last = this; }
    postMessage() {}
    close() { closed = true; }
  }
  const uninstall = installExternalRefreshTriggers({ refresh, target, doc, BroadcastChannelCtor: FakeChannel });
  assert.equal(FakeChannel.last.name, CHANGE_CHANNEL);
  listeners.get('window:focus')();
  doc.visibilityState = 'hidden'; listeners.get('document:visibilitychange')();
  doc.visibilityState = 'visible'; listeners.get('document:visibilitychange')();
  listeners.get('window:storage')({ key: 'unrelated' });
  listeners.get('window:storage')({ key: CHANGE_STORAGE_KEY });
  FakeChannel.last.onmessage({ data: { type: 'task-created', id: 'x' } });
  FakeChannel.last.onmessage({ data: 'junk' });
  assert.deepEqual(reasons, ['focus', 'visible', 'storage', 'broadcast']);
  uninstall();
  assert.equal(listeners.size, 0);
  assert.equal(closed, true);
});

test('announceChange posts on the channel and writes the storage key, and survives having neither', () => {
  const posted = [];
  class FakeChannel { constructor(name) { this.name = name; } postMessage(m) { posted.push([this.name, m]); } close() {} }
  const stored = new Map();
  const storage = { setItem: (k, v) => stored.set(k, v) };
  assert.equal(announceChange({ type: 'task-created', id: 't1' }, { BroadcastChannelCtor: FakeChannel, storage, now: () => 42 }), true);
  assert.deepEqual(posted, [[CHANGE_CHANNEL, { type: 'task-created', id: 't1', at: 42 }]]);
  assert.deepEqual(JSON.parse(stored.get(CHANGE_STORAGE_KEY)), { type: 'task-created', id: 't1', at: 42 });
  assert.equal(announceChange({ type: 'x' }, { BroadcastChannelCtor: null, storage: null }), false);
  assert.equal(announceChange({ type: 'x' }, { BroadcastChannelCtor: null, storage: { setItem: () => { throw new Error('quota'); } } }), false);
});
