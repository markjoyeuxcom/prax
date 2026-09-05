import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectDrafts } from '../../public/js/projectDrafts.js';
const storage = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,v) }; };

test('project drafts flush all edited fields, retaining newer edits during the request', async () => {
  let release, seen;
  const gate = new Promise(r => { release = r; });
  const started = new Promise(r => { seen = r; });
  const writes = [];
  const drafts = createProjectDrafts({ storage: storage(), save: async (id, patch) => { writes.push(patch); if (writes.length === 1) { seen(); await gate; } return {id,...patch}; } });
  drafts.set('p','onCall','first'); drafts.set('p','handoffNotes','second');
  const saving = drafts.flush('p'); await started;
  drafts.set('p','onCall','newer'); release(); await saving;
  assert.deepEqual(writes, [{onCall:'first',handoffNotes:'second'},{onCall:'newer'}]);
  assert.equal(drafts.hasPending(), false);
});
test('failed project saves remain recoverable after reload', async () => {
  const store = storage();
  const drafts = createProjectDrafts({ storage:store, save:async()=>{throw Error('offline');} });
  drafts.set('p','area','recover me');
  assert.equal(await drafts.flush('p'),false);
  const restarted = createProjectDrafts({storage:store, save:async(id,patch)=>({id,...patch})});
  assert.deepEqual(restarted.overlay([{id:'p',area:null}]),[{id:'p',area:'recover me'}]);
  await restarted.flush('p'); assert.equal(restarted.hasPending(),false);
});
