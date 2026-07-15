import test from 'node:test';
import assert from 'node:assert/strict';
import { createExternalRefTools } from '../../mcp/tools/externalRefs.js';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';

test('list_external_refs returns a navigable collection envelope', async () => {
  const refs = Array.from({ length: 3 }, (_, i) => ({ id: `r${i}`, url: `https://example.test/${i}` }));
  const tool = createExternalRefTools({ listExternalRefs: async () => refs })
    .find((candidate) => candidate.name === 'list_external_refs');
  const result = await tool.handler({ documentId: DOCUMENT_ID, limit: 1, offset: 1 });
  const data = JSON.parse(result.content[0].text);
  assert.deepEqual(data.items, [refs[1]]);
  assert.deepEqual(data.page, {
    offset: 1, limit: 1, returned: 1, total: 3, hasMore: true, nextOffset: 2,
  });
});
