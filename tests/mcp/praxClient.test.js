import test from 'node:test';
import assert from 'node:assert/strict';
import { createPraxClient } from '../../mcp/praxClient.js';
import { PraxApiError, PraxUnavailableError } from '../../mcp/errors.js';

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

function recordingFetch(response) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, options });
    if (typeof response === 'function') return response(url, options);
    return response;
  };
  fn.calls = calls;
  return fn;
}

const BASE = 'http://127.0.0.1:3000';

test('listDocuments builds query string and omits empty params', async () => {
  const fetch = recordingFetch(jsonResponse(200, [{ id: 'd1' }]));
  const client = createPraxClient({ baseUrl: BASE, fetch });
  const docs = await client.listDocuments({ q: 'backup', project: 'homelab', documentType: undefined });
  assert.deepEqual(docs, [{ id: 'd1' }]);
  const url = new URL(fetch.calls[0].url);
  assert.equal(url.pathname, '/api/library/documents');
  assert.equal(url.searchParams.get('q'), 'backup');
  assert.equal(url.searchParams.get('project'), 'homelab');
  assert.equal(url.searchParams.has('documentType'), false);
  assert.equal(fetch.calls[0].options.method, 'GET');
});

test('semantic search opts into the paged HTTP mode', async () => {
  const body = { items: [{ id: 'd1' }], page: { total: 3 } };
  const fetch = recordingFetch(jsonResponse(200, body));
  const client = createPraxClient({ baseUrl: BASE, fetch });
  assert.deepEqual(
    await client.searchDocumentsSemantic('restore', 'homelab', { limit: 10, offset: 20 }),
    body,
  );
  const url = new URL(fetch.calls[0].url);
  assert.equal(url.pathname, '/api/library/documents/semantic-search');
  assert.equal(url.searchParams.get('q'), 'restore');
  assert.equal(url.searchParams.get('project'), 'homelab');
  assert.equal(url.searchParams.get('page'), 'true');
  assert.equal(url.searchParams.get('limit'), '10');
  assert.equal(url.searchParams.get('offset'), '20');
});

test('adds Authorization header only when a token is set', async () => {
  const withToken = recordingFetch(jsonResponse(200, []));
  await createPraxClient({ baseUrl: BASE, token: 'secret', fetch: withToken }).listTasks({});
  assert.equal(withToken.calls[0].options.headers.authorization, 'Bearer secret');

  const noToken = recordingFetch(jsonResponse(200, []));
  await createPraxClient({ baseUrl: BASE, fetch: noToken }).listTasks({});
  assert.equal(noToken.calls[0].options.headers.authorization, undefined);
});

test('createDocument POSTs a JSON body and returns the created doc', async () => {
  const fetch = recordingFetch(jsonResponse(201, { id: 'd9', title: 'New' }));
  const client = createPraxClient({ baseUrl: BASE, fetch });
  const doc = await client.createDocument({ title: 'New', body: 'b', documentType: 'note', project: 'work' });
  assert.deepEqual(doc, { id: 'd9', title: 'New' });
  assert.equal(fetch.calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(fetch.calls[0].options.body), {
    title: 'New', body: 'b', documentType: 'note', project: 'work',
  });
});

test('createDocument sends x-prax-origin: agent header', async () => {
  const fetch = recordingFetch(jsonResponse(201, { id: 'd1', title: 'New' }));
  const client = createPraxClient({ baseUrl: BASE, fetch });
  await client.createDocument({ title: 'New', body: 'b', documentType: 'note', project: 'work' });
  assert.equal(fetch.calls[0].options.headers['x-prax-origin'], 'agent');
});

test('getDocument fetches by id and returns null on 404', async () => {
  const DOC_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const fetch = recordingFetch(jsonResponse(200, { id: DOC_ID, title: 'My Doc' }));
  const client = createPraxClient({ baseUrl: BASE, fetch });
  const doc = await client.getDocument(DOC_ID);
  assert.deepEqual(doc, { id: DOC_ID, title: 'My Doc' });
  const url = new URL(fetch.calls[0].url);
  assert.equal(url.pathname, `/api/library/documents/${DOC_ID}`);
  assert.equal(fetch.calls[0].options.method, 'GET');

  const fetch2 = recordingFetch(jsonResponse(404, { message: 'not found' }));
  const client2 = createPraxClient({ baseUrl: BASE, fetch: fetch2 });
  assert.equal(await client2.getDocument(DOC_ID), null);
});

test('getTask fetches by id and returns null on 404', async () => {
  const TASK_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const fetch = recordingFetch(jsonResponse(200, { id: TASK_ID, title: 'My Task' }));
  const client = createPraxClient({ baseUrl: BASE, fetch });
  const task = await client.getTask(TASK_ID);
  assert.deepEqual(task, { id: TASK_ID, title: 'My Task' });
  const url = new URL(fetch.calls[0].url);
  assert.equal(url.pathname, `/api/tasks/${TASK_ID}`);
  assert.equal(fetch.calls[0].options.method, 'GET');

  const fetch2 = recordingFetch(jsonResponse(404, { message: 'not found' }));
  const client2 = createPraxClient({ baseUrl: BASE, fetch: fetch2 });
  assert.equal(await client2.getTask(TASK_ID), null);
});

test('updateDocument returns null on 404', async () => {
  const fetch = recordingFetch(jsonResponse(404, { message: 'document not found' }));
  const client = createPraxClient({ baseUrl: BASE, fetch });
  assert.equal(await client.updateDocument('x', { title: 'y' }), null);
});

test('updateTask returns null on 404', async () => {
  const fetch = recordingFetch(jsonResponse(404, { message: 'task not found' }));
  const client = createPraxClient({ baseUrl: BASE, fetch });
  assert.equal(await client.updateTask('x', { status: 'completed' }), null);
});

