import test from 'node:test';
import assert from 'node:assert/strict';
import {
  areSameTags,
  createSavedLibraryView,
  renameSavedLibraryView,
  sanitizeSavedLibraryViews,
  savedLibraryViewsFromJson,
} from '../../public/js/librarySavedViews.js';

test('createSavedLibraryView normalizes labels and tags', () => {
  assert.deepEqual(createSavedLibraryView(' Cloudflare ', ['Tunnel', 'cloudflare', '']), {
    id: 'cloudflare-cloudflare-tunnel',
    label: 'Cloudflare',
    tags: ['cloudflare', 'tunnel'],
  });
});

test('createSavedLibraryView rejects blank labels or empty tag sets', () => {
  assert.equal(createSavedLibraryView('', ['cloudflare']), null);
  assert.equal(createSavedLibraryView('Cloudflare', []), null);
});

test('sanitizeSavedLibraryViews drops malformed and duplicate views', () => {
  assert.deepEqual(sanitizeSavedLibraryViews([
    { label: 'Cloudflare', tags: ['cloudflare'] },
    { label: 'Cloudflare', tags: ['cloudflare'] },
    { label: '', tags: ['broken'] },
    { label: 'Empty', tags: [] },
  ]), [
    { id: 'cloudflare-cloudflare', label: 'Cloudflare', tags: ['cloudflare'] },
  ]);
});

test('savedLibraryViewsFromJson returns empty array for invalid JSON', () => {
  assert.deepEqual(savedLibraryViewsFromJson('not-json'), []);
});

test('areSameTags compares tag sets regardless of order or case', () => {
  assert.equal(areSameTags(['Cloudflare', 'Tunnel'], ['tunnel', 'cloudflare']), true);
  assert.equal(areSameTags(['cloudflare'], ['cloudflare', 'tunnel']), false);
});

test('renameSavedLibraryView keeps tags and rebuilds identity from the new label', () => {
  assert.deepEqual(
    renameSavedLibraryView(
      { id: 'postgres-backup-postgres', label: 'Postgres Backup', tags: ['backup', 'postgres'] },
      ' Database Recovery ',
    ),
    { id: 'database-recovery-backup-postgres', label: 'Database Recovery', tags: ['backup', 'postgres'] },
  );
});
