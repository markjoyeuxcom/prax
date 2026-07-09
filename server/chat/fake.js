import { toMessages } from './messages.js';

// Deterministic, NON-generative chat backend for tests and offline dev — the
// chat mirror of the fake embedder. It echoes a bounded, deterministic string
// derived from the last user turn, so the whole ask → generate pipeline is
// testable with no external LLM and identical input yields identical output.
export function createFakeChat({ model = 'fake-chat' } = {}) {
  return {
    backend: 'fake',
    model,
    async complete(messages) {
      const all = toMessages(messages);
      const lastUser = [...all].reverse().find((m) => m.role === 'user');
      const firstLine = (lastUser ? lastUser.content : '').split('\n')[0].slice(0, 200);
      return { text: `[fake-chat] ${firstLine}`, model };
    },
    async isAvailable() {
      return true;
    },
  };
}
