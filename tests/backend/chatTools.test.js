import test from 'node:test';
import assert from 'node:assert/strict';
import {
  anthropicMessages, anthropicTools, parseAnthropic,
  openaiMessages, openaiTools, parseOpenai,
  openaiResponseInput, openaiResponseTools, parseOpenaiResponse,
  geminiContents, geminiTools, parseGemini,
} from '../../server/chat/toolProtocol.js';
import { createFakeChat } from '../../server/chat/fake.js';
import { createAnthropicChat } from '../../server/chat/anthropic.js';
import { createOpenAiChat } from '../../server/chat/openai.js';
import { createGeminiChat } from '../../server/chat/gemini.js';
import { buildAgentTools } from '../../server/assistant/tools.js';

const TOOLS = [{ name: 'search_tasks', description: 'Search tasks', parameters: { type: 'object', properties: { q: { type: 'string' } }, additionalProperties: false } }];

// A canonical conversation with a tool call and a tool result fed back.
const CONV = [
  { role: 'system', content: 'You are Prax.' },
  { role: 'user', content: 'what is overdue?' },
  { role: 'assistant', content: 'let me look', toolCalls: [{ id: 'c1', name: 'search_tasks', input: { q: 'overdue' } }] },
  { role: 'tool', results: [{ id: 'c1', name: 'search_tasks', content: '1 task: Rotate certs' }] },
];

// ---- Anthropic serialization ----

test('anthropicMessages maps tool_use and tool_result blocks; system is split out', () => {
  const msgs = anthropicMessages(CONV.filter((m) => m.role !== 'system'));
  // user text
  assert.deepEqual(msgs[0], { role: 'user', content: 'what is overdue?' });
  // assistant tool call → text block + tool_use block
  assert.equal(msgs[1].role, 'assistant');
  assert.deepEqual(msgs[1].content[0], { type: 'text', text: 'let me look' });
  assert.deepEqual(msgs[1].content[1], { type: 'tool_use', id: 'c1', name: 'search_tasks', input: { q: 'overdue' } });
  // tool result → user message with tool_result block
  assert.equal(msgs[2].role, 'user');
  assert.deepEqual(msgs[2].content[0], { type: 'tool_result', tool_use_id: 'c1', content: '1 task: Rotate certs' });
});

test('anthropicTools uses input_schema; parseAnthropic extracts text + tool calls', () => {
  assert.deepEqual(anthropicTools(TOOLS)[0], { name: 'search_tasks', description: 'Search tasks', input_schema: TOOLS[0].parameters });
  const parsed = parseAnthropic({
    stop_reason: 'tool_use',
    content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 'x', name: 'search_tasks', input: { q: 'p1' } }],
  });
  assert.equal(parsed.text, 'ok');
  assert.deepEqual(parsed.toolCalls, [{ id: 'x', name: 'search_tasks', input: { q: 'p1' } }]);
});

// ---- OpenAI serialization ----

test('openaiMessages keeps system inline and emits role:tool per result', () => {
  const msgs = openaiMessages(CONV);
  assert.deepEqual(msgs[0], { role: 'system', content: 'You are Prax.' });
  assert.deepEqual(msgs[1], { role: 'user', content: 'what is overdue?' });
  assert.equal(msgs[2].role, 'assistant');
  assert.equal(msgs[2].content, 'let me look');
  assert.deepEqual(msgs[2].tool_calls[0], { id: 'c1', type: 'function', function: { name: 'search_tasks', arguments: JSON.stringify({ q: 'overdue' }) } });
  assert.deepEqual(msgs[3], { role: 'tool', tool_call_id: 'c1', content: '1 task: Rotate certs' });
});

test('parseOpenai parses tool_calls and JSON arguments (and tolerates bad JSON)', () => {
  const good = parseOpenai({ content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'get_task', arguments: '{"id":"7"}' } }] });
  assert.deepEqual(good.toolCalls, [{ id: 'a', name: 'get_task', input: { id: '7' } }]);
  const bad = parseOpenai({ content: '', tool_calls: [{ id: 'b', function: { name: 'x', arguments: 'not-json' } }] });
  assert.deepEqual(bad.toolCalls[0].input, {}); // malformed args → empty object, not a throw
});

