import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnthropicChat } from '../../server/chat/anthropic.js';
import { createOpenAiChat } from '../../server/chat/openai.js';
import { createGeminiChat } from '../../server/chat/gemini.js';
import { createOllamaChat } from '../../server/chat/ollama.js';

// Every adapter reports its provider's stop signal as a normalised
// { finishReason, truncated } pair, so callers never present output cut off
// by the token limit as complete (2026-09-22 review, bbaf70f1).

const TOOLS = [{ name: 'create_task', description: 'Create a task', parameters: { type: 'object', properties: { title: { type: 'string' } } } }];

function stubFetch(payload) {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  };
  fetch.seen = seen;
  return fetch;
}

test('anthropic: stop_reason max_tokens is truncated on the text and the tool path', async () => {
  const cut = createAnthropicChat({ apiKey: 'k', fetch: stubFetch({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'Step 1: run `kubectl dr' }] }) });
  const text = await cut.complete([{ role: 'user', content: 'rewrite' }], { maxTokens: 10 });
  assert.deepEqual([text.truncated, text.finishReason], [true, 'max_tokens']);
  const tools = await cut.complete([{ role: 'user', content: 'x' }], { tools: TOOLS });
  assert.equal(tools.truncated, true);

  const whole = createAnthropicChat({ apiKey: 'k', fetch: stubFetch({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] }) });
  const done = await whole.complete('hi');
  assert.deepEqual([done.truncated, done.finishReason], [false, 'end_turn']);
});

test('openai Responses: status incomplete (max_output_tokens) is truncated', async () => {
  const chat = createOpenAiChat({ apiKey: 'k', fetch: stubFetch({
    status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'Half a runb' }] }],
  }) });
  const out = await chat.complete('draft');
  assert.equal(out.truncated, true);
  assert.equal(out.finishReason, 'max_output_tokens');

  const whole = createOpenAiChat({ apiKey: 'k', fetch: stubFetch({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] }) });
  assert.equal((await whole.complete('hi')).truncated, false);
});

test('openai Responses: a function call cut off mid-arguments is flagged malformed, never an empty valid call', async () => {
  const chat = createOpenAiChat({ apiKey: 'k', fetch: stubFetch({
    status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
    output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'create_task', arguments: '{"title":"Rotate cer', status: 'incomplete' }],
  }) });
  const out = await chat.complete('make a task', { tools: TOOLS });
  assert.equal(out.truncated, true);
  assert.equal(out.toolCalls.length, 1);
  assert.equal(out.toolCalls[0].malformed, true);
  assert.deepEqual(out.toolCalls[0].input, {});
});

test('llama.cpp (Chat Completions): finish_reason length is truncated', async () => {
  const chat = createOpenAiChat({ backend: 'llamacpp', defaultModel: '', fetch: stubFetch({ choices: [{ finish_reason: 'length', message: { content: 'cut' } }] }) });
  const out = await chat.complete('x');
  assert.deepEqual([out.truncated, out.finishReason], [true, 'length']);
  const whole = createOpenAiChat({ backend: 'llamacpp', defaultModel: '', fetch: stubFetch({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }) });
  assert.equal((await whole.complete('x')).truncated, false);
});

test('gemini: finishReason MAX_TOKENS is truncated on the text and the tool path', async () => {
  const payload = { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'partial' }] } }] };
  const chat = createGeminiChat({ apiKey: 'k', fetch: stubFetch(payload) });
  const out = await chat.complete('x');
  assert.deepEqual([out.truncated, out.finishReason], [true, 'MAX_TOKENS']);
  assert.equal((await chat.complete('x', { tools: TOOLS })).truncated, true);
  const whole = createGeminiChat({ apiKey: 'k', fetch: stubFetch({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } }] }) });
  assert.equal((await whole.complete('x')).truncated, false);
});

test('ollama: done_reason length is truncated', async () => {
  const chat = createOllamaChat({ fetch: stubFetch({ message: { content: 'partial' }, done_reason: 'length' }) });
  const out = await chat.complete('x');
  assert.deepEqual([out.truncated, out.finishReason], [true, 'length']);
  const whole = createOllamaChat({ fetch: stubFetch({ message: { content: 'ok' }, done_reason: 'stop' }) });
  assert.equal((await whole.complete('x')).truncated, false);
});

// A fetch that only settles when its signal aborts: a stalled provider.
function hangingFetch() {
  return (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
}

test('every HTTP chat adapter has a request deadline and reports it plainly', async () => {
  const adapters = [
    createAnthropicChat({ apiKey: 'k', fetch: hangingFetch(), timeoutMs: 20 }),
    createOpenAiChat({ apiKey: 'k', fetch: hangingFetch(), timeoutMs: 20 }),
    createOpenAiChat({ backend: 'llamacpp', defaultModel: '', fetch: hangingFetch(), timeoutMs: 20 }),
    createGeminiChat({ apiKey: 'k', fetch: hangingFetch(), timeoutMs: 20 }),
    createOllamaChat({ fetch: hangingFetch(), timeoutMs: 20 }),
  ];
  for (const chat of adapters) {
    await assert.rejects(chat.complete('x'), new RegExp(`${chat.backend} chat timed out after 0s`));
  }
  // A per-call timeout overrides the adapter default.
  await assert.rejects(createAnthropicChat({ apiKey: 'k', fetch: hangingFetch() }).complete('x', { timeoutMs: 20 }), /timed out/);
});

test('HTTP adapters send a deadline signal with every request', async () => {
  const fetch = stubFetch({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] });
  await createAnthropicChat({ apiKey: 'k', fetch }).complete('x');
  assert.ok(fetch.seen[0].init.signal instanceof AbortSignal);
});
