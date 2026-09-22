import { deriveSlug } from '../slug.js';
import { summarizeWrite } from './tools.js';

// What the approval card shows for one proposed write: the records it touches
// (by title, not a truncated id) and every field it sets, with the current
// value beside the proposed one. The person approves THAT exact change
// (QINV-03), so nothing the tool will send may be left out or cut short.
//
//   { summary,
//     targets: [{ role, kind, id, title, detail?, missing? }],
//     changes: [{ field, label, before?, after, format, unchanged? }],
//     notes:   [string] }
//
// `before` is absent for values a create introduces and null for an empty
// current value. `format` is 'body' for Markdown bodies (the card renders a
// line diff), 'list' for tags/labels, otherwise 'value'. Lookups go through the
// same in-process client the tools use; a failed lookup degrades to the raw
// id plus a note, never to a missing row.

const LABELS = {
  title: 'Title', body: 'Body', documentType: 'Type', project: 'Project', tags: 'Tags', kind: 'Kind',
  description: 'Description', notes: 'Notes', priority: 'Priority', status: 'Status',
  dueDate: 'Due date', dueTime: 'Due time', recurrence: 'Repeats', labels: 'Labels',
  label: 'Label', completed: 'Completed', checked: 'Done', url: 'URL', relation: 'Relation',
};

// Caller-stable idempotency keys: they name the record a create will produce
// and change nothing the person can see.
const STABLE_IDS = {
  create_task: ['id'], create_document: ['id'], add_checklist_item: ['itemId'],
  start_runbook_run: ['runId'], generate_post_mortem: ['documentId'], generate_runbook: ['documentId'],
};

// Inputs that name existing records → [role shown on the card, record kind].
const TARGETS = {
  update_task: { id: ['Task', 'task'] },
  update_document: { id: ['Document', 'document'] },
  supersede_document: { documentId: ['Retires', 'document'], supersededBy: ['Replaced by', 'document'] },
  link_documents: { sourceId: ['From', 'document'], targetId: ['To', 'document'] },
  unlink_documents: { sourceId: ['From', 'document'], targetId: ['To', 'document'] },
  link_task_document: { taskId: ['Task', 'task'], documentId: ['Document', 'document'] },
  unlink_task_document: { taskId: ['Task', 'task'], documentId: ['Document', 'document'] },
  add_checklist_item: { taskId: ['Task', 'task'] },
  set_checklist_item: { taskId: ['Task', 'task'], itemId: ['Checklist item', 'checklist'] },
  delete_checklist_item: { taskId: ['Task', 'task'], itemId: ['Checklist item', 'checklist'] },
  start_runbook_run: { documentId: ['Runbook', 'document'] },
  set_run_step: { runId: ['Run', 'run'], stepId: ['Step', 'step'] },
  set_run_status: { runId: ['Run', 'run'] },
  generate_post_mortem: { runId: ['Run', 'run'] },
  add_external_ref: { documentId: ['Document', 'document'] },
  remove_external_ref: { documentId: ['Document', 'document'], refId: ['Reference', 'externalRef'] },
};

function display(value) {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value)) return value.length ? value.map(String).join(', ') : null;
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatOf(field, value) {
  if (field === 'body') return 'body';
  return Array.isArray(value) ? 'list' : 'value';
}

function row(field, after, before) {
  const change = { field, label: LABELS[field] || field, after: display(after), format: formatOf(field, after) };
  if (before !== undefined) {
    change.before = display(before);
    if (change.before === change.after) change.unchanged = true;
  }
  return change;
}

function projectMatcher(projects) {
  const list = Array.isArray(projects) ? projects : [];
  const byId = new Map(list.map((p) => [p.id, p]));
  return {
    name(id) { return id ? (byId.get(id)?.name ?? id) : null; },
    // Mirrors projectsRepository.resolveProject: id, slug (either case), the
    // slug the name would derive, or the name case-insensitively.
    resolve(raw) {
      const value = String(raw ?? '').trim();
      if (!value) return null;
      const lower = value.toLowerCase();
      const slug = deriveSlug(value);
      return byId.get(value)
        || list.find((p) => String(p.slug || '').toLowerCase() === lower)
        || list.find((p) => p.slug === slug)
        || list.find((p) => String(p.name || '').toLowerCase() === lower)
        || null;
    },
  };
}

