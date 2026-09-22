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

// Function-call arguments arrive as a JSON string. Arguments that do not parse
// to an object (typically cut off mid-JSON by the token limit) must never
// become an empty `{}` call that looks valid: the call is flagged malformed so
// the agent reports it instead of proposing it for approval.
function parseArguments(text) {
  if (text === undefined || text === null || (typeof text === 'string' && !text.trim())) return { input: {} };
  if (typeof text !== 'string') return { input: {}, malformed: true };
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? { input: value } : { input: {}, malformed: true };
  } catch {
    return { input: {}, malformed: true };
  }
}

function toCall(id, name, args) {
  const { input, malformed } = parseArguments(args);
  return { id, name, input, ...(malformed ? { malformed: true } : {}) };
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
    .map((c) => toCall(c.id, c.function.name, c.function.arguments));
  return { text, toolCalls };
}

// With store:false nothing is persisted server-side, so a reasoning item can
// only be replayed with its encrypted_content. One without it (the endpoint
// ignored the include, or history from before it was requested) is dropped,
// and the items it produced lose their server ids so none of them refers to a
// reasoning item the API cannot resolve. Content and call ids are unchanged.
export function replayableResponseOutput(items) {
  const unresolvable = items.some((item) => item?.type === 'reasoning'
    && (typeof item.encrypted_content !== 'string' || !item.encrypted_content));
  if (!unresolvable) return items;
  const out = [];
  for (const item of items) {
    if (item?.type === 'reasoning') {
      if (typeof item.encrypted_content === 'string' && item.encrypted_content) out.push(item);
      continue;
    }
    if (item?.type === 'function_call') {
      const { id: _serverId, status: _status, ...call } = item;
      out.push(call);
      continue;
    }
    if (item?.type === 'message') {
      const text = Array.isArray(item.content)
        ? item.content.filter((part) => part?.type === 'output_text' && typeof part.text === 'string').map((part) => part.text).join('')
        : '';
      if (text) out.push({ role: 'assistant', content: text });
      continue;
    }
    out.push(item);
  }
  return out;
}

export function openaiResponseInput(turns) {
  const out = [];
  for (const m of turns) {
    if (isToolCallTurn(m)) {
      if (Array.isArray(m.providerOutput) && m.providerOutput.length) {
        out.push(...replayableResponseOutput(m.providerOutput));
        continue;
      }
      if (typeof m.content === 'string' && m.content) {
        out.push({ role: 'assistant', content: m.content });
      }
      for (const tc of m.toolCalls) {
        out.push({
          type: 'function_call',
          call_id: tc.id,
          name: tc.name,
          arguments: JSON.stringify(tc.input ?? {}),
        });
      }
    } else if (isToolResultTurn(m)) {
      for (const r of m.results) {
        out.push({ type: 'function_call_output', call_id: r.id, output: String(r.content ?? '') });
      }
    } else if (m?.role === 'user' || m?.role === 'assistant') {
      out.push({ role: m.role, content: String(m.content ?? '') });
    }
  }
  return out;
}

export function openaiResponseTools(tools) {
  return tools.map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.parameters || EMPTY_SCHEMA,
  }));
}

export function parseOpenaiResponse(data) {
  const output = Array.isArray(data?.output) ? data.output : [];
  const text = output
    .filter((item) => item?.type === 'message' && Array.isArray(item.content))
    .flatMap((item) => item.content)
    .filter((part) => part?.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
  const toolCalls = output
    .filter((item) => item?.type === 'function_call' && item.name && (item.call_id || item.id))
    .map((item) => {
      const call = toCall(item.call_id || item.id, item.name, item.arguments);
      // An item the API itself marks incomplete was cut off, whatever it parses to.
      return item.status === 'incomplete' ? { ...call, malformed: true } : call;
    });
  return {
    text,
    toolCalls,
    providerOutput: output,
  };
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
  const providerIds = new Set(turns.flatMap(m => (m.geminiParts || [])
    .map(p => p.functionCall?.id).filter(Boolean)));
  return turns.map((m) => {
    if (m.role === 'assistant' && Array.isArray(m.geminiParts) && m.geminiParts.length) {
      return { role: 'model', parts: m.geminiParts };
    }
    if (isToolCallTurn(m)) {
      const parts = [];
      if (typeof m.content === 'string' && m.content) parts.push({ text: m.content });
      for (const tc of m.toolCalls) parts.push({ functionCall: { name: tc.name, args: tc.input ?? {} } });
      return { role: 'model', parts };
    }
    if (isToolResultTurn(m)) {
      return {
        role: 'user',
        parts: m.results.map((r) => ({ functionResponse: {
          name: r.name, ...(providerIds.has(r.id) ? { id: r.id } : {}), response: { content: String(r.content ?? '') },
        } })),
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
  const text = list.filter(p => p?.thought !== true).map((p) => p?.text || '').join('');
  const toolCalls = list
    .filter((p) => p?.functionCall?.name)
    .map((p, i) => ({ id: p.functionCall.id || `call_${p.functionCall.name}_${i}`, name: p.functionCall.name, input: p.functionCall.args ?? {} }));
  return { text, toolCalls, geminiParts: list };
}

// Approval history returns through an untrusted client. Preserve supported
// provider parts verbatim and in order, bounded like OpenAI continuation data.
// The replayed calls must match the calls the person was asked to approve.
export function sanitizeGeminiParts(parts, toolCalls = []) {
  if (!Array.isArray(parts) || !parts.length || parts.length > 64) return null;
  try {
    const encoded = JSON.stringify(parts);
    if (encoded.length > 200_000) return null;
    const copy = JSON.parse(encoded);
    const keys = new Set(['text', 'functionCall', 'thought', 'thoughtSignature']);
    if (!copy.every(p => p && typeof p === 'object' && !Array.isArray(p)
      && Object.keys(p).every(k => keys.has(k))
      && (typeof p.text === 'string' || (p.functionCall && typeof p.functionCall.name === 'string'))
      && (p.thought === undefined || typeof p.thought === 'boolean')
      && (p.thoughtSignature === undefined || typeof p.thoughtSignature === 'string'))) return null;
    const calls = copy.filter(p => p.functionCall).map(p => p.functionCall);
    if (calls.length !== toolCalls.length || calls.some((c, i) => c.name !== toolCalls[i].name
      || (c.id !== undefined && c.id !== toolCalls[i].id)
      || Object.keys(c).some(k => !['name', 'args', 'id'].includes(k))
      || JSON.stringify(c.args ?? {}) !== JSON.stringify(toolCalls[i].input ?? {}))) return null;
    return copy;
  } catch { return null; }
}
