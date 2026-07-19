import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCENT_CSS,
  ACCENT_OPTIONS,
  CHROME_OPTIONS,
  DEFAULT_PREFERENCES,
  EDITOR_FONT_OPTIONS,
  PREVIEW_FONT_OPTIONS,
  LOCAL_STORAGE_KEY,
  THEME_OPTIONS,
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

function bodyStub() {
  const attributes = new Map();
  const properties = new Map();
  return {
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    getAttribute(name) {
      return attributes.get(name);
    },
    style: {
      setProperty(name, value) {
        properties.set(name, value);
      },
      removeProperty(name) {
        properties.delete(name);
      },
      getPropertyValue(name) {
        return properties.get(name);
      },
    },
  };
}

test('normalizePreferences returns defaults for empty or invalid input', () => {
  assert.deepEqual(normalizePreferences(null), DEFAULT_PREFERENCES);
  assert.deepEqual(
    normalizePreferences({ theme: 'sepia', accent: 'rainbow', chromeOS: 'beos', readingScale: 'huge' }),
    DEFAULT_PREFERENCES,
  );
});

test('normalizePreferences preserves valid theme, accent, and chrome values', () => {
  assert.deepEqual(
    normalizePreferences({ theme: 'dark', accent: 'indigo', chromeOS: 'win', readingScale: 1.1 }),
    { theme: 'dark', accent: 'indigo', chromeOS: 'win', readingScale: 1.1, lineNumbers: false, reminders: true, editorEngine: 'codemirror', editorFont: 'proportional', previewFont: 'serif', slippageChips: true, slippageDeferrals: 3, slippageAgeDays: 30, wipLimit: 0, shutdownNudge: false, weeklyReviewNudge: false },
  );
});

test('the option sets are the design set', () => {
  assert.deepEqual([...THEME_OPTIONS], ['light', 'dark']);
  assert.deepEqual([...ACCENT_OPTIONS], ['fern', 'teal', 'sky', 'indigo', 'plum', 'rose', 'amber', 'clay', 'moss']);
  assert.deepEqual([...CHROME_OPTIONS], ['mac', 'win']);
});

test('reading scale clamps to the 0.85–1.25 design range', () => {
  assert.equal(normalizePreferences({ readingScale: 0.5 }).readingScale, 0.85);
  assert.equal(normalizePreferences({ readingScale: 2 }).readingScale, 1.25);
  assert.equal(normalizePreferences({ readingScale: NaN }).readingScale, 1);
});

test('legacy palettes migrate to the nearest theme', () => {
  assert.equal(normalizePreferences({ palette: 'console' }).theme, 'dark');
  assert.equal(normalizePreferences({ palette: 'graphite' }).theme, 'dark');
  assert.equal(normalizePreferences({ palette: 'midnight' }).theme, 'dark');
  assert.equal(normalizePreferences({ palette: 'daylight' }).theme, 'light');
  // an explicit new-shape theme wins over a stale legacy palette field
  assert.equal(normalizePreferences({ theme: 'light', palette: 'console' }).theme, 'light');
});

test('loadPreferences parses saved localStorage JSON', () => {
  const storage = storageWith({
    [LOCAL_STORAGE_KEY]: JSON.stringify({ theme: 'dark', accent: 'moss' }),
  });

  assert.deepEqual(loadPreferences(storage), { theme: 'dark', accent: 'moss', chromeOS: 'mac', readingScale: 1, lineNumbers: false, reminders: true, editorEngine: 'codemirror', editorFont: 'proportional', previewFont: 'serif', slippageChips: true, slippageDeferrals: 3, slippageAgeDays: 30, wipLimit: 0, shutdownNudge: false, weeklyReviewNudge: false });
});

test('loadPreferences returns defaults for malformed saved JSON', () => {
  const storage = storageWith({ [LOCAL_STORAGE_KEY]: '{bad json' });

  assert.deepEqual(loadPreferences(storage), DEFAULT_PREFERENCES);
});

test('savePreferences stores normalized preferences', () => {
  const storage = storageWith();

  const saved = savePreferences({ theme: 'dark', accent: 'clay', readingScale: 1.25 }, storage);

  assert.deepEqual(saved, { theme: 'dark', accent: 'clay', chromeOS: 'mac', readingScale: 1.25, lineNumbers: false, reminders: true, editorEngine: 'codemirror', editorFont: 'proportional', previewFont: 'serif', slippageChips: true, slippageDeferrals: 3, slippageAgeDays: 30, wipLimit: 0, shutdownNudge: false, weeklyReviewNudge: false });
  assert.equal(storage.getItem(LOCAL_STORAGE_KEY), JSON.stringify(saved));
});