async function attempt(fn) {
  try { return { value: await fn() }; } catch (err) { return { error: err }; }
}

// The in-process client, memoised per preview so one card never fetches the
// same record twice.
function lookups(client) {
  const cache = new Map();
  const once = (key, fn) => {
    if (!cache.has(key)) cache.set(key, attempt(fn));
    return cache.get(key);
  };
  return {
    document: (id) => once(`d:${id}`, () => client.getDocument(id)),
    task: (id) => once(`t:${id}`, () => client.getTask(id)),
    checklist: (taskId) => once(`c:${taskId}`, () => client.listChecklist(taskId)),
    run: (id) => once(`r:${id}`, () => client.getRunbookRun(id)),
    externalRefs: (documentId) => once(`x:${documentId}`, () => client.listExternalRefs(documentId)),
    projects: () => once('projects', () => client.listProjects()),
  };
}

function documentDetail(doc, projects) {
  const parts = [doc.documentType || 'document'];
  if (doc.status && doc.status !== 'active') parts.push(doc.status);
  parts.push(doc.verified ? 'verified' : 'unverified');
  const project = projects.name(doc.projectId);
  if (project) parts.push(`in ${project}`);
  return parts.join(' · ');
}

async function resolveTarget(kind, id, input, look, projects) {
  const base = { kind, id: String(id ?? '') };
  if (!look) return { ...base, title: null };
  if (kind === 'document') {
    const { value: doc, error } = await look.document(id);
    if (error) return { ...base, title: null, unresolved: true };
    if (!doc) return { ...base, title: null, missing: true };
    return { ...base, title: doc.title, detail: documentDetail(doc, projects), record: doc };
  }
  if (kind === 'task') {
    const { value: task, error } = await look.task(id);
    if (error) return { ...base, title: null, unresolved: true };
    if (!task) return { ...base, title: null, missing: true };
    const project = projects.name(task.projectId);
    return { ...base, title: task.title, detail: [task.status, project && `in ${project}`].filter(Boolean).join(' · '), record: task };
  }
  if (kind === 'checklist') {
    const { value: items, error } = await look.checklist(input.taskId);
    if (error) return { ...base, title: null, unresolved: true };
    const item = (Array.isArray(items) ? items : []).find((i) => i.id === id);
    if (!item) return { ...base, title: null, missing: true };
    return { ...base, title: item.label, detail: item.completed ? 'done' : 'not done', record: item };
  }
  if (kind === 'run' || kind === 'step') {
    const runId = kind === 'run' ? id : input.runId;
    const { value: run, error } = await look.run(runId);
    if (error) return { ...base, title: null, unresolved: true };
    if (!run) return { ...base, title: null, missing: true };
    if (kind === 'run') {
      return { ...base, title: run.title || run.documentTitle || 'Untitled run', detail: [run.documentTitle && `runbook ${run.documentTitle}`, run.status].filter(Boolean).join(' · '), record: run };
    }
    const step = (Array.isArray(run.steps) ? run.steps : []).find((s) => s.id === id);
    if (!step) return { ...base, title: null, missing: true };
    return { ...base, title: step.text, detail: step.checkedAt ? 'done' : 'not done', record: step };
  }
  if (kind === 'externalRef') {
    const { value: refs, error } = await look.externalRefs(input.documentId);
    if (error) return { ...base, title: null, unresolved: true };
    const ref = (Array.isArray(refs) ? refs : []).find((r) => r.id === id);
    if (!ref) return { ...base, title: null, missing: true };
    return { ...base, title: ref.label || ref.url, detail: ref.label ? ref.url : '', record: ref };
  }
  return { ...base, title: null };
}

