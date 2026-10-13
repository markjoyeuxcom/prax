import test from 'node:test';
import assert from 'node:assert/strict';
import { libraryHashFromState, locationFromHash } from '../../public/js/libraryLocation.js';

test('the Library view round-trips through the hash; other views write none', () => {
  const state = { navType: 'library', libraryView: 'review', libraryTypes: ['runbook', 'note'], libraryTrust: ['agent'], libraryProjects: [], activeLibraryTags: ['postgres'], libraryQuery: 'failover', librarySortBy: 'title', libraryGroupBy: 'project', libraryLayout: 'table' };
  const hash = libraryHashFromState(state);
  assert.equal(hash, '#library?view=review&types=runbook&types=note&trust=agent&tag=postgres&q=failover&sort=title&group=project&layout=table');
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

test('a 0.44.0 address (comma lists, tags=) keeps its meaning', () => {
  const legacy = locationFromHash('#library?types=runbook%2Cnote&trust=agent&projects=p1,p2&tags=ops%2Cpostgres');
  assert.deepEqual(legacy.patch.libraryTypes, ['runbook', 'note']);
  assert.deepEqual(legacy.patch.libraryTrust, ['agent']);
  assert.deepEqual(legacy.patch.libraryProjects, ['p1', 'p2']);
  assert.deepEqual(legacy.patch.activeLibraryTags, ['ops', 'postgres'], 'two tags, not one literal "ops,postgres"');
  const mixed = locationFromHash('#library?tag=one%2Ctwo&tags=ops');
  assert.deepEqual(mixed.patch.activeLibraryTags, ['one,two', 'ops']);
});

test('a tag that contains a comma survives the address (one parameter per value)', () => {
  const hash = libraryHashFromState({ navType: 'library', activeLibraryTags: ['one,two', 'ünï code', 'a%b'] });
  assert.deepEqual(locationFromHash(hash).patch.activeLibraryTags, ['one,two', 'ünï code', 'a%b']);
});
