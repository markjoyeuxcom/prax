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
  assert.match(ctx, /due DATE only/i); // tells the model tasks have no time-of-day
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
