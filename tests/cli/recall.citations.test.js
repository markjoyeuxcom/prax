// Recall tells an agent when a memory's cited code has moved on.
//
// This is the point of code-pinned memory: not that a citation is stored, but
// that retrieval can say "this claim was written about code that has since
// changed" without anyone having noticed. Checking happens client-side because
// only a working tree can answer it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { recall, formatRecall } from '../../cli/lib/recall.js';
import { hashCitation } from '../../cli/lib/codeRefs.js';

const NOW = new Date('2026-09-11T12:00:00Z');
const CODE = ['const a = 1;', 'const b = 2;', 'const c = 3;'].join('\n');

const client = ({ citations = [], ...over } = {}) => ({
  semanticSearch: async () => ({ items: [{ id: 't', title: 'Bind rule', documentType: 'decision' }], page: null, index: null, degraded: false, reason: null }),
  getDocument: async () => ({ id: 't', body: 'A non-loopback bind needs acknowledgement.', verified: false, status: 'active', updatedAt: '2026-09-10T12:00:00Z' }),
  keywordSearch: async () => [],
  listDocuments: async () => [],
  listCodeRefs: async () => citations,
  ...over,
});

test('a memory whose cited code is unchanged carries no warning', async () => {
  const citations = [{ id: 'r', path: 'server/config.js', startLine: 1, endLine: 2, contentHash: hashCitation('const a = 1;\nconst b = 2;') }];
  const result = await recall(client({ citations }), { query: 'bind', readFile: () => CODE });
  assert.deepEqual(result.top.citations.map((c) => c.status), ['current']);
  assert.doesNotMatch(formatRecall(result, NOW), /changed since/);
});

test('a memory whose cited code changed is flagged in the hit header', async () => {
  const citations = [{ id: 'r', path: 'server/config.js', startLine: 1, endLine: 2, contentHash: hashCitation('WHAT IT USED TO SAY') }];
  const result = await recall(client({ citations }), { query: 'bind', readFile: () => CODE });
  assert.deepEqual(result.top.citations.map((c) => c.status), ['changed']);
  assert.match(formatRecall(result, NOW), /server\/config\.js changed since this was written/);
});

test('code that merely moved is reported without crying stale', async () => {
  const citations = [{ id: 'r', path: 'server/config.js', startLine: 1, endLine: 1, contentHash: hashCitation('const c = 3;') }];
  const out = formatRecall(await recall(client({ citations }), { query: 'bind', readFile: () => CODE }), NOW);
  assert.match(out, /moved to server\/config\.js:3-3/);
  assert.doesNotMatch(out, /changed since/);
});

test('a deleted cited file is reported as gone', async () => {
  const citations = [{ id: 'r', path: 'server/gone.js', startLine: 1, endLine: 1, contentHash: hashCitation('x') }];
  const out = formatRecall(await recall(client({ citations }), { query: 'bind', readFile: () => null }), NOW);
  assert.match(out, /server\/gone\.js is gone/);
});

test('with no working tree to check against, nothing is claimed either way', async () => {
  // Recalling from outside the repository must not imply the memory is fine,
  // and must not imply it has rotted.
  const citations = [{ id: 'r', path: 'server/config.js', startLine: 1, endLine: 1, contentHash: hashCitation('x') }];
  const result = await recall(client({ citations }), { query: 'bind' }); // no readFile
  assert.deepEqual(result.top.citations, []);
  assert.doesNotMatch(formatRecall(result, NOW), /changed since|is gone/);
});

