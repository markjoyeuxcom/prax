// `prax triage` (the Prax Library document "Prax design: triage TUI"): the
// guard, the review-walk ordering, and the keyboard flow over a fake client
// and fake TTY streams, plus one end-to-end pass against a real app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';
import {
  bodyExcerpt, createTriageClient, decodeKeys, orderReviewQueue, renderCard, sanitizeTerminalText, triage,
} from '../../cli/lib/triage.js';
import { AGENT_ENV_MARKERS } from '../../cli/lib/verify.js';
import { buildLibraryModel } from '../../public/js/renderLibrary.js';
import { createDb } from '../../server/db.js';
import { runMigrations } from '../../server/migrate.js';
import { buildApp } from '../../server/index.js';

const hex = (ch) => ch.repeat(64);
const NOW = new Date('2026-09-23T12:00:00.000Z');

function agentDoc(overrides = {}) {
  return {
    id: randomUUID(),
    title: 'Agent note',
    body: 'Short body.',
    documentType: 'note',
    projectId: 'p1',
    tags: [],
    kind: 'source',
    updatedBy: 'agent',
    updatedByAgent: 'claude',
    verified: false,
    verifiedBy: null,
    status: 'active',
    archivedAt: null,
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-21T10:00:00.000Z',
    revision: hex('a'),
    contentHash: hex('b'),
    ...overrides,
  };
}

