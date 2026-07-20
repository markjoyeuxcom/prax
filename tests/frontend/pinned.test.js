import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PINNED_STORAGE_KEY,
  isPinned,
  loadPinned,
  normalizePinned,
  savePinned,
  splitPinned,
  togglePinned,
} from '../../public/js/pinned.js';

test('normalizePinned: shapes garbage into the three deduped string lists', () => {
  assert.deepEqual(normalizePinned(undefined), { projects: [], smartViews: [], libraryViews: [] });
  assert.deepEqual(
    normalizePinned({ projects: ['a', 'a', 7, '', 'b'], smartViews: 'nope', extra: ['x'] }),
    { projects: ['a', 'b'], smartViews: [], libraryViews: [] },
  );
  const flood = normalizePinned({ projects: Array.from({ length: 80 }, (_, i) => `p${i}`) });
  assert.equal(flood.projects.length, 50, 'capped per kind');
});

test('togglePinned adds, removes, and rejects unknown kinds/keys', () => {
  const once = togglePinned({}, 'projects', 'p1');
  assert.deepEqual(once.projects, ['p1']);
  const twice = togglePinned(once, 'projects', 'p1');
  assert.deepEqual(twice.projects, []);
  assert.deepEqual(togglePinned(once, 'nonsense', 'p1'), once);
  assert.deepEqual(togglePinned(once, 'projects', ''), once);
  assert.equal(isPinned(once, 'projects', 'p1'), true);
  assert.equal(isPinned(once, 'smartViews', 'p1'), false);
});

test('pins round-trip storage and survive corrupt JSON', () => {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  savePinned({ projects: ['p1'], smartViews: ['builtin-stale'] }, storage);
  assert.ok(store.has(PINNED_STORAGE_KEY));
  assert.deepEqual(loadPinned(storage), { projects: ['p1'], smartViews: ['builtin-stale'], libraryViews: [] });
  store.set(PINNED_STORAGE_KEY, '{corrupt');
  assert.deepEqual(loadPinned(storage), { projects: [], smartViews: [], libraryViews: [] });
  const broken = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } };
  assert.deepEqual(loadPinned(broken), { projects: [], smartViews: [], libraryViews: [] });
  assert.doesNotThrow(() => savePinned({}, broken));
});

test('splitPinned keeps list order within both halves and ignores stale keys', () => {
  const items = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
  const { pinned, rest } = splitPinned(items, ['c', 'a', 'ghost-of-deleted']);
  assert.deepEqual(pinned.map((item) => item.key), ['a', 'c'], 'list order, not pin order');
  assert.deepEqual(rest.map((item) => item.key), ['b']);
});
