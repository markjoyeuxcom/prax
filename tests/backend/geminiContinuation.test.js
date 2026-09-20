import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiChat } from '../../server/chat/gemini.js';
import { geminiContents, parseGemini, sanitizeGeminiParts } from '../../server/chat/toolProtocol.js';
import { runAssistant, sanitizeMessages } from '../../server/assistant/agent.js';
import { loadAssistantRecovery, saveAssistantRecovery } from '../../public/js/assistantRecovery.js';

// Signed REST fixtures exercise Google's full-part replay contract without a
// paid model or remote requests. Every part stays in its original position.
const parts = [
  { text: 'Reasoning summary', thought: true, thoughtSignature: 'text-signature' },
  { text: 'Checking both records.' },
  { functionCall: { name: 'first', args: { title: 'one' }, id: 'first-provider-id' }, thoughtSignature: 'call-signature' },
  { functionCall: { name: 'second', args: {} } },
];
function fixtureChat() {
  const requests = [];
  const chat = createGeminiChat({ model: 'gemini-3-flash-preview', fetch: async (_url, opts) => {
    requests.push(JSON.parse(opts.body));
    const output = requests.length === 1 ? parts : [{ text: 'Done', thoughtSignature: 'final-signature' }];
    return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: output } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  return { chat, requests };
}
function tools(readOnly, executed) {
  return ['first', 'second'].map(name => ({ name, description: name, readOnly,
    parameters: { type: 'object', properties: {} }, handler: async () => { executed.push(name); return { content: [{ text: 'fixture' }] }; } }));
}

test('R09: signed parallel calls retain all original parts in a read-only tool loop', async () => {
  const { chat, requests } = fixtureChat(); const executed = [];
  const result = await runAssistant({ chat, tools: tools(true, executed), messages: [{ role: 'user', content: 'Read both' }] });
  assert.equal(result.status, 'done');
  assert.deepEqual(executed, ['first', 'second']);
  assert.deepEqual(requests[1].contents.find(turn => turn.role === 'model').parts, parts);
  assert.equal(requests[1].contents.at(-1).parts[0].functionResponse.id, 'first-provider-id');
  assert.equal(result.messages[1].content, 'Checking both records.', 'thought summaries are not rendered as the answer');
  const cleaned = sanitizeMessages(JSON.parse(JSON.stringify(result.messages)));
  assert.equal(cleaned.at(-1).geminiParts[0].thoughtSignature, 'final-signature');
  assert.deepEqual(geminiContents(cleaned).at(-1).parts, [{ text: 'Done', thoughtSignature: 'final-signature' }]);
});

for (const decision of ['approve', 'decline']) {
  test(`R09: signed parts survive saved approval recovery and ${decision}`, async () => {
    const { chat, requests } = fixtureChat(); const executed = [];
    const options = { chat, tools: tools(false, executed) };
    const pending = await runAssistant({ ...options, messages: [{ role: 'user', content: 'Change both' }] });
    assert.equal(pending.status, 'awaiting_confirmation');
    let saved;
    const storage = { setItem: (_key, value) => { saved = value; }, getItem: () => saved };
    saveAssistantRecovery(storage, { messages: pending.messages, pending: pending.pending, attempted: false });
    const history = sanitizeMessages(loadAssistantRecovery(storage).messages);
    assert.deepEqual(history.at(-1).geminiParts, parts);
    const decisions = Object.fromEntries(history.at(-1).toolCalls.map(call => [call.id, decision]));
    const result = await runAssistant({ ...options, messages: history, decisions });
    assert.equal(result.status, 'done');
    assert.deepEqual(executed, decision === 'approve' ? ['first', 'second'] : []);
    assert.deepEqual(requests[1].contents.find(turn => turn.role === 'model').parts, parts);
  });
}

test('R09: untrusted provider metadata is bounded and cannot substitute different tool arguments', () => {
  const calls = parseGemini({ candidates: [{ content: { parts } }] }).toolCalls;
  assert.deepEqual(sanitizeGeminiParts(parts, calls), parts);
  const changed = structuredClone(parts);
  changed[2].functionCall.args.title = 'not the approved action';
  assert.equal(sanitizeGeminiParts(changed, calls), null);
  assert.equal(sanitizeGeminiParts([{ executableCode: { code: 'unsafe' } }]), null);
  assert.equal(sanitizeGeminiParts([{ text: 'x', thoughtSignature: 'x'.repeat(200_001) }]), null);
  assert.equal(sanitizeGeminiParts(Array.from({ length: 65 }, () => ({ text: 'x' }))), null);
  const malformed = { role: 'assistant', content: 'x', toolCalls: calls, geminiParts: changed };
  assert.equal(sanitizeMessages([malformed])[0].geminiParts, undefined);
});
