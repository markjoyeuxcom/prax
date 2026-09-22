import { z } from 'zod';
import { buildToolset } from '../../mcp/server.js';

// Turn a Prax MCP tool (zod inputSchema + { content:[{text}] } handler) into the
// provider-neutral descriptor the agent loop + chat adapters consume:
//   { name, description, parameters:<JSON Schema>, readOnly, handler }
// readOnly is derived from the MCP readOnlyHint annotation, but FAILS SAFE: any
// tool not explicitly marked read-only is treated as a write and gated behind a
// human confirmation. So a newly added tool can never mutate data unconfirmed.

function normalizeSchema(schema) {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} };
  // Drop the draft marker — harmless to OpenAI/Anthropic and stripped again for
  // Gemini downstream, but cleaner not to ship it to any provider.
  const { $schema, ...rest } = schema;
  if (!rest.type) rest.type = 'object';
  if (!rest.properties) rest.properties = {};
  return rest;
}

export function buildAgentTools(client) {
  return buildToolset(client).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: normalizeSchema(z.toJSONSchema(z.object(tool.inputSchema || {}))),
    // Model output is untrusted input (a fetched document can inject calls):
    // it is parsed with the tool's own schema, and unknown keys are rejected
    // rather than spread into the API payload.
    inputSchema: z.object(tool.inputSchema || {}).strict(),
    readOnly: tool.annotations?.readOnlyHint === true,
    handler: tool.handler,
  }));
}

// Parse a model-proposed call's input. Returns { ok, input } with the parsed
// value (defaults applied, nothing extra) or { ok:false, error } naming every
// problem. A tool without a schema (test doubles) passes objects through.
export function validateToolInput(tool, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'arguments must be a JSON object' };
  }
  if (!tool?.inputSchema || typeof tool.inputSchema.safeParse !== 'function') return { ok: true, input };
  const parsed = tool.inputSchema.safeParse(input);
  if (parsed.success) return { ok: true, input: parsed.data };
  return { ok: false, error: z.prettifyError(parsed.error).replace(/\s*\n\s*/g, ' ') };
}

// A short, human-facing summary of a proposed write, shown as the headline of
// its confirmation row. Resolved target titles (see writePreview.js) name the
// records; without them the full id is shown, never a truncated one.
export function summarizeWrite(name, input = {}, targets = []) {
  const q = (s) => (s ? `“${String(s)}”` : '');
  const named = (role) => {
    const t = targets.find((x) => x.role === role);
    if (t?.title) return q(t.title);
    return t?.id ? String(t.id) : '';
  };
  const str = (v) => (typeof v === 'string' ? v : '');
  switch (name) {
    case 'create_task': return `Create task ${q(str(input.title))}`.trim();
    case 'update_task': return `Update task ${named('Task') || str(input.id)}`.trim();
    case 'create_document': return `Create ${str(input.documentType) || 'document'} ${q(str(input.title))}`.trim();
    case 'update_document': return `Update document ${named('Document') || str(input.id)}`.trim();
    case 'supersede_document': return `Retire ${named('Retires') || 'a document'} in favour of ${named('Replaced by') || 'another document'}`;
    case 'generate_runbook': return `Generate a runbook from ${q(str(input.description))}`.trim();
    case 'generate_post_mortem': return `Generate a post-mortem for run ${named('Run')}`.trim();
    case 'link_documents': return `Link ${named('From') || 'a document'} to ${named('To') || 'a document'} (${str(input.relation) || 'link'})`;
    case 'unlink_documents': return `Unlink ${named('From') || 'a document'} from ${named('To') || 'a document'} (${str(input.relation) || 'link'})`;
    case 'link_task_document': return `Link ${named('Document') || 'a document'} to task ${named('Task')}`.trim();
    case 'unlink_task_document': return `Unlink ${named('Document') || 'a document'} from task ${named('Task')}`.trim();
    case 'add_checklist_item': return `Add checklist item ${q(str(input.label))} to ${named('Task') || 'a task'}`;
    case 'set_checklist_item': return `Mark checklist item ${named('Checklist item') || ''} ${input.completed ? 'done' : 'not done'}`.replace(/\s+/g, ' ');
    case 'delete_checklist_item': return `Delete checklist item ${named('Checklist item') || ''} from ${named('Task') || 'a task'}`.replace(/\s+/g, ' ');
    case 'start_runbook_run': return `Start a run of ${named('Runbook') || 'a runbook'}`;
    case 'set_run_step': return `Mark step ${named('Step') || ''} ${input.checked ? 'done' : 'not done'}`.replace(/\s+/g, ' ');
    case 'set_run_status': return `Set run ${named('Run') || ''} to ${str(input.status) || '—'}`.replace(/\s+/g, ' ');
    case 'add_external_ref': return `Add reference ${str(input.url)} to ${named('Document') || 'a document'}`;
    case 'remove_external_ref': return `Remove reference ${named('Reference') || ''} from ${named('Document') || 'a document'}`.replace(/\s+/g, ' ');
    default: return `Run ${name}`;
  }
}
