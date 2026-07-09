import test from 'node:test';
import assert from 'node:assert/strict';
import {
  anthropicMessages, anthropicTools, parseAnthropic,
  openaiMessages, openaiTools, parseOpenai,
  geminiContents, geminiTools, parseGemini,
} from '../../server/chat/toolProtocol.js';
import { createFakeChat } from '../../server/chat/fake.js';
import { createAnthropicChat } from '../../server/chat/anthropic.js';
import { createOpenAiChat } from '../../server/chat/openai.js';
import { createGeminiChat } from '../../server/chat/gemini.js';

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
