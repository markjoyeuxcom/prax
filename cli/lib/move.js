// `prax move <id> --to <project>`: refile one document or one task under
// another project. The server already accepts a `project` slug on both update
// routes (PATCH /api/library/documents/:id and PATCH /api/tasks/:id) and
// resolves it to the new owner; this is the command-line route to the same
// refiling the Inbox offers a person, for an agent that filed a note under the
// wrong project.
//
// Rules: the target project must already exist (a typo must not create a
// project); only an active document moves (a superseded or archived one keeps
// its place in history); a record already under the target is reported, not
// rewritten; and the id is tried as a document first, then as a task.

const NOT_FOUND = new Set([400, 404]);

async function fetchOrNull(call) {
  try {
    return await call();
  } catch (error) {
    if (NOT_FOUND.has(error?.status)) return null;
    throw error;
  }
}

function findProject(projects, target) {
  const wanted = String(target).trim();
  const list = Array.isArray(projects) ? projects : [];
  return list.find((p) => p.slug === wanted)
    || list.find((p) => typeof p.name === 'string' && p.name.toLowerCase() === wanted.toLowerCase())
    || null;
}

export async function moveRecord(client, id, target) {
  if (!id) throw new Error('move requires a document or task id.');
  if (!target || !String(target).trim()) throw new Error('move requires --to <project-slug>.');

  const projects = await client.listProjects();
  const to = findProject(projects, target);
  if (!to) throw new Error(`project "${target}" does not exist; move never creates one. Create it first (prax init --project <slug>, or in the app).`);
  const slugOf = (projectId) => (Array.isArray(projects) ? projects : []).find((p) => p.id === projectId)?.slug || projectId || null;

  const document = await fetchOrNull(() => client.getDocument(id));
  if (document) {
    const status = document.status || 'active';
    if (status !== 'active') throw new Error(`document ${id} is ${status}; only an active document can be moved.`);
    const from = document.projectSlug || slugOf(document.projectId);
    if (document.projectId === to.id || from === to.slug) {
      throw new Error(`document ${id} is already in ${to.slug}.`);
    }
    const updated = await client.updateMemory(id, { project: to.slug });
    return { kind: 'document', id: updated?.id || id, title: updated?.title || document.title, from, to: to.slug, record: updated };
  }

  const task = await fetchOrNull(() => client.getTask(id));
  if (!task) throw new Error(`no document or task with id ${id}.`);
  const from = slugOf(task.projectId);
  if (task.projectId === to.id) throw new Error(`task ${id} is already in ${to.slug}.`);
  const updated = await client.patchTask(id, { project: to.slug }, { retryUnavailable: 'connect-only' });
  return { kind: 'task', id: updated?.id || id, title: updated?.title || task.title, from, to: to.slug, record: updated };
}

export function formatMove(result) {
  return `Moved ${result.kind} "${result.title}" (${result.id}) from ${result.from} to ${result.to}.`;
}
