import test from 'node:test';
import assert from 'node:assert/strict';
import { currentDateContext, buildAssistantSystemPrompt, runAssistant, ASSISTANT_SYSTEM_PROMPT } from '../../server/assistant/agent.js';

test('currentDateContext states the LOCAL date + weekday (not UTC)', () => {
  // A moment where the LOCAL date differs from the UTC date would be brittle to
  // assert on across CI timezones; instead pin a mid-day local date and check
  // the components come from the local getFullYear/Month/Date, matching the
  // desktop capture's todayISODate convention.
  const now = new Date(2026, 6, 9, 12, 0, 0); // 2026-07-09 (month is 0-based) — a Thursday
  const ctx = currentDateContext(now);
  assert.match(ctx, /Thursday, 2026-07-09/);
  assert.match(ctx, /YYYY-MM-DD/);
  assert.match(ctx, /dueTime as "HH:MM"/i); // tells the model tasks support a time-of-day
});

test('buildAssistantSystemPrompt appends the date to the base prompt', () => {
  const prompt = buildAssistantSystemPrompt(new Date(2026, 0, 2, 9, 0, 0)); // 2026-01-02, a Friday
  assert.ok(prompt.startsWith(ASSISTANT_SYSTEM_PROMPT));
  assert.match(prompt, /Friday, 2026-01-02/);
});

test('runAssistant sends the current date in the system turn to the model', async () => {
  let sawSystem = '';
  const chat = {
    model: 'stub',
    supportsTools: true,
    async complete(messages) {
      sawSystem = messages.find((m) => m.role === 'system')?.content || '';
      return { text: 'ok', model: 'stub' };
    },
  };
  const res = await runAssistant({
    chat,
    tools: [],
    messages: [{ role: 'user', content: 'what can you do?' }],
    now: new Date(2026, 6, 9, 12, 0, 0),
  });
  assert.equal(res.status, 'done');
  assert.match(sawSystem, /You are Prax/);          // base prompt present
  assert.match(sawSystem, /Thursday, 2026-07-09/);  // and the date
});

// Regression (2026-07-18 review): didWrite reflects the OUTCOME, not the
// approval. An approved write whose handler throws mutated nothing — when the
// follow-up model call then also fails, the client must not tell the user
// "the approved change completed... do not repeat the action".
test('didWrite stays false when an approved write handler throws', async () => {
  const failingChat = {
    model: 'stub',
    supportsTools: true,
    async complete() { throw new Error('model unavailable'); },
  };
  const tools = [{
    name: 'create_task',
    description: 'create',
    parameters: {},
    readOnly: false,
    async handler() { throw new Error('db locked'); },
  }];
  const res = await runAssistant({
    chat: failingChat,
    tools,
    messages: [
      { role: 'user', content: 'add a task' },
      { role: 'assistant', toolCalls: [{ id: 'c1', name: 'create_task', input: { title: 'x' } }] },
    ],
    decisions: { c1: 'approve' },
  });
  assert.equal(res.status, 'error');
  assert.equal(res.didWrite, false, 'a failed write must not claim completion');
  const toolTurn = res.messages.find((m) => m.role === 'tool');
  assert.equal(toolTurn.results[0].isError, true);
});

test('didWrite is true when an approved write succeeds, even if the follow-up model call fails', async () => {
  const failingChat = {
    model: 'stub',
    supportsTools: true,
    async complete() { throw new Error('model unavailable'); },
  };
  const tools = [{
    name: 'create_task',
    description: 'create',
    parameters: {},
    readOnly: false,
    async handler() { return { content: [{ text: '{"id":"t1"}' }] }; },
  }];
  const res = await runAssistant({
    chat: failingChat,
    tools,
    messages: [
      { role: 'user', content: 'add a task' },
      { role: 'assistant', toolCalls: [{ id: 'c1', name: 'create_task', input: { title: 'x' } }] },
    ],
    decisions: { c1: 'approve' },
  });
  assert.equal(res.status, 'error');
  assert.equal(res.didWrite, true, 'a committed write must surface so the client refreshes');
});
