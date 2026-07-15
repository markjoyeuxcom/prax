import { toMessages } from './messages.js';

// Deterministic, NON-generative chat backend for tests and offline dev — the
// chat mirror of the fake embedder. It echoes a bounded, deterministic string
// derived from the last user turn, so the whole ask → generate pipeline is
// testable with no external LLM and identical input yields identical output.
//
// On the tool-calling path (opts.tools present) it becomes a scriptable agent so
// the loop and the write-confirmation flow can be tested without an LLM:
//   - a user turn `call <tool> {json}` → emits that exact tool call
//   - `call_fail_after <tool> {json}` → emits it, then fails after its result
//   - after a tool-result turn → returns `[fake-chat] done: <first result line>`
//   - otherwise → the plain echo (no tool call), i.e. a final text answer
export function createFakeChat({ model = 'fake-chat' } = {}) {
  return {
    backend: 'fake',
    model,
    supportsTools: true,
    async complete(messages, opts = {}) {
      const raw = Array.isArray(messages) ? messages : toMessages(messages);
      const tools = Array.isArray(opts.tools) && opts.tools.length ? opts.tools : null;

      if (tools) {
        const last = raw[raw.length - 1];
        const lastUser = [...raw].reverse().find((m) => m && m.role === 'user' && typeof m.content === 'string');
        const directive = lastUser && /^(call|call_fail_after)\s+([a-z_]+)\s*(\{[\s\S]*\})?\s*$/i.exec(lastUser.content.trim());
        // We just fed tool results back → answer with a summary (ends the loop).
        if (last && last.role === 'tool' && Array.isArray(last.results)) {
          if (directive?.[1].toLowerCase() === 'call_fail_after') {
            throw new Error('fake provider failure after committed tool result');
          }
          const line = String(last.results[0]?.content ?? '').split('\n')[0].slice(0, 200);
          return { text: `[fake-chat] done: ${line}`, model, toolCalls: null };
        }
        // A call directive in the latest user turn → that exact tool call.
        if (directive) {
          let input = {};
          try { input = directive[3] ? JSON.parse(directive[3]) : {}; } catch { input = {}; }
          return { text: '', model, toolCalls: [{ id: `fake_${directive[2]}`, name: directive[2], input }] };
        }
        // No directive → plain text answer, no tool call.
        const firstLine = (lastUser?.content || '').split('\n')[0].slice(0, 200);
        return { text: `[fake-chat] ${firstLine}`, model, toolCalls: null };
      }

      const all = toMessages(messages);
      const lastUser = [...all].reverse().find((m) => m.role === 'user');
      // A `>>{...}` directive at the end of the user turn → echo exactly that
      // JSON as the completion, so JSON-output features (NL parse, etc.) can be
      // driven deterministically in browser verification. Without a directive
      // the plain echo exercises their degraded (unparseable-output) path.
      const jsonDirective = lastUser && String(lastUser.content).match(/>>\s*(\{[\s\S]*\})\s*$/);
      if (jsonDirective) return { text: jsonDirective[1], model };
      const firstLine = (lastUser ? lastUser.content : '').split('\n')[0].slice(0, 200);
      return { text: `[fake-chat] ${firstLine}`, model };
    },
    async isAvailable() {
      return true;
    },
  };
}
