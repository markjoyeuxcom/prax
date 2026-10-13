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

test('a saved view keeps types, trust, projects, query, sort and grouping, and reopens them', async () => {
  const { createSavedLibraryView: create, savedLibraryViewPatch } = await import('../../public/js/librarySavedViews.js');
  const view = create('Cedar verified decisions', ['production'], { types: ['decision'], trust: ['verified'], projects: ['p1'], query: 'Release', sortBy: 'title', groupBy: 'none' });
  assert.deepEqual(view.filters, { types: ['decision'], trust: ['verified'], projects: ['p1'], query: 'Release', sortBy: 'title', groupBy: 'none' });
  assert.deepEqual(savedLibraryViewPatch(view), { activeLibraryTags: ['production'], libraryTypes: ['decision'], libraryTrust: ['verified'], libraryProjects: ['p1'], libraryQuery: 'Release', librarySemantic: false, libraryView: 'active', librarySortBy: 'title', libraryGroupBy: 'none' });
  // The search mode and the collection are part of the view.
  const semantic = create('Meaning', [], { query: 'how do we fail over', mode: 'semantic', view: 'archive' });
  assert.deepEqual(semantic.filters, { query: 'how do we fail over', mode: 'semantic', view: 'archive' });
  assert.equal(savedLibraryViewPatch(semantic).librarySemantic, true);
  assert.equal(savedLibraryViewPatch(semantic).libraryView, 'archive');
  assert.equal(create('Weird', [], { view: 'tags' }), null, 'only archive and review are collections worth saving');
  const tagless = create('Only runbooks', [], { types: ['runbook'] });
  assert.equal(tagless.tags.length, 0);
  assert.deepEqual(tagless.filters, { types: ['runbook'] });
  assert.notEqual(create('Same', ['a'], { types: ['runbook'] }).id, create('Same', ['a'], { types: ['note'] }).id);
});
