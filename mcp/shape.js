const DEFAULT_SNIPPET = 200;
const DEFAULT_CAP = 20;

export function snippet(body, max = DEFAULT_SNIPPET) {
  return String(body ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Lightweight ref: body and timestamps are intentionally omitted — use get_document for the full record.
export function toDocumentRef(doc) {
  return {
    id: doc.id,
    title: doc.title,
    documentType: doc.documentType,
    context: doc.context,
    tags: doc.tags ?? [],
    snippet: snippet(doc.body),
  };
}

export function toTaskRef(task) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    context: task.context,
    dueDate: task.dueDate ?? null,
  };
}

export function capResults(items, max = DEFAULT_CAP) {
  return Array.isArray(items) ? items.slice(0, max) : [];
}