test('resetPreferences clears storage and returns defaults', () => {
  const storage = storageWith({
    [LOCAL_STORAGE_KEY]: JSON.stringify({ theme: 'dark' }),
  });

  const reset = resetPreferences(storage);

  assert.deepEqual(reset, DEFAULT_PREFERENCES);
  assert.equal(storage.getItem(LOCAL_STORAGE_KEY), null);
});

test('applyPreferences writes the theme attribute and property overrides', () => {
  const body = bodyStub();

  applyPreferences({ theme: 'dark', accent: 'indigo', readingScale: 1.1 }, body);

  assert.equal(body.getAttribute('data-theme'), 'dark');
  assert.equal(body.style.getPropertyValue('--accent-choice'), ACCENT_CSS.indigo);
  assert.equal(body.style.getPropertyValue('--reading-scale'), '1.1');
  // integer-pixel editor line-height: round(15 * 1.1 * 1.7) = round(28.05) = 28
  assert.equal(body.style.getPropertyValue('--pe-lh'), '28px');
});

test('applyPreferences rounds --pe-lh to an integer pixel across reading scales', () => {
  const b1 = bodyStub();
  applyPreferences({ theme: 'light', readingScale: 1 }, b1);
  assert.equal(b1.style.getPropertyValue('--pe-lh'), '26px'); // round(25.5)
  const b2 = bodyStub();
  applyPreferences({ theme: 'light', readingScale: 1.25 }, b2);
  assert.equal(b2.style.getPropertyValue('--pe-lh'), '32px'); // round(31.875)
});

test('editor font preference defaults to proportional and validates against the option set', () => {
  assert.deepEqual([...EDITOR_FONT_OPTIONS], ['proportional', 'monospace']);
  assert.equal(normalizePreferences({}).editorFont, 'proportional');
  assert.equal(normalizePreferences({ editorFont: 'monospace' }).editorFont, 'monospace');
  assert.equal(normalizePreferences({ editorFont: 'comic-sans' }).editorFont, 'proportional');
});

test('applyPreferences writes the editor-font attribute (drives --pe-font)', () => {
  const body = bodyStub();
  applyPreferences({ theme: 'light', editorFont: 'monospace' }, body);
  assert.equal(body.getAttribute('data-editor-font'), 'monospace');
  applyPreferences({ theme: 'light' }, body); // default
  assert.equal(body.getAttribute('data-editor-font'), 'proportional');
});

test('preview font preference defaults to serif and validates against the option set', () => {
  assert.deepEqual([...PREVIEW_FONT_OPTIONS], ['serif', 'sans', 'mono']);
  assert.equal(normalizePreferences({}).previewFont, 'serif');
  assert.equal(normalizePreferences({ previewFont: 'mono' }).previewFont, 'mono');
  assert.equal(normalizePreferences({ previewFont: 'wingdings' }).previewFont, 'serif');
});

test('applyPreferences writes the preview-font attribute (drives --prose-font)', () => {
  const body = bodyStub();
  applyPreferences({ theme: 'light', previewFont: 'mono' }, body);
  assert.equal(body.getAttribute('data-preview-font'), 'mono');
  applyPreferences({ theme: 'light' }, body); // default
  assert.equal(body.getAttribute('data-preview-font'), 'serif');
});

test('applyPreferences clears the accent-choice override for the default fern accent', () => {
  const body = bodyStub();

  applyPreferences({ theme: 'light', accent: 'indigo' }, body);
  applyPreferences({ theme: 'light', accent: 'fern' }, body);

  assert.equal(body.style.getPropertyValue('--accent-choice'), undefined);
});

test('line numbers preference is a strict boolean, default off', () => {
  assert.equal(normalizePreferences({}).lineNumbers, false);
  assert.equal(normalizePreferences({ lineNumbers: true }).lineNumbers, true);
  assert.equal(normalizePreferences({ lineNumbers: 'yes' }).lineNumbers, false);
  // reminders is opt-out: on unless explicitly false
  assert.equal(normalizePreferences({}).reminders, true);
  assert.equal(normalizePreferences({ reminders: false }).reminders, false);
  assert.equal(normalizePreferences({ reminders: 'nope' }).reminders, true);
});
