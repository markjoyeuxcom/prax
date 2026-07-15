import test from 'node:test';
import assert from 'node:assert/strict';
import { createChat } from '../../server/chat/index.js';
import { createFakeChat } from '../../server/chat/fake.js';
import { createOpenAiChat } from '../../server/chat/openai.js';
import { createAnthropicChat } from '../../server/chat/anthropic.js';
import { createOllamaChat } from '../../server/chat/ollama.js';
import { createGeminiChat } from '../../server/chat/gemini.js';
import { toMessages, splitSystem } from '../../server/chat/messages.js';

function fakeFetch(handler) { return async (url, init) => handler(url, init); }

test('toMessages accepts a bare string or a message array; drops empties; clamps roles', () => {
  assert.deepEqual(toMessages('hello'), [{ role: 'user', content: 'hello' }]);
  assert.deepEqual(toMessages('   '), []);
  assert.deepEqual(
    toMessages([{ role: 'system', content: 's' }, { role: 'bogus', content: 'b' }, { role: 'assistant', content: '' }]),
    [{ role: 'system', content: 's' }, { role: 'user', content: 'b' }],
  );
});

test('splitSystem joins system turns and keeps the rest', () => {
  const { system, turns } = splitSystem([
    { role: 'system', content: 'A' }, { role: 'system', content: 'B' },
    { role: 'user', content: 'q' }, { role: 'assistant', content: 'a' },
  ]);
  assert.equal(system, 'A\n\nB');
  assert.deepEqual(turns, [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }]);
});

test('fake chat is deterministic and available', async () => {
  const c = createFakeChat();
  assert.equal(c.backend, 'fake');
  const a = await c.complete('question one\nsecond line');
  const b = await c.complete([{ role: 'system', content: 'ctx' }, { role: 'user', content: 'question one\nsecond line' }]);
  assert.equal(a.text, b.text);            // deterministic, ignores system
  assert.match(a.text, /^\[fake-chat\] question one$/);
  assert.equal(await c.isAvailable(), true);
});

test('fake chat can deterministically fail after receiving a committed tool result', async () => {
  const c = createFakeChat();
  const tools = [{ name: 'create_task' }];
  const user = { role: 'user', content: 'call_fail_after create_task {"title":"Once"}' };
  const proposed = await c.complete([user], { tools });
  assert.equal(proposed.toolCalls[0].name, 'create_task');
  assert.deepEqual(proposed.toolCalls[0].input, { title: 'Once' });

  await assert.rejects(
    c.complete([
      user,
      { role: 'assistant', content: '', toolCalls: proposed.toolCalls },
      { role: 'tool', results: [{ id: proposed.toolCalls[0].id, name: 'create_task', content: 'created Once', isError: false }] },
    ], { tools }),
    /fake provider failure after committed tool result/,
  );
});

test('createChat resolves backends and null for none; throws on unknown', () => {
  assert.equal(createChat({ chatBackend: 'none' }), null);
  assert.equal(createChat({ chatBackend: 'fake' }).backend, 'fake');
  assert.equal(createChat({ chatBackend: 'ollama', ollamaUrl: 'http://x' }).backend, 'ollama');
  assert.equal(createChat({ chatBackend: 'anthropic' }).backend, 'anthropic');
  assert.equal(createChat({ chatBackend: 'gemini' }).backend, 'gemini');
  assert.equal(createChat({ chatBackend: 'llamacpp' }).backend, 'llamacpp');
  assert.throws(() => createChat({ chatBackend: 'bogus' }), /unknown chat backend/i);
});

test('openai chat posts messages + model and returns the message content', async () => {
  let seen;
  const fetch = fakeFetch((url, init) => { seen = { url, init }; return { ok: true, async json() { return { choices: [{ message: { content: 'the answer' } }] }; } }; });
  const c = createOpenAiChat({ baseUrl: 'http://x/v1', apiKey: 'sk-1', model: 'gpt-4o-mini', fetch });
  const out = await c.complete([{ role: 'user', content: 'hi' }], { temperature: 0.2, maxTokens: 256 });
  assert.equal(out.text, 'the answer');
  assert.equal(out.model, 'gpt-4o-mini');
  assert.match(seen.url, /\/v1\/chat\/completions$/);
  assert.equal(seen.init.headers.authorization, 'Bearer sk-1');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.model, 'gpt-4o-mini');
  assert.equal(body.temperature, 0.2);
  assert.equal(body.max_tokens, 256);
  assert.deepEqual(body.messages, [{ role: 'user', content: 'hi' }]);
});

test('openai chat omits Authorization when keyless and throws on non-ok / malformed', async () => {
  let seen;
  const okFetch = fakeFetch((url, init) => { seen = init; return { ok: true, async json() { return { choices: [{ message: { content: 'x' } }] }; } }; });
  await createOpenAiChat({ baseUrl: 'http://local/v1', apiKey: '', fetch: okFetch }).complete('x');
  assert.equal('authorization' in seen.headers, false);
  await assert.rejects(createOpenAiChat({ baseUrl: 'http://x/v1', fetch: fakeFetch(() => ({ ok: false, status: 500 })) }).complete('x'), /openai chat failed: 500/);
  await assert.rejects(createOpenAiChat({ baseUrl: 'http://x/v1', fetch: fakeFetch(() => ({ ok: true, async json() { return { choices: [] }; } })) }).complete('x'), /no message content/);
});

