import { isToolCallTurn, isToolResultTurn } from './messages.js';

// Per-provider translation for the tool-calling path. Each provider speaks a
// different wire format for declaring tools, carrying a model's tool-call
// request, and feeding tool results back. These pure helpers convert the neutral
// canonical shapes (see messages.js) to/from each provider so the adapters stay
// small and the tricky mapping is unit-testable in isolation.
//
// Neutral tool descriptor:  { name, description, parameters: <JSON Schema object> }
// Neutral tool call:        { id, name, input }
// Neutral tool result turn: { role:'tool', results:[{ id, name, content, isError? }] }

function safeParseJson(text) {
  if (typeof text !== 'string' || !text.trim()) return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

const EMPTY_SCHEMA = { type: 'object', properties: {} };

// ---- Anthropic (Messages API: content blocks) ------------------------------

export function anthropicMessages(turns) {
  return turns.map((m) => {
    if (isToolCallTurn(m)) {
      const content = [];
      if (typeof m.content === 'string' && m.content) content.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls) content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input ?? {} });
      return { role: 'assistant', content };
    }
    if (isToolResultTurn(m)) {
      return {
        role: 'user',
        content: m.results.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.id,
          content: String(r.content ?? ''),
          ...(r.isError ? { is_error: true } : {}),
        })),
      };
    }
    return { role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content ?? '') };
  });
}

export function anthropicTools(tools) {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters || EMPTY_SCHEMA }));
}

export function parseAnthropic(data) {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const text = blocks.filter((b) => b?.type === 'text').map((b) => b.text).join('');
  const toolCalls = blocks
    .filter((b) => b?.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, input: b.input ?? {} }));
  return { text, toolCalls };
}

// ---- OpenAI-compatible (chat completions: tool_calls) ----------------------
// OpenAI keeps the system prompt in the message array, so this maps the FULL
// canonical message list (system included), unlike the Anthropic/Gemini split.

export function openaiMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (isToolCallTurn(m)) {
      out.push({
        role: 'assistant',
        content: typeof m.content === 'string' && m.content ? m.content : null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.input ?? {}) },
        })),
      });
    } else if (isToolResultTurn(m)) {
      for (const r of m.results) out.push({ role: 'tool', tool_call_id: r.id, content: String(r.content ?? '') });
    } else {
      const role = m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user';
      out.push({ role, content: String(m.content ?? '') });
    }
  }
  return out;
}

export function openaiTools(tools) {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters || EMPTY_SCHEMA },
  }));
}

export function parseOpenai(message) {
  const text = typeof message?.content === 'string' ? message.content : '';
  const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const toolCalls = calls
    .filter((c) => c?.function?.name)
    .map((c) => ({ id: c.id, name: c.function.name, input: safeParseJson(c.function.arguments) }));
  return { text, toolCalls };
}

// ---- Gemini (generateContent: functionCall / functionResponse parts) -------
// Gemini has no per-call id, so parseGemini synthesizes a stable one from the
// name + position; feeding results back matches on name (see geminiContents).

// Gemini's legacy FunctionDeclaration.parameters field accepts only this
// documented OpenAPI subset. Keep property names while recursively dropping
// unsupported schema keywords produced by general-purpose JSON Schema tools.
const GEMINI_SCHEMA_KEYS = new Set([
  'type', 'format', 'title', 'description', 'nullable', 'enum',
  'maxItems', 'minItems', 'properties', 'required', 'minProperties',
  'maxProperties', 'minLength', 'maxLength', 'pattern', 'example',
  'anyOf', 'propertyOrdering', 'default', 'items', 'minimum', 'maximum',
]);

function sanitizeGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(sanitizeGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!GEMINI_SCHEMA_KEYS.has(key)) continue;
    out[key] = key === 'properties' && value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([name, child]) => [name, sanitizeGeminiSchema(child)]))
      : sanitizeGeminiSchema(value);
  }
  // OpenAPI has no numeric exclusive bounds. Preserve their exact meaning for
  // integers by translating them to the nearest supported inclusive bound.
  if (schema.type === 'integer') {
    if (out.minimum === undefined && Number.isFinite(schema.exclusiveMinimum)) {
      out.minimum = Math.floor(schema.exclusiveMinimum) + 1;
    }
    if (out.maximum === undefined && Number.isFinite(schema.exclusiveMaximum)) {
      out.maximum = Math.ceil(schema.exclusiveMaximum) - 1;
    }
  }
  return out;
}

export function geminiContents(turns) {
  return turns.map((m) => {
    if (isToolCallTurn(m)) {
      const parts = [];
      if (typeof m.content === 'string' && m.content) parts.push({ text: m.content });
      for (const tc of m.toolCalls) parts.push({ functionCall: { name: tc.name, args: tc.input ?? {} } });
      return { role: 'model', parts };
    }
    if (isToolResultTurn(m)) {
      return {
        role: 'user',
        parts: m.results.map((r) => ({ functionResponse: { name: r.name, response: { content: String(r.content ?? '') } } })),
      };
    }
    return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content ?? '') }] };
  });
}

export function geminiTools(tools) {
  return [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: sanitizeGeminiSchema(t.parameters || EMPTY_SCHEMA) })) }];
}

export function parseGemini(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  const list = Array.isArray(parts) ? parts : [];
  const text = list.map((p) => p?.text || '').join('');
  const toolCalls = list
    .filter((p) => p?.functionCall?.name)
    .map((p, i) => ({ id: `call_${p.functionCall.name}_${i}`, name: p.functionCall.name, input: p.functionCall.args ?? {} }));
  return { text, toolCalls };
}