// Current values for the fields an update may change, keyed like the input.
function currentValues(name, target, projects) {
  const record = target?.record;
  if (!record) return null;
  if (name === 'update_task') {
    return {
      title: record.title, description: record.description, notes: record.notes, priority: record.priority,
      status: record.status, project: projects.name(record.projectId), dueDate: record.dueDate,
      dueTime: record.dueTime, recurrence: record.recurrence, labels: record.labels,
    };
  }
  if (name === 'update_document') {
    return {
      title: record.title, body: record.body, documentType: record.documentType,
      project: projects.name(record.projectId), tags: record.tags, kind: record.kind || 'source',
    };
  }
  return null;
}

export async function buildWritePreview(client, name, input = {}) {
  const args = input && typeof input === 'object' ? input : {};
  const look = client ? lookups(client) : null;
  const projectsResult = look ? await look.projects() : { value: [] };
  const projects = projectMatcher(projectsResult.value);
  const targetKeys = TARGETS[name] || {};
  const skip = new Set([...(STABLE_IDS[name] || []), ...Object.keys(targetKeys)]);
  const notes = [];

  const targets = [];
  for (const [key, [role, kind]] of Object.entries(targetKeys)) {
    if (args[key] === undefined) continue;
    const target = await resolveTarget(kind, args[key], args, look, projects);
    targets.push({ role, ...target });
    if (target.missing) notes.push(`${role} ${target.id} was not found; this action will fail.`);
    if (target.unresolved) notes.push(`${role} ${target.id} could not be looked up; check it before approving.`);
  }
  const primary = targets[0];
  const before = currentValues(name, primary, projects);

  const changes = [];
  for (const [field, value] of Object.entries(args)) {
    if (skip.has(field)) continue;
    let after = value;
    if (field === 'project' && typeof value === 'string') {
      const project = projects.resolve(value);
      if (project) after = project.name;
      else if (look) notes.push(`Project “${value}” does not match an existing project.`);
    }
    changes.push(row(field, after, before ? before[field] : undefined));
  }

  // Values the tool applies although the model did not send them.
  if (name === 'create_task') {
    if (args.priority === undefined) changes.push({ ...row('priority', 'medium'), defaulted: true });
    if (args.status === undefined) changes.push({ ...row('status', 'planned'), defaulted: true });
  }
  if (name === 'create_document' && args.kind === undefined) changes.push({ ...row('kind', 'source'), defaulted: true });

  // Lifecycle effects that are not input fields.
  const retiring = name === 'supersede_document'
    ? targets.find((t) => t.role === 'Retires')
    : (name === 'link_documents' && args.relation === 'supersedes' ? targets.find((t) => t.role === 'To') : null);
  if (retiring?.record) {
    changes.push({ ...row('status', 'superseded', retiring.record.status || 'active'), label: `Status of “${retiring.title}”` });
    notes.push(`“${retiring.title}” drops out of default retrieval.`);
  }
  if (name === 'unlink_documents' && args.relation === 'supersedes') {
    notes.push('Removing the last supersedes link returns the older document to active.');
  }
  if (name === 'set_checklist_item') {
    const item = targets.find((t) => t.kind === 'checklist')?.record;
    const change = changes.find((c) => c.field === 'completed');
    if (item && change) Object.assign(change, row('completed', args.completed, Boolean(item.completed)));
  }
  if (name === 'set_run_step') {
    const step = targets.find((t) => t.kind === 'step')?.record;
    const change = changes.find((c) => c.field === 'checked');
    if (step && change) Object.assign(change, row('checked', args.checked, Boolean(step.checkedAt)));
  }
  if (name === 'set_run_status') {
    const run = targets.find((t) => t.kind === 'run')?.record;
    const change = changes.find((c) => c.field === 'status');
    if (run && change) Object.assign(change, row('status', args.status, run.status));
  }
  if (name === 'update_document' && primary?.record?.verified) {
    const contentChanges = changes.some((c) => (c.field === 'title' || c.field === 'body') && !c.unchanged);
    if (contentChanges) notes.push('This document is verified. Changing its title or body clears the verification.');
  }
  if (name === 'create_document' || name === 'generate_runbook' || name === 'generate_post_mortem') {
    notes.push('The new document is marked agent-written and unverified.');
  }

  return {
    summary: summarizeWrite(name, args, targets),
    targets: targets.map(({ record: _record, ...target }) => target),
    changes,
    notes,
  };
}
