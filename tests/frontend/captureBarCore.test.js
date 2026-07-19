import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTURE_BAR_DRAFT_KEY,
  buildCreatePayload,
  clearBarDraft,
  destinationHint,
  loadBarDraft,
  resolveCapture,
  saveBarDraft,
} from '../../public/js/captureBarCore.js';

const PROJECTS = [
  { id: 'p1', slug: 'inbox', name: 'Inbox' },
  { id: 'p2', slug: 'home-lab', name: 'Home Lab' },
];
const NOW = new Date('2026-07-20T09:00:00'); // a Monday

test('resolveCapture routes a known #project token and strips shorthand', () => {
  const resolved = resolveCapture('Fix the rack #home-lab @wiring !high tomorrow', { projects: PROJECTS, now: NOW });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.title, 'Fix the rack');
  assert.equal(resolved.projectSlug, 'home-lab');
  assert.equal(resolved.projectName, 'Home Lab');
  assert.equal(resolved.priority, 'high');
  assert.equal(resolved.dueDate, '2026-07-21');
  assert.deepEqual(resolved.labels, ['wiring']);
});

test('resolveCapture matches a project by name too, case-insensitively', () => {
  const resolved = resolveCapture('Order shelves #Home-Lab', { projects: PROJECTS, now: NOW });
  assert.equal(resolved.projectSlug, 'home-lab');
});

test('an unknown #project token falls back to Inbox and SURVIVES in the title', () => {
  const resolved = resolveCapture('Call the plumber #nonexistent', { projects: PROJECTS, now: NOW });
  assert.equal(resolved.projectSlug, 'inbox');
  assert.equal(resolved.title, 'Call the plumber #nonexistent');
});

test('token-only text is not submittable', () => {
  const tokensOnly = resolveCapture('!high @home', { projects: PROJECTS, now: NOW });
  assert.equal(tokensOnly.ok, false);
  // …but an unknown project token alone still leaves a usable title.
  const unknownOnly = resolveCapture('#mystery', { projects: PROJECTS, now: NOW });
  assert.equal(unknownOnly.ok, true);
  assert.equal(unknownOnly.title, '#mystery');
});

test('buildCreatePayload carries the client id and omits absent fields', () => {
  const resolved = resolveCapture('Plain task', { projects: PROJECTS, now: NOW });
  const payload = buildCreatePayload(resolved, '11111111-2222-4333-8444-555555555555');
  assert.deepEqual(payload, {
    id: '11111111-2222-4333-8444-555555555555',
    title: 'Plain task',
    project: 'inbox',
    priority: 'medium',
    status: 'planned',
  });
});

test('destinationHint shows only what deviates from the defaults', () => {
  const plain = resolveCapture('Plain task', { projects: PROJECTS, now: NOW });
  assert.equal(destinationHint(plain), '→ Inbox');
  const rich = resolveCapture('Rack #home-lab !low @wiring 2026-08-01', { projects: PROJECTS, now: NOW });
  assert.equal(destinationHint(rich), '→ Home Lab · 2026-08-01 · low · @wiring');
});

test('draft persistence round-trips through its dedicated key and tolerates broken storage', () => {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
  saveBarDraft(storage, 'half a thought');
  assert.equal(store.get(CAPTURE_BAR_DRAFT_KEY), 'half a thought');
  assert.equal(loadBarDraft(storage), 'half a thought');
  clearBarDraft(storage);
  assert.equal(store.has(CAPTURE_BAR_DRAFT_KEY), false);

  const broken = { getItem: () => { throw new Error('nope'); }, setItem: () => { throw new Error('nope'); } };
  assert.equal(loadBarDraft(broken), '');
  assert.doesNotThrow(() => saveBarDraft(broken, 'x'));
});
