import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReviewDeskHtml, reviewDeskQueue, reviewDeskCurrentId } from '../../public/js/renderReviewDesk.js';

const agentDoc = (id, title, updatedAt, extra = {}) => ({
  id, title, updatedAt, body: `# ${title}\n\nBody of ${title}.`, documentType: 'known-issue',
  projectId: 'p1', tags: ['backup'], updatedBy: 'agent', updatedByAgent: 'claude-code', verified: false, ...extra,
});

const documents = [
  agentDoc('b', 'Second written', '2026-10-07T22:41:00Z'),
  agentDoc('a', 'First written', '2026-10-06T10:00:00Z'),
  { id: 'h', title: 'Human note', updatedAt: '2026-10-01T00:00:00Z', updatedBy: 'human' },
  agentDoc('v', 'Already verified', '2026-10-02T00:00:00Z', { verified: true }),
];
const base = { documents, projects: [{ id: 'p1', name: 'Homelab' }], libraryQuery: '' };

test('the desk queue is unverified agent memory, oldest first, narrowed by the search box', () => {
  assert.deepEqual(reviewDeskQueue(base).map((doc) => doc.id), ['a', 'b']);
  assert.deepEqual(reviewDeskQueue({ ...base, libraryQuery: 'second' }).map((doc) => doc.id), ['b']);
  assert.equal(reviewDeskCurrentId(base), 'a');
  assert.equal(reviewDeskCurrentId({ ...base, reviewDeskId: 'b' }), 'b');
  assert.equal(reviewDeskCurrentId({ ...base, reviewDeskId: 'gone' }), 'a');
});

test('the desk renders queue, memory and provenance, and waits for the saved revision before Verify', () => {
  const loading = renderReviewDeskHtml(base);
  assert.match(loading, /<h1 class="page-head__title">Review queue<\/h1>/);
  assert.match(loading, /data-action="review-desk-select" data-document-id="a" aria-current="true"/);
  assert.match(loading, /data-action="review-desk-verify" disabled/);
  assert.match(loading, /Loading the saved revision/);

  const loaded = renderReviewDeskHtml({
    ...base,
    reviewDeskDoc: { ...documents[1], revision: 'r1', body: '# First written\n\nThe <b>real</b> cause.' },
    reviewDeskContext: {
      id: 'a',
      codeRefs: [{ path: 'infra/cnpg/objectstore.yaml', startLine: 4, endLine: 4, commitSha: '9c1e04b77', symbol: 'ObjectStore' }],
      links: [{ documentId: 'x', title: 'Backups go to MinIO', relation: 'related', direction: 'outbound' }],
      similar: [{ id: 'x', title: 'Backups go to MinIO, then B2', verified: true }],
    },
  });
  assert.doesNotMatch(loaded, /data-action="review-desk-verify" disabled/);
  assert.match(loaded, /<span class="rq-agent">claude-code<\/span>/);
  assert.match(loaded, /infra\/cnpg\/objectstore\.yaml#L4/);
  assert.match(loaded, /<dt>commit<\/dt><dd>9c1e04b<\/dd>/);
  assert.match(loaded, /Overlaps a verified document/);
  assert.match(loaded, /data-action="review-desk-supersede" data-replacement-id="x"/);
  assert.doesNotMatch(loaded, /<b>real<\/b>/, 'agent-written markdown renders untrusted');
  for (const action of ['review-desk-verify', 'review-doc', 'review-desk-supersede-pick', 'review-desk-reject', 'review-desk-skip']) {
    assert.match(loaded, new RegExp(`data-action="${action}"`), action);
  }
  assert.match(loaded, /class="kbd">V</);
});

test('decided documents stay listed as done; an empty queue says so', () => {
  const html = renderReviewDeskHtml({ ...base, reviewDeskDone: [{ id: 'z', title: 'Old memory', outcome: 'verified' }] });
  assert.match(html, /rq-item rq-item--done"><span class="rq-item__mark" aria-hidden="true">✓/);
  assert.match(html, /2 of 3/);
  const empty = renderReviewDeskHtml({ documents: [], reviewDeskDone: [{ id: 'z', title: 'Old', outcome: 'rejected' }] });
  assert.match(empty, /Queue cleared\./);
});
