import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';

const PROJECT_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DOC_ID = '11111111-1111-4111-8111-111111111111';

function fakes() {
  let stored = null;
  return {
    skipDb: true,
    projectsRepository: { async resolveProject(v) { return (v === 'homelab' || v === PROJECT_UUID) ? { id: PROJECT_UUID, slug: 'homelab' } : null; } },
    libraryRepository: {
      async createDocument(doc) { stored = doc; return { id: DOC_ID, ...doc, updatedBy: doc.updatedBy }; },
      async updateDocument(id, fields) { stored = fields; return { id, ...fields, updatedBy: fields.updatedBy }; },
      async getDocument() { return null; },
    },
    documentLinksRepository: { async listDocumentLinks() { return []; } },
    _seen: () => stored,
  };
}

test('POST document stamps updatedBy=agent from x-prax-origin header', async () => {
  const f = fakes();
  const app = await buildApp(f);
  const res = await app.inject({
    method: 'POST', url: '/api/library/documents',
    headers: { 'x-prax-origin': 'agent' },
    payload: { title: 'T', body: 'b', documentType: 'note', project: 'homelab' },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(f._seen().updatedBy, 'agent');
  await app.close();
});

test('POST document still stamps updatedBy=agent from the legacy x-moomora-origin header', async () => {
  const f = fakes();
  const app = await buildApp(f);
  const res = await app.inject({
    method: 'POST', url: '/api/library/documents',
    headers: { 'x-moomora-origin': 'agent' },
    payload: { title: 'T', body: 'b', documentType: 'note', project: 'homelab' },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(f._seen().updatedBy, 'agent');
  await app.close();
});

test('POST document defaults updatedBy=user without the header', async () => {
  const f = fakes();
  const app = await buildApp(f);
  await app.inject({
    method: 'POST', url: '/api/library/documents',
    payload: { title: 'T', body: 'b', documentType: 'note', project: 'homelab' },
  });
  assert.equal(f._seen().updatedBy, 'user');
  await app.close();
});

test('PATCH document threads updatedBy from the header', async () => {
  const f = fakes();
  const app = await buildApp(f);
  await app.inject({
    method: 'PATCH', url: `/api/library/documents/${DOC_ID}`,
    headers: { 'x-prax-origin': 'agent' },
    payload: { title: 'renamed' },
  });
  assert.equal(f._seen().updatedBy, 'agent');
  await app.close();
});
