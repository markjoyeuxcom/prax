// Normalize a chat input into a clean [{ role, content }] array. Accepts either
// a bare string (treated as a single user turn) or an array of messages. Unknown
// roles collapse to 'user'; empty/invalid turns are dropped. Every provider
// adapter runs its input through this so callers can pass a string or messages
// interchangeably.
const ROLES = new Set(['system', 'user', 'assistant']);

export function toMessages(input) {
  if (typeof input === 'string') {
    return input.trim() ? [{ role: 'user', content: input }] : [];
  }
  if (!Array.isArray(input)) return [];
  return input
    .filter((m) => m && typeof m.content === 'string' && m.content.length > 0)
    .map((m) => ({ role: ROLES.has(m.role) ? m.role : 'user', content: m.content }));
}

// Split a message list into a single system string (system turns joined) and the
// remaining user/assistant turns — the shape APIs like Anthropic and Gemini want,
// where the system prompt is a separate top-level field rather than a turn.
export function splitSystem(messages) {
  const all = toMessages(messages);
  const system = all.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns = all.filter((m) => m.role !== 'system');
  return { system, turns };
}
