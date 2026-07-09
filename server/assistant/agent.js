import { isToolCallTurn } from '../chat/messages.js';
import { summarizeWrite } from './tools.js';

// The in-app agent loop. It is STATELESS across HTTP requests: the client echoes
// the full canonical conversation each turn, the server prepends its system
// prompt, drives the model + tools, and returns the updated history for the next
// turn. Read tools run immediately; write tools SUSPEND the loop and return
// `awaiting_confirmation` so the human approves each mutation (see the route).

export const ASSISTANT_SYSTEM_PROMPT = [
  'You are Prax, the built-in assistant for a platform engineer / SRE. You help',
  'manage tasks and the runbook + knowledge library by calling the provided tools.',
  '',
  'Guidelines:',
  '- Prefer to READ before you act: search or fetch tasks/documents, or retrieve',
  '  library context, so your answers and edits are grounded in what actually exists.',
  '- Use the filter grammar for task queries (e.g. "p1 & overdue", "@waiting", "due:today").',
  '- When you cite a document, name it by its title.',
  '- Writes (creating/updating tasks or documents, running runbooks) require the',
  "  user's confirmation before they execute — propose them plainly; don't pretend",
  '  they already happened. Documents you author are marked agent-written and',
  '  unverified for a human to check.',
  '- Answer in clean, concise Markdown. If a request is ambiguous or the library',
  "  doesn't cover it, ask a short clarifying question rather than guessing.",
].join('\n');

const MAX_STEPS = 8;          // model round-trips per request (bounds tool loops)
const MAX_TURNS = 120;        // incoming history length cap
const MAX_CONTENT = 20_000;   // per-turn text cap

// Validate + normalize the client-supplied conversation into canonical turns,
// dropping anything malformed and any client-supplied system turn (the server
// owns the system prompt). This is a trust boundary: the body is untrusted.
export function sanitizeMessages(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const m of input.slice(-MAX_TURNS)) {
    if (!m || typeof m !== 'object') continue;
    if (m.role === 'user' || m.role === 'assistant') {
      if (isToolCallTurn(m)) {
        const toolCalls = m.toolCalls
          .filter((c) => c && typeof c.name === 'string' && typeof c.id === 'string')
          .map((c) => ({ id: c.id, name: c.name, input: c.input && typeof c.input === 'object' ? c.input : {} }));
        if (toolCalls.length) {
          out.push({ role: 'assistant', content: typeof m.content === 'string' ? m.content.slice(0, MAX_CONTENT) : '', toolCalls });
          continue;
        }
      }
      if (typeof m.content === 'string' && m.content.trim()) {
        out.push({ role: m.role, content: m.content.slice(0, MAX_CONTENT) });
      }
    } else if (m.role === 'tool' && Array.isArray(m.results)) {
      const results = m.results
        .filter((r) => r && typeof r.id === 'string' && typeof r.name === 'string')
        .map((r) => ({ id: r.id, name: r.name, content: String(r.content ?? '').slice(0, MAX_CONTENT), isError: Boolean(r.isError) }));
      if (results.length) out.push({ role: 'tool', results });
    }
  }
  return out;
}

// Execute one assistant turn's tool calls into tool-result records. Read tools
// always run; write tools run only when `decisions[id] === 'approve'`, otherwise
// they record a "declined" result so the model can respond to the refusal.
async function executeToolCalls(toolCalls, byName, decisions) {
  const results = [];
  for (const call of toolCalls) {
    const tool = byName.get(call.name);
    if (!tool) {
      results.push({ id: call.id, name: call.name, content: `Unknown tool: ${call.name}`, isError: true });
      continue;
    }
    if (!tool.readOnly && decisions[call.id] !== 'approve') {
      results.push({ id: call.id, name: call.name, content: 'The user declined to run this action.', isError: false });
      continue;
    }
    try {
      const out = await tool.handler(call.input || {});
      const text = Array.isArray(out?.content) ? out.content.map((c) => c?.text ?? '').join('\n') : String(out ?? '');
      results.push({ id: call.id, name: call.name, content: text, isError: Boolean(out?.isError) });
    } catch (err) {
      results.push({ id: call.id, name: call.name, content: `Tool error: ${err?.message ?? String(err)}`, isError: true });
    }
  }
  return results;
}

function pendingFrom(toolCalls, byName) {
  return toolCalls
    .filter((c) => !byName.get(c.name)?.readOnly)
    .map((c) => ({ id: c.id, name: c.name, input: c.input || {}, summary: summarizeWrite(c.name, c.input || {}) }));
}

// Run the loop for one request. `messages` is the sanitized history; `decisions`
// (optional) resolves the writes proposed in a suspended tail turn.
// Returns one of:
//   { status:'done', messages, answer, model }
//   { status:'awaiting_confirmation', messages, pending, model }
export async function runAssistant({ chat, tools, system = ASSISTANT_SYSTEM_PROMPT, messages, decisions = null, maxSteps = MAX_STEPS }) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const schemas = tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
  const history = messages.slice();
  // Whether any WRITE tool actually mutated data this request. The client uses
  // it to refresh its cached tasks/documents so approved changes appear at once
  // (writes only ever execute via an approval, below).
  let didWrite = false;

  // Resume: the tail is a proposed-but-unexecuted assistant tool-call turn and
  // the client sent its decisions — execute it (approved writes + any reads),
  // then fall through to continue the conversation.
  const tail = history[history.length - 1];
  if (decisions && isToolCallTurn(tail)) {
    const results = await executeToolCalls(tail.toolCalls, byName, decisions);
    if (tail.toolCalls.some((c) => !byName.get(c.name)?.readOnly && decisions[c.id] === 'approve')) didWrite = true;
    history.push({ role: 'tool', results });
  }

  let model = chat.model;
  for (let step = 0; step < maxSteps; step++) {
    const forModel = system ? [{ role: 'system', content: system }, ...history] : history;
    const res = await chat.complete(forModel, { tools: schemas, temperature: 0.2, maxTokens: 1500 });
    model = res.model || model;

    if (res.toolCalls && res.toolCalls.length) {
      history.push({ role: 'assistant', content: res.text || '', toolCalls: res.toolCalls });
      // Any write in the turn suspends the WHOLE turn for confirmation (a
      // provider requires every tool_use in a turn to be answered together).
      if (res.toolCalls.some((c) => !byName.get(c.name)?.readOnly)) {
        return { status: 'awaiting_confirmation', messages: history, pending: pendingFrom(res.toolCalls, byName), model, didWrite };
      }
      const results = await executeToolCalls(res.toolCalls, byName, {});
      history.push({ role: 'tool', results });
      continue;
    }

    history.push({ role: 'assistant', content: res.text });
    return { status: 'done', messages: history, answer: res.text, model, didWrite };
  }

  const answer = 'I hit my step limit for this turn — ask me to continue if there is more to do.';
  history.push({ role: 'assistant', content: answer });
  return { status: 'done', messages: history, answer, model, didWrite };
}
