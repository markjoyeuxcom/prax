import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PREFERENCES,
  LOCAL_STORAGE_KEY,
  PALETTE_OPTIONS,
  applyPreferences,
  loadPreferences,
  normalizePreferences,
  resetPreferences,
  savePreferences,
} from '../../public/js/preferences.js';

function storageWith(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    values,
  };
}

function rootStub() {
  const attributes = new Map();
  return {
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    getAttribute(name) {
      return attributes.get(name);
    },
  };
}

test('normalizePreferences returns defaults for empty or invalid input', () => {
  assert.deepEqual(normalizePreferences(null), DEFAULT_PREFERENCES);
  assert.deepEqual(normalizePreferences({ fontScale: 'giant', palette: 'rainbow' }), DEFAULT_PREFERENCES);
});

test('normalizePreferences preserves valid font scale and palette values', () => {
  assert.deepEqual(
    normalizePreferences({ fontScale: 'large', palette: 'daylight' }),
    { fontScale: 'large', palette: 'daylight' },
  );
});

test('PALETTE_OPTIONS includes the midnight palette', () => {
  assert.ok(PALETTE_OPTIONS.includes('midnight'));
});

test('normalizePreferences preserves the midnight palette', () => {
  assert.deepEqual(
    normalizePreferences({ fontScale: 'comfortable', palette: 'midnight' }),
    { fontScale: 'comfortable', palette: 'midnight' },
  );
});

test('loadPreferences parses saved localStorage JSON', () => {
  const storage = storageWith({
    [LOCAL_STORAGE_KEY]: JSON.stringify({ fontScale: 'compact', palette: 'graphite' }),
  });

  assert.deepEqual(loadPreferences(storage), { fontScale: 'compact', palette: 'graphite' });
});

test('loadPreferences returns defaults for malformed saved JSON', () => {
  const storage = storageWith({ [LOCAL_STORAGE_KEY]: '{bad json' });

  assert.deepEqual(loadPreferences(storage), DEFAULT_PREFERENCES);
});

test('savePreferences stores normalized preferences', () => {
  const storage = storageWith();

  const saved = savePreferences({ fontScale: 'large', palette: 'daylight' }, storage);

  assert.deepEqual(saved, { fontScale: 'large', palette: 'daylight' });
  assert.equal(storage.getItem(LOCAL_STORAGE_KEY), JSON.stringify(saved));
});

test('resetPreferences clears storage and returns defaults', () => {
  const storage = storageWith({
    [LOCAL_STORAGE_KEY]: JSON.stringify({ fontScale: 'large', palette: 'daylight' }),
  });

  const reset = resetPreferences(storage);

  assert.deepEqual(reset, DEFAULT_PREFERENCES);
  assert.equal(storage.getItem(LOCAL_STORAGE_KEY), null);
});

test('applyPreferences writes root attributes', () => {
  const root = rootStub();

  applyPreferences({ fontScale: 'large', palette: 'graphite' }, root);

  assert.equal(root.getAttribute('data-font-scale'), 'large');
  assert.equal(root.getAttribute('data-palette'), 'graphite');
});
