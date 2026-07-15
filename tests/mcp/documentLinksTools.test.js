import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentLinkTools } from '../../mcp/tools/documentLinks.js';
import { PraxApiError } from '../../mcp/errors.js';

function byName(tools, name) {
  const t = tools.find((x) => x.name === name);
  assert.ok(t, `tool ${name} should exist`);
  return t;
}

const SRC = '11111111-1111-4111-8111-111111111111';
const TGT = '22222222-2222-4222-8222-222222222222';

test('exposes the four document-link tools', () => {
  const names = createDocumentLinkTools({}).map((t) => t.name).sort();
  assert.deepEqual(names, ['link_documents', 'list_document_links', 'supersede_document', 'unlink_documents']);
});

test('list_document_links validates uuid, passes direction, and exposes the next page', async () => {
  let received;
  const many = Array.from({ length: 25 }, (_, i) => ({ documentId: `d-${i}` }));
  const client = { listDocumentLinks: async (id, dir) => { received = [id, dir]; return many; } };
  const tool = byName(createDocumentLinkTools(client), 'list_document_links');
  assert.equal((await tool.handler({ documentId: 'bad' })).isError, true);
  const res = await tool.handler({ documentId: SRC, direction: 'inbound', limit: 10, offset: 10 });
  assert.deepEqual(received, [SRC, 'inbound']);
  const data = JSON.parse(res.content[0].text);
  assert.equal(data.items.length, 10);
  assert.deepEqual(data.page, {
    offset: 10, limit: 10, returned: 10, total: 25, hasMore: true, nextOffset: 20,
  });
});

test('link_documents validates both uuids then returns a stable shape', async () => {
  let received;
  const client = { linkDocuments: async (s, t, r) => { received = [s, t, r]; return [{ documentId: TGT }]; } };
  const tool = byName(createDocumentLinkTools(client), 'link_documents');
  assert.match((await tool.handler({ sourceId: 'bad', targetId: TGT, relation: 'derived-from' })).content[0].text, /valid UUID/);
  const res = await tool.handler({ sourceId: SRC, targetId: TGT, relation: 'derived-from' });
  assert.deepEqual(received, [SRC, TGT, 'derived-from']);
  assert.deepEqual(JSON.parse(res.content[0].text), {
    linked: true, sourceId: SRC, targetId: TGT, relation: 'derived-from', links: [{ documentId: TGT }],
  });
});

test('unlink_documents validates uuids and reports success', async () => {
  let received;
  const client = { unlinkDocuments: async (s, t, r) => { received = [s, t, r]; return null; } };
  const tool = byName(createDocumentLinkTools(client), 'unlink_documents');
  assert.match((await tool.handler({ sourceId: 'bad', targetId: TGT, relation: 'supersedes' })).content[0].text, /valid UUID/);
  const res = await tool.handler({ sourceId: SRC, targetId: TGT, relation: 'supersedes' });
  assert.deepEqual(received, [SRC, TGT, 'supersedes']);
  assert.deepEqual(JSON.parse(res.content[0].text), { unlinked: true, sourceId: SRC, targetId: TGT, relation: 'supersedes' });
});

test('supersede_document validates uuids, rejects self-supersede, maps not-found, calls client', async () => {
  let received;
  const client = { supersedeDocument: async (id, by) => { received = [id, by]; return { id, status: 'superseded' }; } };
  const tool = byName(createDocumentLinkTools(client), 'supersede_document');

  assert.equal((await tool.handler({ documentId: 'bad', supersededBy: TGT })).isError, true);
  assert.equal((await tool.handler({ documentId: SRC, supersededBy: 'bad' })).isError, true);
  assert.equal((await tool.handler({ documentId: SRC, supersededBy: SRC })).isError, true);

  const res = await tool.handler({ documentId: SRC, supersededBy: TGT });
  assert.deepEqual(received, [SRC, TGT]);
  assert.deepEqual(JSON.parse(res.content[0].text), { id: SRC, status: 'superseded' });

  // Not-found is a server 404 -> PraxApiError thrown by the client's request(); withErrorHandling
  // turns it into an error result. (The client never returns null for this route, so there is no !doc guard.)
  const throwing = byName(
    createDocumentLinkTools({
      supersedeDocument: async () => { throw new PraxApiError(404, 'document not found'); },
    }),
    'supersede_document',
  );
  const errRes = await throwing.handler({ documentId: SRC, supersededBy: TGT });
  assert.equal(errRes.isError, true);
  assert.match(errRes.content[0].text, /document not found/);
});
