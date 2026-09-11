import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildListCodeRefs,
  buildAddCodeRef,
  buildRemoveCodeRef,
  buildListCodeRefsForDocuments,
  normalizeCodeRefRow,
} from '../../server/documentCodeRefsRepository.js';

const DOC = '11111111-1111-4111-8111-111111111111';

test('a row normalises to the citation shape the checker consumes', () => {
  const row = {
    id: 'r1', document_id: DOC, path: 'server/config.js',
    start_line: 12, end_line: 36, commit_sha: 'abc123', content_hash: 'f'.repeat(64),
    created_at: '2026-09-11T00:00:00.000Z',
  };
  assert.deepEqual(normalizeCodeRefRow(row), {
    id: 'r1', documentId: DOC, path: 'server/config.js',
    startLine: 12, endLine: 36, commitSha: 'abc123', contentHash: 'f'.repeat(64),
    createdAt: '2026-09-11T00:00:00.000Z',
  });
});

test('a whole-file citation normalises with null bounds, not zeroes', () => {
  const row = { id: 'r', document_id: DOC, path: 'a.js', start_line: null, end_line: null, content_hash: 'h', created_at: 't' };
  const n = normalizeCodeRefRow(row);
  assert.equal(n.startLine, null);
  assert.equal(n.endLine, null);
  assert.equal(n.commitSha, null);
});

test('adding a citation is idempotent per (document, path, range)', () => {
  const q = buildAddCodeRef(DOC, { path: 'a.js', startLine: 1, endLine: 2, commitSha: 'sha', contentHash: 'h' });
  assert.match(q.text, /insert into document_code_refs/);
  // Re-citing the same range after the code changed refreshes the pin rather
  // than erroring or accumulating duplicates.
  assert.match(q.text, /on conflict \(document_id, path, start_line, end_line\) do update/);
  assert.match(q.text, /content_hash = excluded\.content_hash/);
  assert.match(q.text, /commit_sha = excluded\.commit_sha/);
  // Never attach a citation to an archived document.
  assert.match(q.text, /archived_at is null/);
  assert.deepEqual(q.values, [DOC, 'a.js', 1, 2, 'sha', 'h']);
});

test('listing is ordered so output is stable across calls', () => {
  const q = buildListCodeRefs(DOC);
  assert.match(q.text, /where document_id = \$1/);
  assert.match(q.text, /order by path, start_line/);
  assert.deepEqual(q.values, [DOC]);
});

test('citations for many documents are fetched in one query, not N', () => {
  const q = buildListCodeRefsForDocuments([DOC, 'other']);
  assert.match(q.text, /document_id in \(\$1, \$2\)/);
  assert.deepEqual(q.values, [DOC, 'other']);
});

test('fetching citations for no documents asks nothing of the database', () => {
  assert.equal(buildListCodeRefsForDocuments([]), null);
});

test('removing a citation targets one document and id', () => {
  const q = buildRemoveCodeRef(DOC, 'r1');
  assert.match(q.text, /delete from document_code_refs/);
  assert.match(q.text, /where document_id = \$1 and id = \$2/);
  assert.deepEqual(q.values, [DOC, 'r1']);
});