// A fake TTY: the keys are queued up front and the input then ends, so a
// flow that asks for more keys than the script gives quits instead of hanging.
function fakeTty(keys = '') {
  const input = new PassThrough();
  input.isTTY = true;
  input.rawModes = [];
  input.setRawMode = (on) => { input.rawModes.push(on); return input; };
  const output = { isTTY: true, columns: 80, text: '', write(s) { this.text += s; return true; } };
  input.end(keys);
  return { input, output };
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function fakeClient(docs, overrides = {}) {
  const store = new Map(docs.map((d) => [d.id, { ...d }]));
  const calls = [];
  let revisionCounter = 0;
  const client = {
    base: 'http://fake',
    calls,
    store,
    listProjects: async () => { calls.push(['listProjects']); return [{ id: 'p1', slug: 'prax' }, { id: 'p2', slug: 'homelab' }]; },
    listDocuments: async (params = {}) => {
      calls.push(['listDocuments', params]);
      let all = [...store.values()].filter((d) => !d.archivedAt);
      if (params.q) all = all.filter((d) => d.title.toLowerCase().includes(params.q.toLowerCase()));
      if (params.status) all = all.filter((d) => d.status === params.status);
      return all.map((d) => ({ ...d }));
    },
    getDocument: async (id) => {
      const d = store.get(id);
      if (!d) throw httpError(404, 'document not found');
      return { ...d };
    },
    listCodeRefs: async () => [],
    similarDocuments: async () => ({ items: [], degraded: false }),
    verify: async (id, body) => {
      calls.push(['verify', id, body]);
      const d = store.get(id);
      if (d.revision !== body.revision) throw httpError(409, 'document changed since it was reviewed');
      Object.assign(d, { verified: true, verifiedBy: body.as });
      return { ...d };
    },
    updateBody: async (id, body) => {
      calls.push(['updateBody', id, body]);
      const d = store.get(id);
      if (body.ifRevision && d.revision !== body.ifRevision) throw httpError(409, 'revision mismatch');
      revisionCounter += 1;
      Object.assign(d, { body: body.body, updatedBy: 'user', updatedByAgent: null, revision: hex(String(revisionCounter % 10)) });
      return { ...d };
    },
    supersede: async (id, replacementId) => {
      calls.push(['supersede', id, replacementId]);
      Object.assign(store.get(id), { status: 'superseded' });
      return { ...store.get(id) };
    },
    archive: async (id) => {
      calls.push(['archive', id]);
      Object.assign(store.get(id), { archivedAt: NOW.toISOString() });
      return { ...store.get(id) };
    },
    ...overrides,
  };
  return client;
}

const writes = (client) => client.calls.filter(([name]) => ['verify', 'updateBody', 'supersede', 'archive'].includes(name));

async function run(client, keys, options = {}) {
  const { input, output } = fakeTty(keys);
  const result = await triage({
    input, output, env: {}, client, now: () => NOW, ...options,
  });
  return { result, output: output.text, input };
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

test('triage refuses in every agent CLI environment before any request', async () => {
  for (const { variable } of AGENT_ENV_MARKERS) {
    const client = fakeClient([agentDoc()]);
    const { input, output } = fakeTty('v');
    await assert.rejects(
      triage({ input, output, env: { [variable]: variable === 'PRAX_AGENT' ? 'codex' : '1' }, client, as: 'Mark' }),
      (err) => {
        assert.equal(err.reason, 'agent-environment', variable);
        assert.match(err.message, new RegExp(`triage is for a person.*${variable}`));
        assert.doesNotMatch(err.message, /unset|--i-am-human/, 'the refusal offers no bypass');
        return true;
      },
    );
    assert.deepEqual(client.calls, [], `${variable}: no request before the refusal`);
    assert.deepEqual(input.rawModes, [], 'the terminal was never put in raw mode');
  }
});

test('triage refuses without an interactive terminal or raw mode', async () => {
  const client = fakeClient([agentDoc()]);
  const notTty = new PassThrough();
  await assert.rejects(
    triage({ input: notTty, output: { isTTY: true, write() {} }, env: {}, client }),
    /triage requires an attended interactive terminal/,
  );
  const { input, output } = fakeTty();
  await assert.rejects(
    triage({ input, output: { isTTY: false, write() {} }, env: {}, client }),
    /attended interactive terminal/,
  );
  const noRaw = new PassThrough();
  noRaw.isTTY = true;
  await assert.rejects(triage({ input: noRaw, output, env: {}, client }), /attended interactive terminal/);
  assert.deepEqual(client.calls, []);
});

test('a blank --as is refused', async () => {
  const client = fakeClient([agentDoc()]);
  const { input, output } = fakeTty();
  await assert.rejects(triage({ input, output, env: {}, client, as: '  ' }), /--as needs a non-empty name/);
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

function mixedLibrary() {
  return [
    agentDoc({ title: 'Old note', documentType: 'note', updatedAt: '2026-09-01T00:00:00.000Z' }),
    agentDoc({ title: 'New note', documentType: 'note', updatedAt: '2026-09-22T00:00:00.000Z' }),
    agentDoc({ title: 'A decision', documentType: 'decision', updatedAt: '2026-09-23T00:00:00.000Z' }),
    agentDoc({ title: 'A runbook', documentType: 'runbook', updatedAt: '2026-08-01T00:00:00.000Z' }),
    agentDoc({ title: 'Synth ref', documentType: 'reference', kind: 'synthesized', updatedBy: 'user', updatedAt: '2026-09-10T00:00:00.000Z' }),
    agentDoc({ title: 'Legacy type', documentType: 'memo', updatedAt: '2026-09-05T00:00:00.000Z' }),
    agentDoc({ title: 'Verified', verified: true }),
    agentDoc({ title: 'Human', updatedBy: 'user' }),
    agentDoc({ title: 'Superseded', status: 'superseded' }),
    agentDoc({ title: 'Deprecated', status: 'deprecated', documentType: 'post-mortem' }),
    agentDoc({ title: 'Archived', archivedAt: '2026-09-02T00:00:00.000Z' }),
  ];
}

test('the queue order is the Library review walk order (default sort and grouping)', () => {
  const documents = mixedLibrary();
  const ordered = orderReviewQueue(documents).map((d) => d.title);
  assert.deepEqual(ordered, ['A runbook', 'New note', 'Legacy type', 'Old note', 'A decision', 'Synth ref', 'Deprecated']);
  const model = buildLibraryModel({
    documents,
    libraryView: 'review',
    libraryGroupBy: 'type',
    librarySortBy: 'updated',
    activeLibraryTags: [],
    libraryTypes: [],
    libraryTrust: [],
    libraryProjects: [],
    libraryQuery: '',
  }, { limit: 10_000 });
  assert.deepEqual(ordered, model.groups.flatMap((group) => group.docs).map((d) => d.title));
});

test('the session walks the queue in that order and passes --project to the listing', async () => {
  const client = fakeClient(mixedLibrary());
  const { result, output } = await run(client, 'nnnnnnn', { project: 'prax' });
  assert.deepEqual(client.calls.find(([name]) => name === 'listDocuments')[1], { project: 'prax' });
  const titles = ['A runbook', 'New note', 'Legacy type', 'Old note', 'A decision', 'Synth ref', 'Deprecated'];
  const positions = titles.map((title) => output.indexOf(`\n${title}\n`));
  assert.ok(positions.every((p) => p > 0), output);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(output, /── 1 of 7 ── runbook/);
  assert.equal(result.counts.skipped, 7);
  assert.equal(result.notReached, 0);
  assert.deepEqual(writes(client), []);
});

test('a document handled elsewhere after the snapshot is skipped as already handled', async () => {
  const first = agentDoc({ title: 'First', updatedAt: '2026-09-22T00:00:00.000Z' });
  const second = agentDoc({ title: 'Second', updatedAt: '2026-09-21T00:00:00.000Z' });
  const gone = agentDoc({ title: 'Gone', updatedAt: '2026-09-20T00:00:00.000Z' });
  const client = fakeClient([first, second, gone]);
  const getDocument = client.getDocument;
  client.getDocument = async (id) => {
    if (id === first.id) return { ...client.store.get(id), verified: true };
    if (id === gone.id) throw httpError(404, 'document not found');
    return getDocument(id);
  };
  const { result, output } = await run(client, 'n');
  assert.doesNotMatch(output, /\nFirst\n/);
  assert.match(output, /── 2 of 3 ──/);
  assert.equal(result.counts.handled, 2);
  assert.equal(result.counts.skipped, 1);
  assert.match(output, /Triage finished: 1 skipped, 2 already handled\./);
});

test('an empty queue says so and exits', async () => {
  const client = fakeClient([agentDoc({ verified: true })]);
  const { result, output, input } = await run(client, '');
  assert.match(output, /The review queue is empty: nothing to triage\./);
  assert.equal(result.total, 0);
  assert.equal(input.rawModes.at(-1), false, 'raw mode restored');
});

// ---------------------------------------------------------------------------
// Keyboard flow
// ---------------------------------------------------------------------------

test('v verifies the shown revision as --as and moves on; the summary counts it', async () => {
  const doc = agentDoc({ title: 'Verify me' });
  const client = fakeClient([doc]);
  const { result, output, input } = await run(client, 'v', { as: 'Mark' });
  assert.deepEqual(writes(client), [['verify', doc.id, { as: 'Mark', revision: hex('a'), contentHash: hex('b') }]]);
  assert.match(output, /v verify as Mark · e edit · s supersede · r archive · n skip/);
  assert.match(output, /Verified as Mark\./);
  assert.match(output, /Triage finished: 1 verified\./);
  assert.equal(result.counts.verified, 1);
  assert.equal(input.rawModes[0], true);
  assert.equal(input.rawModes.at(-1), false);
});

test('v asks for a name once when --as is absent, and a blank name verifies nothing', async () => {
  const a = agentDoc({ title: 'A', updatedAt: '2026-09-22T00:00:00.000Z' });
  const b = agentDoc({ title: 'B', updatedAt: '2026-09-21T00:00:00.000Z' });
  const client = fakeClient([a, b]);
  const { output } = await run(client, 'vMaya\rv');
  assert.equal(output.match(/Verify as \(your name\)/g).length, 1);
  assert.deepEqual(writes(client).map(([, id, body]) => [id, body.as]), [[a.id, 'Maya'], [b.id, 'Maya']]);

  const blank = fakeClient([agentDoc()]);
  const { output: out2 } = await run(blank, 'v\rq');
  assert.match(out2, /No name given; not verified\./);
  assert.deepEqual(writes(blank), []);
});

test('a truncated body must be shown in full before v verifies it', async () => {
  const body = Array.from({ length: 45 }, (_, i) => `line ${i + 1}`).join('\n');
  const doc = agentDoc({ body });
  const client = fakeClient([doc]);
  const { output } = await run(client, 'vq', { as: 'Mark' });
  assert.match(output, /15 more lines — f shows the full body/);
  assert.match(output, /line 45/);
  assert.match(output, /Press v again to verify this revision\./);
  assert.deepEqual(writes(client), [], 'the first v only shows the full body');

  const again = fakeClient([{ ...doc }]);
  await run(again, 'vv', { as: 'Mark' });
  assert.equal(writes(again).length, 1);

  const viaF = fakeClient([{ ...doc }]);
  await run(viaF, 'fv', { as: 'Mark' });
  assert.equal(writes(viaF).length, 1, 'f then v verifies straight away');
});

test('a verify conflict reloads the current revision, which v then verifies', async () => {
  const doc = agentDoc({ body: 'Shown body' });
  const client = fakeClient([doc]);
  const realVerify = client.verify;
  let first = true;
  client.verify = async (id, body) => {
    if (first) {
      first = false;
      Object.assign(client.store.get(id), { body: 'Changed by an agent', revision: hex('c') });
    }
    return realVerify(id, body);
  };
  const { output, result } = await run(client, 'vv', { as: 'Mark' });
  assert.match(output, /Not verified: the document changed since it was shown\. Showing the current revision\./);
  assert.match(output, /Changed by an agent/);
  assert.deepEqual(writes(client).map(([, , body]) => body.revision), [hex('a'), hex('c')]);
  assert.equal(result.counts.verified, 1);
});

test('an unknown verify outcome is reconciled by re-reading, never re-sent', async () => {
  const committed = fakeClient([agentDoc()]);
  committed.verify = async (id, body) => {
    committed.calls.push(['verify', id, body]);
    Object.assign(committed.store.get(id), { verified: true, verifiedBy: body.as });
    throw new Error('Write outcome unknown; reconcile before retrying.');
  };
  const { output, result } = await run(committed, 'v', { as: 'Mark' });
  assert.match(output, /Verified as Mark \(confirmed by re-reading the document\)\./);
  assert.equal(result.counts.verified, 1);
  assert.equal(writes(committed).length, 1);

  const lost = fakeClient([agentDoc()]);
  lost.verify = async (id, body) => { lost.calls.push(['verify', id, body]); throw new Error('socket hang up'); };
  const { output: out2, result: r2 } = await run(lost, 'vq', { as: 'Mark' });
  assert.match(out2, /Verification outcome unknown; check the document before retrying/);
  assert.equal(r2.counts.verified, 0);
  assert.equal(writes(lost).length, 1);
});

test('e saves the edited body against the shown revision with an operation id, then v verifies the saved revision', async () => {
  const doc = agentDoc({ body: 'Agent draft' });
  const client = fakeClient([doc]);
  let cleaned = 0;
  const edit = async (text) => {
    assert.equal(text, 'Agent draft');
    return { text: 'Human-corrected body', file: '/tmp/x/document.md', cleanup() { cleaned += 1; } };
  };
  const { output, result } = await run(client, 'ev', { as: 'Mark', edit });
  const [update, verify] = writes(client);
  assert.equal(update[0], 'updateBody');
  assert.equal(update[2].body, 'Human-corrected body');
  assert.equal(update[2].ifRevision, hex('a'));
  assert.match(update[2].operationId, /^[0-9a-f-]{36}$/);
  assert.match(output, /Saved\. Review the saved revision; v verifies it\./);
  assert.match(output, /Human-corrected body/);
  assert.equal(verify[0], 'verify');
  assert.equal(verify[2].revision, hex('1'), 'the saved revision is the one verified');
  assert.equal(cleaned, 1);
  assert.deepEqual({ edited: result.counts.edited, verified: result.counts.verified, skipped: result.counts.skipped }, { edited: 1, verified: 1, skipped: 0 });
});

test('e writes nothing for an unchanged, blank or cancelled edit', async () => {
  for (const [edit, pattern] of [
    [async (text) => ({ text, cleanup() {} }), /No changes\./],
    [async () => ({ text: '   \n', cleanup() {} }), /An empty body is not saved/],
    [async () => ({ cancelled: 'vi exited with status 1' }), /Edit discarded: vi exited with status 1\./],
  ]) {
    const client = fakeClient([agentDoc()]);
    const { output } = await run(client, 'eq', { as: 'Mark', edit });
    assert.match(output, pattern);
    assert.deepEqual(writes(client).filter(([name]) => name === 'updateBody'), []);
  }
});

test('an edit conflict keeps the draft on disk and shows the current revision', async () => {
  const doc = agentDoc({ body: 'Original' });
  const client = fakeClient([doc]);
  let cleaned = 0;
  const edit = async () => {
    Object.assign(client.store.get(doc.id), { body: 'Someone else saved', revision: hex('d') });
    return { text: 'My edit', file: '/tmp/prax-triage-x/document.md', cleanup() { cleaned += 1; } };
  };
  const { output } = await run(client, 'eq', { as: 'Mark', edit });
  assert.match(output, /Not saved: the document changed since it was shown\. Your draft is kept at \/tmp\/prax-triage-x\/document\.md\./);
  assert.match(output, /Someone else saved/);
  assert.equal(cleaned, 0);
});

test('an unknown edit outcome is reconciled by re-reading the body', async () => {
  const client = fakeClient([agentDoc()]);
  const realUpdate = client.updateBody;
  client.updateBody = async (id, body) => { await realUpdate(id, body); throw new Error('Write outcome unknown'); };
  const { output, result } = await run(client, 'eq', { as: 'Mark', edit: async () => ({ text: 'Saved anyway', cleanup() {} }) });
  assert.match(output, /Saved \(confirmed by re-reading the document\)/);
  assert.equal(result.counts.edited, 1);
});

test('s supersedes with a numbered similar document after a y confirmation', async () => {
  const doc = agentDoc({ title: 'Duplicate' });
  const other = agentDoc({ title: 'Canonical', verified: true, projectId: 'p2' });
  const client = fakeClient([doc, other], {
    similarDocuments: async () => ({ items: [{ ...other, similarity: 0.91 }], degraded: false }),
  });
  const { output, result } = await run(client, 's1\ry', { as: 'Mark' });
  assert.match(output, /Similar:\n {2}1\. Canonical \[verified\] 0\.91 · in homelab/);
  assert.match(output, /Retire "Duplicate" in favour of "Canonical" \[verified\]\? \[y\/N\] y/);
  assert.deepEqual(writes(client), [['supersede', doc.id, other.id]]);
  assert.equal(result.counts.superseded, 1);
});

test('s can search for the replacement, and n at the confirmation cancels', async () => {
  const doc = agentDoc({ title: 'Postgres restore draft', updatedAt: '2026-09-22T00:00:00.000Z' });
  const target = agentDoc({ title: 'Postgres restore runbook', verified: true, documentType: 'runbook' });
  const client = fakeClient([doc, target]);
  const { output } = await run(client, 'spostgres\r1\ry', { as: 'Mark' });
  assert.deepEqual(client.calls.find(([name, params]) => name === 'listDocuments' && params.q), ['listDocuments', { q: 'postgres', status: 'active' }]);
  assert.match(output, / {2}1\. Postgres restore runbook \[verified\] · in prax/);
  assert.deepEqual(writes(client), [['supersede', doc.id, target.id]]);

  const cancel = fakeClient([{ ...doc }, { ...target }]);
  const { output: out2 } = await run(cancel, 'spostgres\r1\rnq', { as: 'Mark' });
  assert.match(out2, /Supersede cancelled\./);
  assert.deepEqual(writes(cancel), []);

  const empty = fakeClient([{ ...doc }]);
  const { output: out3 } = await run(empty, 's\rq', { as: 'Mark' });
  assert.match(out3, /Supersede cancelled\./);
  assert.deepEqual(writes(empty), []);
});

test('r archives after a y confirmation; any other key cancels', async () => {
  const doc = agentDoc({ title: 'Wrong' });
  const client = fakeClient([doc]);
  const { output, result } = await run(client, 'ry', { as: 'Mark' });
  assert.match(output, /Archive "Wrong"\? It can be restored from Library → Archive\. \[y\/N\] y/);
  assert.deepEqual(writes(client), [['archive', doc.id]]);
  assert.equal(result.counts.archived, 1);

  const keep = fakeClient([agentDoc()]);
  const { output: out2 } = await run(keep, 'rxq', { as: 'Mark' });
  assert.match(out2, /Archive cancelled\./);
  assert.deepEqual(writes(keep), []);
});

test('q, Ctrl-C and Ctrl-D quit with a summary; other keys re-print the key line', async () => {
  for (const key of ['q', '\x03', '\x04']) {
    const client = fakeClient([agentDoc(), agentDoc()]);
    const { output, result, input } = await run(client, `n${key}`, { as: 'Mark' });
    assert.equal(result.quit, true);
    assert.equal(result.notReached, 1);
    assert.match(output, /Triage finished: 1 skipped\. 1 left undecided\. Skipped and undecided documents stay in the review queue\./);
    assert.equal(input.rawModes.at(-1), false);
  }
  const client = fakeClient([agentDoc()]);
  const { output } = await run(client, 'x?q', { as: 'Mark' });
  assert.equal(output.match(/v verify as Mark/g).length, 2);
  assert.match(output, /r {2}reject: archive this document/);
});

test('agent-written text cannot hide content with terminal control sequences', async () => {
  const rlo = String.fromCharCode(0x202e);
  const doc = agentDoc({ title: 'Clean\x1b[2J title', body: `Visible\x1b[8mhidden${rlo}text\rover`, tags: ['a\x07b'] });
  const client = fakeClient([doc]);
  const { output } = await run(client, 'q', { as: 'Mark' });
  assert.equal(output.includes('\x1b'), false, 'no raw escape reaches the terminal');
  assert.equal(output.includes(rlo), false);
  assert.match(output, /Clean\^\[\[2J title/);
  assert.match(output, /Visible\^\[\[8mhidden<U\+202E>text\^Mover/);
  assert.match(output, /tags a\^Gb/);
  assert.equal(sanitizeTerminalText('a\r\nb\tc'), 'a\nb\tc');
});

test('the card shows project, trust, age, writer, citations and a degraded similar list', () => {
  const doc = agentDoc({ title: 'Cited', tags: ['cli'] });
  const { text } = renderCard(doc, {
    citations: {
      citations: [
        { status: 'current', path: 'cli/prax.js', startLine: 10, endLine: 20, note: '' },
        { status: 'changed', path: 'server/x.js', startLine: 1, endLine: 2, note: 'server/x.js changed since this was written' },
      ],
      citationCheck: { checked: 2, unchecked: 1, reason: 'other-repository', reasons: ['other-repository'] },
    },
    similar: { items: [], degraded: true, reason: 'semantic-off' },
  }, { position: 1, total: 2, now: NOW, slugOf: (id) => (id === 'p1' ? 'prax' : null) });
  assert.match(text, /── 1 of 2 ── note ─+/);
  assert.match(text, /in prax · unverified · 2d old · via claude · created 2026-09-2\d/);
  assert.match(text, /tags cli/);
  assert.match(text, /Citations: cli\/prax\.js:10-20 current\n {11}server\/x\.js changed since this was written\n {11}1 citation not checked \(cited in another repository\)/);
  assert.match(text, /Similar: semantic search is off/);
});

test('bodyExcerpt bounds lines and characters and reports what was cut', () => {
  assert.deepEqual(bodyExcerpt('a\nb'), { text: 'a\nb', truncated: false, remainingLines: 0 });
  const long = bodyExcerpt(Array.from({ length: 40 }, (_, i) => `l${i}`).join('\n'));
  assert.equal(long.truncated, true);
  assert.equal(long.remainingLines, 10);
  const wide = bodyExcerpt('word '.repeat(1000));
  assert.equal(wide.truncated, true);
  assert.ok(wide.text.length <= 2400);
});

test('decodeKeys reads raw bytes as keys and swallows escape sequences', () => {
  assert.deepEqual(decodeKeys('v\r\n\x7f\x03\x04').map((k) => k.name), ['char', 'enter', 'backspace', 'ctrl-c', 'ctrl-d']);
  assert.deepEqual(decodeKeys('\x1b[A\x1bOBn').map((k) => k.name), ['sequence', 'sequence', 'char']);
  assert.deepEqual(decodeKeys('\x1b').map((k) => k.name), ['escape']);
  const emoji = String.fromCodePoint(0x1f600);
  assert.deepEqual(decodeKeys(emoji), [{ name: 'char', char: emoji }]);
});

// ---------------------------------------------------------------------------
// The client: human origin, receipted edit
// ---------------------------------------------------------------------------

function jsonRes(status, body) {
  return {
    ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body),
  };
}

test('the triage client writes as a person and resends an edit only with the same operation id', async () => {
  const seen = [];
  let failFirstUpdate = true;
  const fetch = async (url, opts) => {
    seen.push({ url, method: opts.method, headers: opts.headers, body: opts.body && JSON.parse(opts.body) });
    if (url.endsWith('/update') && failFirstUpdate) {
      failFirstUpdate = false;
      throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } });
    }
    return jsonRes(200, {});
  };
  const client = createTriageClient({ baseUrl: 'http://x', env: { PRAX_AGENT: 'codex', CLAUDECODE: '1' }, fetch });
  const id = randomUUID();
  await client.verify(id, { as: 'Mark', revision: hex('a'), contentHash: hex('b') });
  await client.updateBody(id, { body: 'B', ifRevision: hex('a'), operationId: 'op-1' });
  await client.supersede(id, 'other');
  await client.archive(id);
  for (const request of seen) {
    assert.equal(request.headers['x-prax-origin'], undefined, `${request.method} ${request.url}`);
    assert.equal(request.headers['x-prax-agent'], undefined);
  }
  const updates = seen.filter((r) => r.url.endsWith('/update'));
  assert.equal(updates.length, 2, 'a receipted edit is resent once after a lost response');
  assert.deepEqual(updates[0].body, updates[1].body);
  assert.deepEqual(updates[0].body, { body: 'B', ifRevision: hex('a'), operationId: 'op-1' });
  assert.deepEqual(seen.map((r) => r.method), ['POST', 'POST', 'POST', 'POST', 'DELETE']);
  assert.deepEqual(seen[0].body, { verified: true, as: 'Mark', revision: hex('a'), contentHash: hex('b') });
  assert.deepEqual(seen[3].body, { supersededBy: 'other' });
});

// ---------------------------------------------------------------------------
// End to end against a real app
// ---------------------------------------------------------------------------

const SILENT = { info() {}, error() {}, warn() {} };

test('end to end: verify, edit then verify, supersede and archive over the real routes', async () => {
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT });
  const app = await buildApp({ db });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const project = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'triage-e2e' } })).json();
    const create = async (title, documentType, headers = { 'x-prax-origin': 'agent', 'x-prax-agent': 'claude' }) => {
      const res = await app.inject({
        method: 'POST', url: '/api/library/documents', headers, payload: { title, body: `${title} body`, documentType, project: project.slug },
      });
      assert.equal(res.statusCode, 201, res.body);
      return res.json();
    };
    // Queue order: runbook first, then notes newest first.
    const runbook = await create('Restore runbook', 'runbook');
    const noteOld = await create('Old note', 'note');
    await new Promise((resolve) => { setTimeout(resolve, 5); });
    const noteNew = await create('New note', 'note');
    const decision = await create('Draft decision', 'decision');
    const canonical = await create('Canonical decision', 'decision', {});

    const client = createTriageClient({ baseUrl: url, env: {} });
    const edit = async () => ({ text: 'Corrected by a person', cleanup() {} });
    // runbook: v · new note: e then v · old note: r y · draft decision: s <canonical id> y
    const { result, output } = await run(client, `vevrys${canonical.id}\ry`, { as: 'Mark', project: project.slug, edit });
    assert.equal(result.total, 4, output);
    assert.deepEqual(result.counts, { verified: 2, edited: 1, superseded: 1, archived: 1, skipped: 0, handled: 0 });

    const get = async (id) => (await app.inject({ method: 'GET', url: `/api/library/documents/${id}` })).json();
    const r = await get(runbook.id);
    assert.equal(r.verified, true);
    assert.equal(r.verifiedBy, 'Mark');
    const n = await get(noteNew.id);
    assert.equal(n.body, 'Corrected by a person');
    assert.equal(n.updatedBy, 'user', 'a triage edit is a human edit');
    assert.equal(n.updatedByAgent, null);
    assert.equal(n.verified, true);
    const o = await get(noteOld.id);
    assert.ok(o.archivedAt, 'rejected by archiving');
    const d = await get(decision.id);
    assert.equal(d.status, 'superseded');
    assert.equal(d.verified, false);
  } finally {
    await app.close();
  }
});
