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

// ---- Tool-calling protocol -------------------------------------------------
// The plain-completion path above speaks in { role, content:string } turns. The
// agentic path adds two richer canonical turn kinds that carry no plain string
// content (so toMessages would drop them):
//   { role:'assistant', content?, toolCalls:[{ id, name, input }], providerOutput? }
//     — the model asked to call tools; providerOutput carries bounded stateless
//       continuation data when the provider requires its complete prior output
//   { role:'tool', results:[{ id, name, content, isError? }] }
//     — tool outputs fed back
// Provider adapters translate these to each wire format (see toolProtocol.js).

export function isToolCallTurn(m) {
  return Boolean(m) && m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length > 0;
}

export function isToolResultTurn(m) {
  return Boolean(m) && m.role === 'tool' && Array.isArray(m.results) && m.results.length > 0;
}

// Like splitSystem but tool-call/tool-result turns survive (they have no string
// `content`, so the toMessages filter would otherwise discard them). Used only on
// the agentic path where the full canonical history must round-trip.
export function splitSystemRich(input) {
  const all = Array.isArray(input)
    ? input.filter(Boolean)
    : (typeof input === 'string' && input.trim() ? [{ role: 'user', content: input }] : []);
  const system = all
    .filter((m) => m.role === 'system' && typeof m.content === 'string')
    .map((m) => m.content)
    .join('\n\n');
  const turns = all.filter((m) => m.role !== 'system');
  return { system, turns };
}
