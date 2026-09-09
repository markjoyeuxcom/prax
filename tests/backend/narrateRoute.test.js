import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';

// Minimal deps: the narrate route only needs a chat provider; the rest of the
// library repositories are never touched on this path.
function makeApp({ chat } = {}) {
  return buildApp({
    skipDb: true,
    chat: chat ?? null,
    libraryRepository: { listDocuments: async () => [] },
    documentLinksRepository: {
      listStaleDocuments: async () => [],
      listOutboundLinksForDocuments: async () => new Map(),
    },
    projectsRepository: { resolveProject: async () => null },
    appSettingsRepository: { async getSetting(_k, fb) { return fb; }, async putSetting() {} },
  });
}

test('POST /api/brief/narrate returns a narrative when a chat model is configured', async () => {
  const seen = {};
  const chat = {
    model: 'fake-1',
    async complete(messages, opts) {
      seen.messages = messages;
      seen.opts = opts;
      return { text: '**On fire:** rotate certs is overdue.', model: 'fake-1' };
    },
  };
  const app = await makeApp({ chat });
  const res = await app.inject({
    method: 'POST',
    url: '/api/brief/narrate',
    payload: { text: '# Daily brief\n\n**1 overdue**\n- Rotate certs' },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.degraded, false);
  assert.equal(body.model, 'fake-1');
  assert.match(body.narrative, /rotate certs is overdue/i);
  // system prompt frames it as a stand-up and the brief is passed as the user turn
  assert.equal(seen.messages[0].role, 'system');
  assert.match(seen.messages[0].content, /stand-up/i);
  assert.equal(seen.messages[1].role, 'user');
  assert.match(seen.messages[1].content, /Rotate certs/);
  await app.close();
});

test('POST /api/brief/narrate degrades gracefully with no chat model', async () => {
  const app = await makeApp({ chat: null });
  const res = await app.inject({ method: 'POST', url: '/api/brief/narrate', payload: { text: '# Daily brief' } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.degraded, true);
  assert.equal(body.reason, 'no-chat-model');
  assert.equal(body.narrative, null);
  await app.close();
});

test('POST /api/brief/narrate degrades when generation throws', async () => {
  const chat = { model: 'fake-1', async complete() { throw new Error('provider down'); } };
  const app = await makeApp({ chat });
  const res = await app.inject({ method: 'POST', url: '/api/brief/narrate', payload: { text: '# Daily brief' } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.degraded, true);
  assert.equal(body.reason, 'generation-failed');
  assert.equal(body.narrative, null);
  await app.close();
});

test('POST /api/brief/narrate rejects an empty brief', async () => {
  const app = await makeApp({ chat: null });
  assert.equal((await app.inject({ method: 'POST', url: '/api/brief/narrate', payload: { text: '   ' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/brief/narrate', payload: {} })).statusCode, 400);
  await app.close();
});
