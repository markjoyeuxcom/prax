// The document type taxonomy — ONE registry shared by every surface: the
// server routes (validation), the MCP tools (zod enum → also the in-app
// assistant), the prax CLI (--type validation), and the frontend (info-form
// select, Library facets + card-grid groups, type chips). Like taskFilter.js
// it must stay DOM-free so server/, mcp/, and cli/ can import it.
//
// The DB no longer constrains document_type (migration 0010 dropped the
// CHECK); this list IS the vocabulary. Order here is display order.
//
// Types say what a document IS. Runbooks support execution; templates support
// creating independent copies. The trust axes are separate and must not be
// conflated: kind (source|synthesized provenance), updatedBy (user|agent),
// verified, status (active|superseded|deprecated).
export const DOCUMENT_TYPES = [
  { value: 'runbook', label: 'Runbook', plural: 'Runbooks' },
  { value: 'note', label: 'Note', plural: 'Notes' },
  { value: 'decision', label: 'Decision', plural: 'Decisions' },
  { value: 'known-issue', label: 'Known issue', plural: 'Known issues' },
  { value: 'template', label: 'Template', plural: 'Templates' },
  { value: 'reference', label: 'Reference', plural: 'References' },
  { value: 'post-mortem', label: 'Post-mortem', plural: 'Post-mortems' },
];

export const DOCUMENT_TYPE_VALUES = DOCUMENT_TYPES.map((t) => t.value);

const BY_VALUE = new Map(DOCUMENT_TYPES.map((t) => [t.value, t]));

export function isDocumentType(value) {
  return BY_VALUE.has(value);
}

// Display helpers tolerate unknown/legacy values (render the raw string
// rather than lying about the type — the old UI coerced everything to Note).
export function documentTypeLabel(value) {
  return BY_VALUE.get(value)?.label ?? String(value || 'Note');
}

export function documentTypePlural(value) {
  return BY_VALUE.get(value)?.plural ?? documentTypeLabel(value);
}
