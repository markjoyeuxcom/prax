import test from 'node:test';
import assert from 'node:assert/strict';
import { libraryHashFromState, locationFromHash } from '../../public/js/libraryLocation.js';

test('the Library view round-trips through the hash; other views write none', () => {
  const state = { navType: 'library', libraryView: 'review', libraryTypes: ['runbook', 'note'], libraryTrust: ['agent'], libraryProjects: [], activeLibraryTags: ['postgres'], libraryQuery: 'failover', librarySortBy: 'title', libraryGroupBy: 'project', libraryLayout: 'table' };
  const hash = libraryHashFromState(state);
  assert.equal(hash, '#library?view=review&types=runbook%2Cnote&trust=agent&tags=postgres&q=failover&sort=title&group=project&layout=table');
  const back = locationFromHash(hash);
  assert.equal(back.kind, 'library');
  assert.deepEqual(back.patch, { libraryView: 'review', libraryTypes: ['runbook', 'note'], libraryTrust: ['agent'], libraryProjects: [], activeLibraryTags: ['postgres'], libraryQuery: 'failover', librarySemantic: false, librarySortBy: 'title', libraryGroupBy: 'project', libraryLayout: 'table' });
  assert.equal(libraryHashFromState({ navType: 'library', libraryView: 'active' }), '#library');
  assert.equal(libraryHashFromState({ navType: 'today' }), '');
  assert.equal(libraryHashFromState({ navType: 'editor', editorDocId: '0b17bf00-1111-4111-8111-111111111111' }), '', 'an open document writes no address (draft recovery starts from the Library)');
});

test('unknown or malformed hashes are ignored; unknown values fall back', () => {
  assert.equal(locationFromHash(''), null);
  assert.equal(locationFromHash('#inbox'), null);
  assert.equal(locationFromHash('#doc/not-an-id'), null);
  assert.deepEqual(locationFromHash('#doc/0b17bf00-1111-4111-8111-111111111111'), { kind: 'doc', id: '0b17bf00-1111-4111-8111-111111111111' });
  const loose = locationFromHash('#library?view=bogus&sort=bogus&group=bogus&layout=bogus&mode=semantic');
  assert.equal(loose.patch.libraryView, 'active');
  assert.equal(loose.patch.librarySemantic, true);
  assert.equal('librarySortBy' in loose.patch, false);
});