test('OpenAI Responses serialization maps messages, function calls, and outputs', () => {
  const input = openaiResponseInput(CONV.filter((m) => m.role !== 'system'));
  assert.deepEqual(input[0], { role: 'user', content: 'what is overdue?' });
  assert.deepEqual(input[1], { role: 'assistant', content: 'let me look' });
  assert.deepEqual(input[2], { type: 'function_call', call_id: 'c1', name: 'search_tasks', arguments: JSON.stringify({ q: 'overdue' }) });
  assert.deepEqual(input[3], { type: 'function_call_output', call_id: 'c1', output: '1 task: Rotate certs' });

  const declaration = openaiResponseTools(TOOLS)[0];
  assert.deepEqual(declaration, { type: 'function', name: 'search_tasks', description: 'Search tasks', parameters: TOOLS[0].parameters });
});

test('parseOpenaiResponse extracts text, calls, and stateless continuation output', () => {
  const parsed = parseOpenaiResponse({
    id: 'resp_123',
    status: 'completed',
    output: [
      { type: 'reasoning', summary: [] },
      { type: 'message', content: [{ type: 'output_text', text: 'checking' }] },
      { type: 'function_call', call_id: 'call_1', name: 'get_task', arguments: '{"id":"7"}' },
    ],
  });
  assert.equal(parsed.text, 'checking');
  assert.equal(parsed.providerOutput.length, 3);
  assert.deepEqual(parsed.toolCalls, [{ id: 'call_1', name: 'get_task', input: { id: '7' } }]);
});

// ---- Gemini serialization ----

test('geminiContents maps functionCall / functionResponse; tools strip unsupported schema keys', () => {
  const contents = geminiContents(CONV.filter((m) => m.role !== 'system'));
  assert.deepEqual(contents[0], { role: 'user', parts: [{ text: 'what is overdue?' }] });
  assert.equal(contents[1].role, 'model');
  assert.deepEqual(contents[1].parts[1], { functionCall: { name: 'search_tasks', args: { q: 'overdue' } } });
  assert.deepEqual(contents[2], { role: 'user', parts: [{ functionResponse: { name: 'search_tasks', response: { content: '1 task: Rotate certs' } } }] });
  const decl = geminiTools(TOOLS)[0].functionDeclarations[0];
  assert.equal(decl.name, 'search_tasks');
  assert.equal('additionalProperties' in decl.parameters, false); // Gemini rejects it
  assert.deepEqual(decl.parameters.properties, { q: { type: 'string' } });
});

test('Gemini accepts the full Prax assistant tool schema surface', () => {
  const declarations = geminiTools(buildAgentTools({}))[0].functionDeclarations;
  const askLibrary = declarations.find((declaration) => declaration.name === 'ask_library');
  const askPrax = declarations.find((declaration) => declaration.name === 'ask_prax');

  assert.doesNotMatch(JSON.stringify(declarations), /exclusiveMinimum/);
  assert.equal(askLibrary.parameters.properties.limit.minimum, 1);
  assert.equal(askPrax.parameters.properties.limit.minimum, 1);
});

test('parseGemini synthesizes ids for function calls', () => {
  const parsed = parseGemini({ candidates: [{ content: { parts: [{ text: 'hmm' }, { functionCall: { name: 'search_tasks', args: { q: 'a' } } }] } }] });
  assert.equal(parsed.text, 'hmm');
  assert.deepEqual(parsed.toolCalls, [{ id: 'call_search_tasks_0', name: 'search_tasks', input: { q: 'a' } }]);
});

// ---- Provider adapters (mocked fetch) round-trip the tool path ----

test('anthropic adapter sends tools + parses a tool_use response', async () => {
  let sent;
  const fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'z', name: 'search_tasks', input: {} }] }) };
  };
  const chat = createAnthropicChat({ apiKey: 'k', model: 'claude-x', fetch });
  assert.equal(chat.supportsTools, true);
  const out = await chat.complete([{ role: 'user', content: 'hi' }], { tools: TOOLS });
  assert.ok(Array.isArray(sent.tools) && sent.tools[0].input_schema);
  assert.deepEqual(out.toolCalls, [{ id: 'z', name: 'search_tasks', input: {} }]);
  assert.equal(out.text, '');
});

