// A stable snapshot of the reviewed content owns every creation attempt.
// Session storage isolates tabs while retaining pending work through reload.
export const TEMPLATE_DRAFT_KEY = 'prax.templateDraft.v1';

export function saveTemplateDraft(storage, draft) {
  storage.setItem(TEMPLATE_DRAFT_KEY, JSON.stringify({ ...draft, pending: false, error: '' }));
}
export function loadTemplateDraft(storage) {
  try {
    const value = JSON.parse(storage.getItem(TEMPLATE_DRAFT_KEY));
    return value?.source && typeof value.source.body === 'string' && typeof value.title === 'string'
      ? { ...value, pending: false, error: value.job ? 'Creation was interrupted. Retry to recover the same copy.' : '' }
      : null;
  } catch { return null; }
}
export function clearTemplateDraft(storage) { storage.removeItem(TEMPLATE_DRAFT_KEY); }

export function templateChoices(starters, documents) {
  return [...starters, ...(documents || []).filter(doc => doc.documentType === 'template'
    && !doc.archivedAt && (doc.status || 'active') === 'active').map(doc => ({
    id: `document:${doc.id}`, sourceId: doc.id, sourceRevision: doc.revision,
    label: doc.title, title: `${doc.title} — copy`, hint: 'Saved Library template',
    body: doc.body, target: 'document', documentType: 'note',
    tags: (doc.tags || []).filter(tag => tag !== 'template'),
  }))];
}

export function buildTemplateJob(draft, id) {
  const { source, project, title, documentType } = draft;
  if (!source || !project || !title.trim()) throw new Error('Choose a template, destination project and title.');
  if (source.target === 'task') {
    const checklist = [...source.body.matchAll(/^- \[ \] (.+)$/gm)].map(match => ({ label: match[1], completed: false }));
    // Keep acceptance criteria in the native checklist, not two editable copies.
    const notes = source.body.replace(/^## Acceptance checklist\n\n(?:- \[ \] .+\n)+/m, '');
    return { target: 'task', payload: { requestId: id, project, mode: 'append', tasks: [{
      title: title.trim(), notes, status: 'planned', priority: 'medium',
      labels: source.tags || [], checklist,
    }] } };
  }
  return { target: 'document', payload: {
    id, operationId: id, project, title: title.trim(), body: source.body, documentType,
    tags: source.tags || [], kind: 'synthesized', verified: false,
  } };
}

export async function executeTemplateJob(job, api) {
  if (job.target === 'task') {
    const result = await api.importTasks(job.payload);
    if (result.imported !== 1 || !result.tasks?.[0]?.id) throw new Error('The task result could not be confirmed. Retry to check the same creation.');
    const record = result.replayed ? await api.fetchTask(result.tasks[0].id) : result.tasks[0];
    return { target: 'task', record };
  }
  try {
    return { target: 'document', record: await api.createDocument(job.payload) };
  } catch (error) {
    if (error.status === 409 || error.status === 410) throw error;
    // The response may be lost AFTER commit. This random ID was persisted before
    // the write; read back its current revision without replaying older content.
    const record = await api.fetchDocument(job.payload.id).catch(() => null);
    if (record?.id === job.payload.id) return { target: 'document', record };
    throw error;
  }
}