test('a memory with no citations behaves exactly as before', async () => {
  const result = await recall(client({ citations: [] }), { query: 'bind', readFile: () => CODE });
  assert.deepEqual(result.top.citations, []);
  assert.match(formatRecall(result, NOW), /## Bind rule/);
});

test('a server with no citation support does not break recall', async () => {
  const c = client({ listCodeRefs: async () => { throw Object.assign(new Error('not found'), { status: 404 }); } });
  const result = await recall(c, { query: 'bind', readFile: () => CODE });
  assert.deepEqual(result.top.citations, []);
  assert.equal(result.kind, 'hit');
});

// ---- which checkout ------------------------------------------------------------
// Recall is cross-project and citations are repository-relative: a hit about
// another repository must never have its paths read in this one.

const checkout = (over = {}) => ({ readFile: () => null, repoUrl: null, hasCommit: () => false, ...over });
const projects = [
  { id: 'pa', slug: 'repo-a', repoUrl: 'git@gitlab.com:org/repo-a.git' },
  { id: 'mem', slug: 'memory', repoUrl: null },
];
const hitIn = (projectId, citations) => client({
  citations,
  listProjects: async () => projects,
  semanticSearch: async () => ({ items: [{ id: 't', title: 'Bind rule', documentType: 'decision', projectId }], page: null, index: null, degraded: false, reason: null }),
});

test('a citation from another repository is not checked, and says so instead of "gone"', async () => {
  const citations = [{ id: 'r', path: 'src/x.js', startLine: 2, endLine: 2, commitSha: 'a'.repeat(40), contentHash: hashCitation('x') }];
  const here = checkout({ repoUrl: 'https://gitlab.com/org/repo-b' }); // reads null: src/x.js is not here
  const result = await recall(hitIn('pa', citations), { query: 'bind', checkout: here });
  assert.deepEqual(result.top.citations, []);
  assert.deepEqual(result.top.citationCheck, { checked: 0, unchecked: 1, reason: 'other-repository', reasons: ['other-repository'] });
  const out = formatRecall(result, NOW);
  assert.doesNotMatch(out, /is gone|changed since/);
  assert.match(out, /1 citation not checked \(cited in another repository\)/);
});

test('the same repository under another URL spelling is checked', async () => {
  const citations = [{ id: 'r', path: 'server/config.js', startLine: 1, endLine: 1, contentHash: hashCitation('WAS') }];
  const here = checkout({ repoUrl: 'https://gitlab.com/org/repo-a', readFile: () => CODE });
  const result = await recall(hitIn('pa', citations), { query: 'bind', checkout: here });
  assert.deepEqual(result.top.citations.map((c) => c.status), ['changed']);
});

test('a memory-project citation is checked only when its commit exists in this checkout', async () => {
  const sha = 'b'.repeat(40);
  const citations = [{ id: 'r', path: 'server/config.js', startLine: 1, endLine: 1, commitSha: sha, contentHash: hashCitation('WAS') }];
  const ours = await recall(hitIn('mem', citations), {
    query: 'bind', checkout: checkout({ readFile: () => CODE, hasCommit: (s) => s === sha }),
  });
  assert.deepEqual(ours.top.citations.map((c) => c.status), ['changed']);
  const foreign = await recall(hitIn('mem', citations), { query: 'bind', checkout: checkout({ readFile: () => CODE }) });
  assert.deepEqual(foreign.top.citations, []);
  assert.equal(foreign.top.citationCheck.unchecked, 1);
  assert.match(formatRecall(foreign, NOW), /1 citation not checked \(pinned at a commit this checkout does not have\)/);
  // No commit recorded and no repo URL: nothing identifies the repository.
  const unpinned = [{ ...citations[0], commitSha: null }];
  const unknown = await recall(hitIn('mem', unpinned), { query: 'bind', checkout: checkout({ readFile: () => CODE, hasCommit: () => true }) });
  assert.match(formatRecall(unknown, NOW), /1 citation not checked \(the cited repository is not recorded\)/);
});

test('outside a checkout the citations are reported as not checked', async () => {
  const citations = [{ id: 'r', path: 'server/config.js', startLine: 1, endLine: 1, contentHash: hashCitation('x') }];
  const result = await recall(client({ citations }), { query: 'bind' });
  assert.match(formatRecall(result, NOW), /1 citation not checked \(not run inside a checkout\)/);
});

test('a failed citation lookup is reported, not swallowed as "no citations"', async () => {
  const c = client({ listCodeRefs: async () => { throw Object.assign(new Error('boom'), { status: 500 }); } });
  const result = await recall(c, { query: 'bind', readFile: () => CODE });
  assert.equal(result.top.citationCheck.reason, 'unavailable');
  assert.match(formatRecall(result, NOW), /citations not checked \(the citations could not be read\)/);
});

// ---- keyword fallback ---------------------------------------------------------

const keywordClient = (docs, over = {}) => client({
  semanticSearch: async () => { throw Object.assign(new Error('semantic search is not enabled'), { status: 409 }); },
  keywordSearch: async () => docs,
  ...over,
});

test('the keyword fallback reports degraded status and a page, like prax search', async () => {
  const docs = Array.from({ length: 7 }, (_, i) => ({ id: `k${i}`, title: `Doc ${i}`, body: 'postgres' }));
  const result = await recall(keywordClient(docs), { query: 'postgres', limit: 2 });
  assert.equal(result.degraded, true);
  assert.equal(result.reason, 'semantic-not-configured');
  assert.deepEqual(result.page, { returned: 2, total: 7, hasMore: true });
  assert.equal(result.related.length, 1);
  const out = formatRecall(result, NOW);
  assert.match(out, /2 of 7 matches shown/);
  assert.doesNotMatch(out, /index incomplete/);
  const empty = await recall(keywordClient([]), { query: 'postgres' });
  assert.equal(empty.degraded, true);
  assert.equal(empty.reason, 'semantic-not-configured');
});

test('the keyword fallback ranks by term matches rather than listing order', async () => {
  const docs = [
    { id: 'weak', title: 'Backups', body: 'mentions postgres once' },
    { id: 'strong', title: 'Postgres restore', body: 'postgres postgres restore' },
  ];
  const result = await recall(keywordClient(docs), { query: 'postgres restore' });
  assert.equal(result.top.id, 'strong');
});

test('the keyword fallback checks the top hit\'s citations too', async () => {
  const citations = [{ id: 'r', path: 'server/config.js', startLine: 1, endLine: 1, contentHash: hashCitation('WAS') }];
  const c = keywordClient([{ id: 't', title: 'Bind rule', body: 'bind' }], { listCodeRefs: async () => citations });
  const result = await recall(c, { query: 'bind', readFile: () => CODE });
  assert.deepEqual(result.top.citations.map((x) => x.status), ['changed']);
  assert.match(formatRecall(result, NOW), /server\/config\.js changed since this was written/);
});
