import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';

const DOC_A = '11111111-1111-4111-8111-111111111111';
const DOC_B = '22222222-2222-4222-8222-222222222222';
const MISSING = '33333333-3333-4333-8333-333333333333';

function createFakeDocumentLinksRepository() {
  const links = [];
  const live = new Set([DOC_A, DOC_B]);
  return {
    _links: links,
    async linkDocuments(sourceId, targetId, relation) {
      if (!live.has(sourceId) || !live.has(targetId)) return { linked: false };
      if (links.some(l => l.sourceId === sourceId && l.targetId === targetId && l.relation === relation)) {
        return { linked: true, alreadyLinked: true };
      }
      links.push({ sourceId, targetId, relation });
      return { linked: true };
    },
    async unlinkDocuments(sourceId, targetId, relation) {
      const i = links.findIndex(l => l.sourceId === sourceId && l.targetId === targetId && l.relation === relation);
      if (i < 0) return false;
      links.splice(i, 1);
      return true;
    },
    async listDocumentLinks(documentId, direction = 'both') {
      const out = [];
      if (direction !== 'inbound') {
        for (const l of links.filter(l => l.sourceId === documentId)) {
          out.push({ documentId: l.targetId, title: 't', documentType: 'note', projectId: 'p', relation: l.relation, direction: 'outbound' });
        }
      }
      if (direction !== 'outbound') {
        for (const l of links.filter(l => l.targetId === documentId)) {
          out.push({ documentId: l.sourceId, title: 't', documentType: 'note', projectId: 'p', relation: l.relation, direction: 'inbound' });
        }
      }
      return out;
    },
  };
}

function build() {
  return buildApp({
    skipDb: true,
    libraryRepository: { async getDocument() { return null; } },
    projectsRepository: { async resolveProject() { return null; } },
    documentLinksRepository: createFakeDocumentLinksRepository(),
  });
}

test('POST link returns 201 then 200 on repeat, and lists outbound', async () => {
  const app = await build();
  const first = await app.inject({ method: 'POST', url: `/api/library/documents/${DOC_A}/links`, payload: { targetId: DOC_B, relation: 'derived-from' } });
  assert.equal(first.statusCode, 201);
  assert.deepEqual(first.json(), [{ documentId: DOC_B, title: 't', documentType: 'note', projectId: 'p', relation: 'derived-from', direction: 'outbound' }]);

  const again = await app.inject({ method: 'POST', url: `/api/library/documents/${DOC_A}/links`, payload: { targetId: DOC_B, relation: 'derived-from' } });
  assert.equal(again.statusCode, 200);
  await app.close();
});

test('POST link rejects bad uuid, bad relation, and self-link', async () => {
  const app = await build();
  assert.equal((await app.inject({ method: 'POST', url: `/api/library/documents/${DOC_A}/links`, payload: { targetId: 'bad', relation: 'derived-from' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: `/api/library/documents/${DOC_A}/links`, payload: { targetId: DOC_B, relation: 'relates-to' } })).statusCode, 400);
  const selfLink = await app.inject({ method: 'POST', url: `/api/library/documents/${DOC_A}/links`, payload: { targetId: DOC_A, relation: 'derived-from' } });
  assert.equal(selfLink.statusCode, 400);
  assert.match(selfLink.json().message, /itself/);
  await app.close();
});

test('POST link returns 404 when an endpoint is missing', async () => {
  const app = await build();
  const res = await app.inject({ method: 'POST', url: `/api/library/documents/${DOC_A}/links`, payload: { targetId: MISSING, relation: 'supersedes' } });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().message, 'document not found');
  await app.close();
});

test('GET links honours direction and DELETE removes', async () => {
  const app = await build();
  await app.inject({ method: 'POST', url: `/api/library/documents/${DOC_A}/links`, payload: { targetId: DOC_B, relation: 'derived-from' } });

  const outbound = await app.inject({ method: 'GET', url: `/api/library/documents/${DOC_A}/links?direction=outbound` });
  assert.equal(outbound.json().length, 1);
  const inboundOnB = await app.inject({ method: 'GET', url: `/api/library/documents/${DOC_B}/links?direction=inbound` });
  assert.equal(inboundOnB.json()[0].direction, 'inbound');

  const badDir = await app.inject({ method: 'GET', url: `/api/library/documents/${DOC_A}/links?direction=sideways` });
  assert.equal(badDir.statusCode, 400);

  const del = await app.inject({ method: 'DELETE', url: `/api/library/documents/${DOC_A}/links/${DOC_B}?relation=derived-from` });
  assert.equal(del.statusCode, 200);
  assert.deepEqual(del.json(), []);
  const delAgain = await app.inject({ method: 'DELETE', url: `/api/library/documents/${DOC_A}/links/${DOC_B}?relation=derived-from` });
  assert.equal(delAgain.statusCode, 404);
  await app.close();
});
