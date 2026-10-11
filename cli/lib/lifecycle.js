// `prax archive <id>`, `prax restore <id>` and `prax delete <id> --yes`: the
// lifecycle of one document or one task from the command line, for an agent
// that filed something wrong (docs/design/agent-archive-delete.md).
//
// Rules: the id is tried as a document first, then as a task; archive is the
// reversible step and the only one an agent takes in one move; restore undoes
// it; delete is permanent, so it needs an archived record, never a verified
// document (a person's verification is removed by a person), and an explicit
// `--yes` so the intent is on the record. Every request carries the agent's
// origin and id. Superseding stays the right retirement for memory that was
// replaced; archive is for memory that should not have been written.

const NOT_FOUND = new Set([400, 404]);

async function fetchOrNull(call) {
  try {
    return await call();
  } catch (error) {
    if (NOT_FOUND.has(error?.status)) return null;
    throw error;
  }
}

// { kind, record } for an id, or null when neither a document nor a task has it.
export async function findRecord(client, id) {
  const document = await fetchOrNull(() => client.getDocument(id));
  if (document) return { kind: 'document', record: document };
  const task = await fetchOrNull(() => client.getTask(id));
  if (task) return { kind: 'task', record: task };
  return null;
}

const isArchived = (record) => Boolean(record?.archivedAt);
const label = (kind, record, id) => `${kind} "${record?.title || 'Untitled'}" (${id})`;

function requireId(action, id) {
  if (!id) throw new Error(`${action} requires a document or task id.`);
}

async function lookup(client, id) {
  const found = await findRecord(client, id);
  if (!found) throw new Error(`no document or task with id ${id}.`);
  return found;
}

export async function archiveRecord(client, id) {
  requireId('archive', id);
  const { kind, record } = await lookup(client, id);
  if (isArchived(record)) throw new Error(`${label(kind, record, id)} is already archived.`);
  const updated = kind === 'document' ? await client.archiveDocument(id) : await client.archiveTask(id);
  return { action: 'archived', kind, id, title: updated?.title || record.title, record: updated };
}

export async function restoreRecord(client, id) {
  requireId('restore', id);
  const { kind, record } = await lookup(client, id);
  if (!isArchived(record)) throw new Error(`${label(kind, record, id)} is not archived; nothing to restore.`);
  const updated = kind === 'document' ? await client.restoreDocument(id) : await client.restoreTask(id);
  return { action: 'restored', kind, id, title: updated?.title || record.title, record: updated };
}

export async function deleteRecord(client, id, { yes = false } = {}) {
  requireId('delete', id);
  const { kind, record } = await lookup(client, id);
  const what = label(kind, record, id);
  if (!isArchived(record)) {
    throw new Error(`${what} is not archived. Delete is permanent and takes an archived record only: run \`prax archive ${id}\` first, then delete it.`);
  }
  if (kind === 'document' && record.verified) {
    throw new Error(`${what} was verified by ${record.verifiedBy || 'a person'}; an agent never deletes verified memory. Leave it archived for a person to decide.`);
  }
  if (!yes) {
    throw new Error(`${what} would be permanently deleted. Re-run with --yes to confirm; there is no undo.`);
  }
  const removed = kind === 'document' ? await client.deleteDocument(id) : await client.deleteTask(id);
  return { action: 'deleted', kind, id, title: removed?.title || record.title, record: removed };
}

export function formatLifecycle(result) {
  const verb = { archived: 'Archived', restored: 'Restored', deleted: 'Permanently deleted' }[result.action] || result.action;
  const tail = result.action === 'archived' ? ` Restore it with \`prax restore ${result.id}\`.` : '';
  return `${verb} ${result.kind} "${result.title}" (${result.id}).${tail}`;
}
