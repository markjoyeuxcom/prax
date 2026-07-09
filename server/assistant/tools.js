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
    readOnly: tool.annotations?.readOnlyHint === true,
    handler: tool.handler,
  }));
}

// A short, human-facing summary of a proposed write, shown in the confirmation
// card. Falls back to the tool name for tools without a bespoke phrasing.
export function summarizeWrite(name, input = {}) {
  const q = (s) => (s ? `“${String(s).slice(0, 80)}”` : '');
  switch (name) {
    case 'create_task': return `Create task ${q(input.title)}`.trim();
    case 'update_task': return `Update task ${input.id ? input.id.slice(0, 8) : ''}`.trim();
    case 'create_document': return `Create ${input.documentType || 'document'} ${q(input.title)}`.trim();
    case 'update_document': return `Update document ${input.id ? input.id.slice(0, 8) : ''}`.trim();
    case 'supersede_document': return `Supersede a document`;
    case 'generate_runbook': return `Generate a runbook from ${q(input.description)}`.trim();
    case 'generate_post_mortem': return `Generate a post-mortem for a run`;
    case 'link_documents': return `Link two documents`;
    case 'unlink_documents': return `Unlink two documents`;
    case 'link_task_document': return `Link a document to a task`;
    case 'unlink_task_document': return `Unlink a document from a task`;
    case 'add_checklist_item': return `Add a checklist item ${q(input.label)}`.trim();
    case 'set_checklist_item': return `Toggle a checklist item`;
    case 'delete_checklist_item': return `Delete a checklist item`;
    case 'start_runbook_run': return `Start a runbook run`;
    case 'set_run_step': return `Check/uncheck a run step`;
    case 'set_run_status': return `Set a run's status to ${input.status || '—'}`;
    default: return `Run ${name}`;
  }
}
