import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createInboxController, readInboxRecovery } from '../../public/js/inboxController.js';
import { captureLibraryReturn, libraryReturnPatch, libraryViewKey } from '../../public/js/libraryReturn.js';
import { renderInboxDialog } from '../../public/js/renderInbox.js';

const id = randomUUID(), projectId = randomUUID(), fingerprint = 'a'.repeat(64);
const source = { record: { id, title: 'Capture', notes: 'Durable note' }, fingerprint };
const queue = { items: [{ kind: 'task', id }], projects: [{ id: projectId, name: 'Prax' }], page: { total: 1 }, summary: { total: 1 } };
function harness(custom, storage = { getItem() { return this.value; }, setItem(key, value) { this.value = value; } }, refresh = async () => {}) {
  let state = {}; const calls = [], notices = [];
  const controller = createInboxController({ getState: () => state, setState: patch => { state = { ...state, ...patch }; },
    render() {}, toast: message => notices.push(message), refresh, storage, openDocument() {}, openTask() {},
    request: async (path, body) => { calls.push({ path, body: structuredClone(body) });
      if (path.startsWith('?')) return structuredClone(queue);
      if (!body) return structuredClone(source);
      return custom(path, body);
    } });
  return { controller, calls, notices, storage, state: () => state.inbox };
}

test('Library return restores all facets, search, grouping and loaded semantic results without aliasing', () => {
  const state = { libraryProjects: ['prax'], activeLibraryTags: ['ui'], libraryTypes: ['note'], libraryTrust: ['unverified'],
    libraryQuery: 'release', librarySemantic: true, libraryGroupBy: 'none', libraryLayout: 'table', librarySortBy: 'title',
    libraryView: 'review', semanticResults: [{ id: 'a' }], semanticPage: { total: 18 }, semanticLoading: true };
  const snapshot = captureLibraryReturn(state, { scrollTop: 600, documentId: 'a' });
  state.libraryProjects.push('memory'); state.semanticResults[0].id = 'b';
  const patch = libraryReturnPatch(snapshot);
  assert.deepEqual(patch.libraryProjects, ['prax']); assert.equal(patch.semanticResults[0].id, 'a');
  assert.equal(patch.libraryGroupBy, 'none'); assert.equal(patch.libraryLayout, 'table');
  assert.equal(patch.semanticLoading, false); assert.equal(snapshot.pendingSearch, true); assert.equal(snapshot.scrollTop, 600);
  patch.libraryProjects.push('other'); assert.deepEqual(snapshot.patch.libraryProjects, ['prax']);
  assert.notEqual(libraryViewKey(patch), libraryViewKey(state));
});

test('lost action response survives reload and retries exactly the same decision once', async () => {
  let attempts = 0;
  const perform = async (path, body) => { if (++attempts === 1) throw new Error('lost response'); return { ...body, created: [] }; };
  const h = harness(perform); await h.controller.start(); h.controller.change('projectId', projectId);
  await h.controller.apply('reference');
  assert.ok(h.state().processing.request); assert.match(h.state().processing.error, /unconfirmed/);
  const intent = h.state().processing.request;
  h.controller.change('projectId', randomUUID()); assert.equal(h.state().processing.draft.projectId, projectId);
  const recovered = harness(perform, h.storage); await recovered.controller.start();
  assert.equal(recovered.state().processing.recovered, true);
  await recovered.controller.apply();
  assert.deepEqual(recovered.calls.find(call => call.path.endsWith('/actions')).body, intent);
  assert.equal(recovered.state().processing, null); assert.equal(recovered.state().undo.operationId, intent.operationId);
});

test('late AI response cannot populate the next item; using a suggestion only changes the form', async () => {
  let release;
  const h = harness(() => new Promise(resolve => { release = resolve; }));
  await h.controller.start(); const pending = h.controller.suggest();
  await h.controller.skip(); release({ fingerprint, projectId, documentType: 'reference' }); await pending;
  assert.equal(h.state().processing, null);
  const live = harness(async () => ({ fingerprint, projectId, documentType: 'reference' }));
  await live.controller.start(); await live.controller.suggest(); live.controller.useSuggestion();
  assert.equal(live.state().processing.draft.projectId, projectId);
  assert.equal(live.calls.filter(call => call.body).length, 1); assert.ok(live.calls.at(-1).path.endsWith('/suggest'));
});

test('pending writes are single flight; refresh failure remains a committed decision', async () => {
  let release;
  const h = harness((path, body) => new Promise(resolve => { release = () => resolve(body); }), undefined, async () => { throw new Error('refresh'); });
  await h.controller.start(); const pending = h.controller.apply('archive');
  await h.controller.apply('complete'); h.controller.close();
  assert.equal(h.state().processing.pending, true);
  release(); await pending;
  assert.equal(h.calls.filter(call => call.path.endsWith('/actions')).length, 1);
  assert.match(h.state().notice, /Decision saved.*could not refresh/); assert.ok(h.state().undo);
});

test('recovery ignores malformed browser state, and missing sources still show reconciliation', () => {
  assert.equal(readInboxRecovery({ getItem: () => '{' }).active, undefined);
  assert.equal(readInboxRecovery({ getItem: () => JSON.stringify({ version: 1, active: { kind: 'task', id: 'bad' } }) }).active, null);
  const html = renderInboxDialog({ processing: { kind: 'task', id, queue: [{ id }], index: 0, request: { operationId: randomUUID() }, draft: {}, error: '<script>oops</script>' } });
  assert.match(html, /Retry same decision/); assert.doesNotMatch(html, /<script>/);
});