test('llamacpp rides the openai chat client: keyless, modelless, own error name', async () => {
  let seen;
  const fetch = fakeFetch((url, init) => { seen = { url, init }; return { ok: true, async json() { return { choices: [{ message: { content: 'ok' } }] }; } }; });
  const c = createChat({ chatBackend: 'llamacpp', fetch });
  assert.equal(c.backend, 'llamacpp');
  await c.complete('hi');
  assert.equal(seen.url, 'http://127.0.0.1:8080/v1/chat/completions');
  assert.equal('authorization' in seen.init.headers, false);
  assert.equal('model' in JSON.parse(seen.init.body), false); // llama-server uses its loaded model
  await assert.rejects(createChat({ chatBackend: 'llamacpp', fetch: fakeFetch(() => ({ ok: false, status: 503 })) }).complete('x'), /llamacpp chat failed: 503/);
});

test('anthropic chat lifts system out of turns, pins version, joins text blocks', async () => {
  let seen;
  const fetch = fakeFetch((url, init) => { seen = { url, init }; return { ok: true, async json() { return { content: [{ type: 'text', text: 'part1 ' }, { type: 'thinking', text: 'x' }, { type: 'text', text: 'part2' }] }; } }; });
  const c = createAnthropicChat({ baseUrl: 'http://a', apiKey: 'ak-1', model: 'claude-x', fetch });
  const out = await c.complete([{ role: 'system', content: 'be terse' }, { role: 'user', content: 'q' }], { maxTokens: 500 });
  assert.equal(out.text, 'part1 part2');   // only text blocks, concatenated
  assert.equal(seen.url, 'http://a/v1/messages');
  assert.equal(seen.init.headers['x-api-key'], 'ak-1');
  assert.equal(seen.init.headers['anthropic-version'], '2023-06-01');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.system, 'be terse');
  assert.equal(body.max_tokens, 500);
  assert.deepEqual(body.messages, [{ role: 'user', content: 'q' }]); // system not a turn
});

test('anthropic chat throws on non-ok and empty content; isAvailable probes GET /v1/models', async () => {
  await assert.rejects(createAnthropicChat({ apiKey: 'k', fetch: fakeFetch(() => ({ ok: false, status: 401 })) }).complete('x'), /anthropic chat failed: 401/);
  await assert.rejects(createAnthropicChat({ apiKey: 'k', fetch: fakeFetch(() => ({ ok: true, async json() { return { content: [] }; } })) }).complete('x'), /no text content/);
  let seen;
  const up = createAnthropicChat({ apiKey: 'k', fetch: fakeFetch((url, init) => { seen = { url, init }; return { ok: true }; }) });
  assert.equal(await up.isAvailable(), true);
  assert.match(seen.url, /\/v1\/models$/);
  assert.equal(seen.init.headers['x-api-key'], 'k');
  assert.equal(await createAnthropicChat({ fetch: fakeFetch(() => { throw new Error('down'); }) }).isAvailable(), false);
});

test('ollama chat posts /api/chat, strips a trailing /v1, parses message.content', async () => {
  const urls = [];
  const fetch = fakeFetch((url, init) => { urls.push(url); return { ok: true, async json() { return { message: { content: 'hey' }, models: [{ name: 'llama3.1:latest' }] }; } }; });
  const c = createOllamaChat({ url: 'https://box/v1', model: 'llama3.1', fetch });
  const out = await c.complete([{ role: 'user', content: 'hi' }]);
  assert.equal(out.text, 'hey');
  assert.equal(urls[0], 'https://box/api/chat');
  assert.equal(await c.isAvailable(), true);        // bare name matches :latest
  assert.equal(urls[1], 'https://box/api/tags');
  await assert.rejects(createOllamaChat({ url: 'http://x', fetch: fakeFetch(() => ({ ok: false, status: 504 })) }).complete('x'), /ollama chat failed: 504 \(timed out/);
});

test('gemini chat maps roles/system and reads candidate text', async () => {
  let seen;
  const fetch = fakeFetch((url, init) => { seen = { url, init }; return { ok: true, async json() { return { candidates: [{ content: { parts: [{ text: 'g-ans' }] } }] }; } }; });
  const c = createGeminiChat({ baseUrl: 'http://g/v1beta', apiKey: 'gk', model: 'gemini-1.5-flash', fetch });
  const out = await c.complete([{ role: 'system', content: 'sys' }, { role: 'user', content: 'u' }, { role: 'assistant', content: 'a' }], { maxTokens: 100 });
  assert.equal(out.text, 'g-ans');
  assert.equal(seen.url, 'http://g/v1beta/models/gemini-1.5-flash:generateContent');
  assert.equal(seen.init.headers['x-goog-api-key'], 'gk');
  const body = JSON.parse(seen.init.body);
  assert.deepEqual(body.systemInstruction, { parts: [{ text: 'sys' }] });
  assert.deepEqual(body.contents, [{ role: 'user', parts: [{ text: 'u' }] }, { role: 'model', parts: [{ text: 'a' }] }]);
  assert.equal(body.generationConfig.maxOutputTokens, 100);
  await assert.rejects(createGeminiChat({ apiKey: 'k', fetch: fakeFetch(() => ({ ok: false, status: 403 })) }).complete('x'), /gemini chat failed: 403/);
});

test('every chat adapter exposes .model equal to what complete() reports', async () => {
  assert.equal(createOpenAiChat({}).model, 'gpt-4o-mini');
  assert.equal(createOpenAiChat({ backend: 'llamacpp', defaultModel: '' }).model, '');
  assert.equal(createAnthropicChat({}).model, 'claude-haiku-4-5-20251001');
  assert.equal(createOllamaChat({}).model, 'llama3.1');
  assert.equal(createGeminiChat({}).model, 'gemini-2.5-flash');
});