test('openai adapter reports supportsTools only for real openai (not llamacpp)', () => {
  assert.equal(createOpenAiChat({ apiKey: 'k' }).supportsTools, true);
  assert.equal(createOpenAiChat({ backend: 'llamacpp', defaultModel: '' }).supportsTools, false);
});

test('openai adapter sends Responses tools and parses a function call', async () => {
  let sent;
  const providerOutput = [{ type: 'function_call', call_id: 'call_1', name: 'search_tasks', arguments: '{"q":"late"}' }];
  const fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ id: 'resp_1', status: 'completed', output: providerOutput }) };
  };
  const chat = createOpenAiChat({ apiKey: 'k', model: 'gpt-x', fetch });
  const out = await chat.complete([{ role: 'user', content: 'find late tasks' }], { tools: TOOLS });
  assert.deepEqual(sent.tools[0], { type: 'function', name: 'search_tasks', description: 'Search tasks', parameters: TOOLS[0].parameters });
  assert.deepEqual(out.toolCalls, [{ id: 'call_1', name: 'search_tasks', input: { q: 'late' } }]);
  assert.deepEqual(out.providerOutput, providerOutput);
});

// A stub that behaves like the documented stateless Responses contract: with
// store:false a reasoning item carries encrypted_content ONLY when the request
// asked for include:['reasoning.encrypted_content'], and a replayed reasoning
// item without it cannot be resolved ("Items are not persisted when store is
// false"). The earlier fixture invented encrypted_content production never
// requested (2026-09-22 review, 893007dc).
function statelessResponsesApi() {
  const sent = [];
  const fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    sent.push(body);
    const replayed = (body.input || []).filter((item) => item?.type === 'reasoning');
    if (replayed.some((item) => !item.encrypted_content)) {
      return { ok: false, status: 404, text: async () => JSON.stringify({ error: { message: `Item with id '${replayed[0].id}' not found. Items are not persisted when \`store\` is set to false.` } }) };
    }
    const turn = sent.length;
    if ((body.input || []).some((item) => item?.type === 'function_call_output')) {
      return { ok: true, json: async () => ({ id: `resp_${turn}`, status: 'completed', output: [{ type: 'message', id: 'msg_2', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] }] }) };
    }
    const reasoning = { type: 'reasoning', id: 'rs_1', summary: [] };
    if (body.store === false && body.include?.includes('reasoning.encrypted_content')) reasoning.encrypted_content = 'gAAAAopaque';
    return { ok: true, json: async () => ({ id: `resp_${turn}`, status: 'completed', output: [
      reasoning,
      { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'search_tasks', arguments: '{}', status: 'completed' },
    ] }) };
  };
  return { fetch, sent };
}

test('openai adapter requests encrypted reasoning and replays it for a stateless tool continuation', async () => {
  const api = statelessResponsesApi();
  const chat = createOpenAiChat({ apiKey: 'k', model: 'gpt-x', fetch: api.fetch });
  const first = await chat.complete([{ role: 'system', content: 'sys' }, { role: 'user', content: 'find it' }], { tools: TOOLS });
  assert.equal(api.sent[0].store, false);
  assert.deepEqual(api.sent[0].include, ['reasoning.encrypted_content']);
  assert.equal(first.providerOutput[0].encrypted_content, 'gAAAAopaque');

  const out = await chat.complete([
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'find it' },
    { role: 'assistant', toolCalls: first.toolCalls, providerOutput: first.providerOutput },
    { role: 'tool', results: [{ id: 'call_1', name: 'search_tasks', content: 'found it' }] },
  ], { tools: TOOLS });
  assert.deepEqual(api.sent[1].input.slice(-3), [
    ...first.providerOutput,
    { type: 'function_call_output', call_id: 'call_1', output: 'found it' },
  ]);
  assert.equal(out.text, 'done');
});

