import test from 'node:test';
import assert from 'node:assert/strict';
import { documentDraftPatch, mergeDocumentDraft } from '../../public/js/documentDraftMerge.js';
test('a body-only draft keeps an independently changed remote title',()=>{
  const base={title:'old',body:'body',revision:'one'};
  assert.deepEqual(documentDraftPatch(base,{title:'old',body:'mine'}),{body:'mine',ifRevision:'one'});
  const merged=mergeDocumentDraft(base,{title:'old',body:'mine'},{title:'remote',body:'body',revision:'two'});
  assert.deepEqual(merged,{draft:{title:'remote',body:'mine'},conflicts:[]});
});
test('concurrent edits to the same field require explicit conflict resolution',()=>{
  assert.deepEqual(mergeDocumentDraft({title:'title',body:'base'},{title:'title',body:'mine'},{title:'renamed',body:'theirs'}),{draft:{title:'renamed',body:'mine'},conflicts:['body']});
});
