import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantDisplayItems } from '../../public/js/renderAssistant.js';

test('assistantDisplayItems pairs each tool-call turn with its result turn', () => {
  const items = assistantDisplayItems([
    { role: 'user', content: 'what is overdue?' },
    { role: 'assistant', content: 'let me check', toolCalls: [{ id: 'c1', name: 'search_tasks', input: { filter: 'overdue' } }] },
    { role: 'tool', results: [{ id: 'c1', name: 'search_tasks', content: '1 task: Rotate certs' }] },
    { role: 'assistant', content: 'You have **1** overdue task.' },
  ]);
  // user, ai preamble, tools (with its result), final ai answer
  assert.deepEqual(items.map((i) => i.kind), ['user', 'ai', 'tools', 'ai']);
  const tools = items.find((i) => i.kind === 'tools');
  assert.equal(tools.calls[0].name, 'search_tasks');
  assert.match(tools.calls[0].args, /overdue/);
  assert.equal(tools.calls[0].result.content, '1 task: Rotate certs');
  assert.equal(items[3].text, 'You have **1** overdue task.');
});

test('assistantDisplayItems drops standalone tool-result turns and empty content', () => {
  const items = assistantDisplayItems([
    { role: 'user', content: 'hi' },
    { role: 'tool', results: [{ id: 'x', name: 'y', content: 'orphan' }] }, // no matching call → consumed/skipped
    { role: 'assistant', content: '' }, // empty → dropped
  ]);
  assert.deepEqual(items.map((i) => i.kind), ['user']);
});

test('assistantDisplayItems tolerates a tool call with no result yet (in flight)', () => {
  const items = assistantDisplayItems([
    { role: 'user', content: 'do it' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'create_task', input: { title: 'X' } }] },
  ]);
  const tools = items.find((i) => i.kind === 'tools');
  assert.equal(tools.calls[0].result, null);
});