test('openai replay drops reasoning items that lack encrypted_content (and the server ids that point at them)', async () => {
  const api = statelessResponsesApi();
  const chat = createOpenAiChat({ apiKey: 'k', model: 'gpt-x', fetch: api.fetch });
  // History saved before the include was requested (e.g. a recovered approval).
  const legacyOutput = [
    { type: 'reasoning', id: 'rs_1', summary: [] },
    { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'search_tasks', arguments: '{"q":"late"}', status: 'completed' },
  ];
  const out = await chat.complete([
    { role: 'user', content: 'find it' },
    { role: 'assistant', toolCalls: [{ id: 'call_1', name: 'search_tasks', input: { q: 'late' } }], providerOutput: legacyOutput },
    { role: 'tool', results: [{ id: 'call_1', name: 'search_tasks', content: 'found it' }] },
  ], { tools: TOOLS });
  assert.equal(out.text, 'done');
  assert.deepEqual(api.sent[0].input.slice(-2), [
    { type: 'function_call', call_id: 'call_1', name: 'search_tasks', arguments: '{"q":"late"}' },
    { type: 'function_call_output', call_id: 'call_1', output: 'found it' },
  ]);
});

test('openai adapter stops requesting encrypted reasoning when a compatible endpoint rejects the include', async () => {
  const sent = [];
  const fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    sent.push(body);
    if (body.include) return { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: "Unsupported parameter: 'include'." } }) };
    return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] }) };
  };
  const chat = createOpenAiChat({ apiKey: 'k', model: 'gpt-x', fetch });
  assert.equal((await chat.complete('one')).text, 'ok');
  assert.equal((await chat.complete('two')).text, 'ok');
  assert.deepEqual(sent.map((b) => Boolean(b.include)), [true, false, false]);
  // Any other 400 is a real failure, surfaced as before.
  const other = createOpenAiChat({ apiKey: 'k', fetch: async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'Invalid model' } }) }) });
  await assert.rejects(other.complete('x'), /openai chat failed: 400 \(Invalid model\)/);
});

test('gemini adapter sends tools + parses functionCall response', async () => {
  let sent;
  const fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ functionCall: { name: 'get_task', args: { id: '1' } } }] } }] }) };
  };
  const chat = createGeminiChat({ apiKey: 'k', model: 'gemini-x', fetch });
  const out = await chat.complete([{ role: 'user', content: 'hi' }], { tools: TOOLS });
  assert.ok(sent.tools[0].functionDeclarations);
  assert.equal(out.toolCalls[0].name, 'get_task');
});

// ---- Fake backend scripting ----

test('fake chat: a "call <tool> {json}" directive emits that tool call', async () => {
  const chat = createFakeChat();
  const out = await chat.complete([{ role: 'user', content: 'call search_tasks {"filter":"overdue"}' }], { tools: TOOLS });
  assert.deepEqual(out.toolCalls, [{ id: 'fake_search_tasks', name: 'search_tasks', input: { filter: 'overdue' } }]);
  assert.equal(out.text, '');
});

test('fake chat: after a tool result it returns a final text answer', async () => {
  const chat = createFakeChat();
  const out = await chat.complete([
    { role: 'user', content: 'call search_tasks {}' },
    { role: 'assistant', toolCalls: [{ id: 'fake_search_tasks', name: 'search_tasks', input: {} }] },
    { role: 'tool', results: [{ id: 'fake_search_tasks', name: 'search_tasks', content: 'found 3 tasks' }] },
  ], { tools: TOOLS });
  assert.equal(out.toolCalls, null);
  assert.match(out.text, /done: found 3 tasks/);
});

test('fake chat: plain question with tools available yields text, not a tool call', async () => {
  const chat = createFakeChat();
  const out = await chat.complete([{ role: 'user', content: 'hello there' }], { tools: TOOLS });
  assert.equal(out.toolCalls, null);
  assert.match(out.text, /\[fake-chat\] hello there/);
});

test('fake chat: no-tools path is unchanged (legacy echo)', async () => {
  const chat = createFakeChat();
  const out = await chat.complete([{ role: 'user', content: 'summarize this' }]);
  assert.equal(out.text, '[fake-chat] summarize this');
  assert.equal(out.toolCalls, undefined);
});