test('linkTaskDocument posts documentId and returns the updated linked-doc list', async () => {
  // The real API returns 201/200 with the updated list of linked documents.
  const fetch = recordingFetch(jsonResponse(201, [{ id: 'd1', title: 'Runbook' }]));
  const client = createPraxClient({ baseUrl: BASE, fetch });
  const result = await client.linkTaskDocument('t1', 'd1');
  const call = fetch.calls[0];
  assert.match(new URL(call.url).pathname, /\/api\/tasks\/t1\/documents$/);
  assert.equal(call.options.method, 'POST');
  assert.deepEqual(JSON.parse(call.options.body), { documentId: 'd1' });
  assert.deepEqual(result, [{ id: 'd1', title: 'Runbook' }]);
});

test('unlinkTaskDocument issues DELETE and returns the updated linked-doc list', async () => {
  // The real API returns 200 with the remaining linked documents (not 204).
  const fetch = recordingFetch(jsonResponse(200, []));
  const client = createPraxClient({ baseUrl: BASE, fetch });
  const res = await client.unlinkTaskDocument('t1', 'd1');
  assert.deepEqual(res, []);
  assert.equal(fetch.calls[0].options.method, 'DELETE');
});

test('204 No Content responses resolve to null', async () => {
  const fetch = recordingFetch(jsonResponse(204, undefined));
  const client = createPraxClient({ baseUrl: BASE, fetch });
  assert.equal(await client.unlinkTaskDocument('t1', 'd1'), null);
});

test('non-2xx (non-404) responses throw PraxApiError with status and message', async () => {
  const fetch = recordingFetch(jsonResponse(400, { message: 'title is required' }));
  const client = createPraxClient({ baseUrl: BASE, fetch });
  await assert.rejects(
    () => client.createDocument({}),
    (err) => err instanceof PraxApiError && err.status === 400 && err.message === 'title is required',
  );
});

test('fetch rejection maps to PraxUnavailableError', async () => {
  const fetch = async () => { throw new TypeError('fetch failed'); };
  const client = createPraxClient({ baseUrl: BASE, fetch });
  await assert.rejects(
    () => client.listTasks({}),
    (err) => err instanceof PraxUnavailableError && /not reachable/.test(err.message),
  );
});

test('stable-id creation retries one lost transport response with the same body', async () => {
  let calls = 0;
  const fetch = recordingFetch(async (_url, options) => {
    calls += 1;
    if (calls === 1) throw new TypeError('response lost');
    return jsonResponse(200, JSON.parse(options.body));
  });
  const client = createPraxClient({ baseUrl: BASE, fetch });
  const payload = {
    id: '11111111-1111-4111-8111-111111111111', title: 'Stable', body: 'b',
    documentType: 'note', project: 'work',
  };
  assert.deepEqual(await client.createDocument(payload), payload);
  assert.equal(fetch.calls.length, 2);
  assert.equal(fetch.calls[0].options.body, fetch.calls[1].options.body);
});

test('unsafe legacy create without an id is not retried implicitly', async () => {
  const fetch = recordingFetch(async () => { throw new TypeError('response lost'); });
  const client = createPraxClient({ baseUrl: BASE, fetch });
  await assert.rejects(() => client.createTask({ title: 'Legacy' }), PraxUnavailableError);
  assert.equal(fetch.calls.length, 1);
});

test('task and checklist writes stamp agent origin and forward stable item identity', async () => {
  const fetch = recordingFetch(jsonResponse(201, { id: 'item' }));
  const client = createPraxClient({ baseUrl: BASE, fetch });
  await client.addChecklistItem('task', 'Step', '11111111-1111-4111-8111-111111111111');
  const call = fetch.calls[0];
  assert.equal(call.options.headers['x-prax-origin'], 'agent');
  assert.deepEqual(JSON.parse(call.options.body), {
    label: 'Step', id: '11111111-1111-4111-8111-111111111111',
  });
});

test('rejects an invalid timeoutMs as a configuration error', () => {
  for (const bad of [-1, Number.NaN, Infinity]) {
    assert.throws(
      () => createPraxClient({ baseUrl: BASE, fetch: async () => {}, timeoutMs: bad }),
      (err) => err instanceof TypeError && /timeoutMs/.test(err.message),
    );
  }
});

test('supersedeDocument POSTs supersededBy with x-prax-origin: agent header', async () => {
  const fetch = recordingFetch(jsonResponse(200, { id: 'old', status: 'superseded' }));
  const client = createPraxClient({ baseUrl: BASE, fetch });
  const doc = await client.supersedeDocument('old-id', 'new-id');
  assert.deepEqual(doc, { id: 'old', status: 'superseded' });
  const call = fetch.calls[0];
  assert.equal(new URL(call.url).pathname, '/api/library/documents/old-id/supersede');
  assert.equal(call.options.method, 'POST');
  assert.deepEqual(JSON.parse(call.options.body), { supersededBy: 'new-id' });
  assert.equal(call.options.headers['x-prax-origin'], 'agent');
});

test('startRunbookRun forwards a caller-stable id and agent provenance', async () => {
  const fetch = recordingFetch(jsonResponse(201, { id: 'run-id', status: 'running' }));
  const client = createPraxClient({ baseUrl: BASE, fetch });
  await client.startRunbookRun('doc-id', 'Incident', 'run-id');
  const call = fetch.calls[0];
  assert.equal(new URL(call.url).pathname, '/api/library/documents/doc-id/runs');
  assert.deepEqual(JSON.parse(call.options.body), { title: 'Incident', id: 'run-id' });
  assert.equal(call.options.headers['x-prax-origin'], 'agent');
});
