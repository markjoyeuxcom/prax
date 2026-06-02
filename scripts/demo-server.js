import { randomUUID, createHash } from 'node:crypto';
import { loadConfig } from '../server/config.js';

const hashBody = (b) => createHash('sha256').update(String(b ?? '')).digest('hex');
import { buildApp } from '../server/index.js';
import { deriveSlug } from '../server/slug.js';

const now = new Date().toISOString();

// ---------------------------------------------------------------------------
// Fixed project IDs — reused in task/document seed data
// ---------------------------------------------------------------------------
const PROJECT_ID_PERSONAL = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID_WORK     = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID_HOMELAB  = '33333333-3333-4333-8333-333333333333';

const sharedProjects = [
  {
    id: PROJECT_ID_PERSONAL,
    name: 'Personal',
    slug: 'personal',
    status: 'active',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: PROJECT_ID_WORK,
    name: 'Work',
    slug: 'work',
    status: 'active',
    sortOrder: 1,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: PROJECT_ID_HOMELAB,
    name: 'Homelab',
    slug: 'homelab',
    status: 'active',
    sortOrder: 2,
    createdAt: now,
    updatedAt: now,
  },
];

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function createMemoryProjectsRepository(projects) {
  return {
    async listProjects(status) {
      let result = [...projects];
      if (status && status !== 'all') {
        result = result.filter(p => p.status === status);
      }
      return result.sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.name.localeCompare(b.name);
      });
    },

    async createProject({ name, status = 'active' }) {
      const takenSlugs = projects.map(p => p.slug);
      const slug = deriveSlug(name, takenSlugs);
      const project = {
        id: randomUUID(),
        name,
        slug,
        status,
        sortOrder: projects.reduce((max, p) => Math.max(max, p.sortOrder), -1) + 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      projects.push(project);
      return project;
    },

    async updateProject(id, fields) {
      const project = projects.find(p => p.id === id);
      if (!project) return null;
      if (fields.name !== undefined) project.name = fields.name;
      if (fields.status !== undefined) project.status = fields.status;
      if (fields.sortOrder !== undefined) project.sortOrder = fields.sortOrder;
      project.updatedAt = new Date().toISOString();
      return project;
    },

    async archiveProject(id) {
      const project = projects.find(p => p.id === id);
      if (!project) return null;
      project.status = 'archived';
      project.updatedAt = new Date().toISOString();
      return project;
    },

    async countProjectDependents(id) {
      return sharedProjectDependentCounter(id);
    },

    async deleteProject(id) {
      const index = projects.findIndex(p => p.id === id);
      if (index < 0) return null;
      return projects.splice(index, 1)[0];
    },

    async resolveProject(idOrSlug) {
      if (isUuid(idOrSlug)) {
        return projects.find(p => p.id === idOrSlug) || null;
      }
      return projects.find(p => p.slug === idOrSlug) || null;
    },
  };
}

// ---------------------------------------------------------------------------
// Task helpers
// ---------------------------------------------------------------------------
function createTask(seed) {
  return {
    id: randomUUID(),
    title: seed.title,
    description: seed.description || '',
    notes: seed.notes || '',
    priority: seed.priority || 'medium',
    status: seed.status || 'planned',
    projectId: seed.projectId || PROJECT_ID_HOMELAB,
    dueDate: seed.dueDate || null,
    sortOrder: seed.sortOrder || 0,
    createdAt: seed.createdAt || now,
    updatedAt: seed.updatedAt || now,
    archivedAt: seed.archivedAt || null,
  };
}

function createDocument(seed) {
  const body = seed.body || '';
  return {
    id: randomUUID(),
    title: seed.title,
    body,
    documentType: seed.documentType || 'note',
    projectId: seed.projectId || PROJECT_ID_HOMELAB,
    tags: seed.tags || [],
    sourceFilename: seed.sourceFilename || null,
    createdAt: seed.createdAt || now,
    updatedAt: seed.updatedAt || now,
    archivedAt: seed.archivedAt || null,
    contentHash: hashBody(body),
    updatedBy: seed.updatedBy || 'user',
    kind: seed.kind || 'source',
  };
}

function matchesArchived(item, archived) {
  if (archived === true || archived === 'true') return Boolean(item.archivedAt);
  if (archived === 'all') return true;
  return !item.archivedAt;
}

// Module-level so the project dependent counter can see tasks as well as docs.
const sharedTasks = [
  createTask({
    title: 'Back up CNPG',
    description: 'Verify backup schedule',
    priority: 'high',
    status: 'planned',
    projectId: PROJECT_ID_HOMELAB,
    dueDate: '2026-05-18',
  }),
  createTask({
    title: 'Patch ingress',
    description: 'Review controller release notes',
    priority: 'medium',
    status: 'in-progress',
    projectId: PROJECT_ID_HOMELAB,
  }),
  createTask({
    title: 'Inventory UPS batteries',
    description: 'Backlog maintenance item',
    priority: 'low',
    status: 'planned',
    projectId: PROJECT_ID_HOMELAB,
    sortOrder: 1,
  }),
];

function createMemoryTasksRepository(documentsRef, checklistRepositoryRef = null) {
  const links = [];
  const tasks = sharedTasks;
  const activity = [];

  // Seed one `created` activity event per seeded task so the demo detail panel
  // shows a populated activity feed out of the box.
  for (const task of tasks) {
    activity.push({
      id: `act-${activity.length + 1}`,
      taskId: task.id,
      eventType: 'created',
      message: 'Task created',
      createdAt: new Date().toISOString(),
    });
  }

  return {
    async listTasks(filters = {}) {
      return tasks.filter((task) => {
        if (filters.projectId && task.projectId !== filters.projectId) return false;
        if (filters.status && task.status !== filters.status) return false;
        if (!matchesArchived(task, filters.archived)) return false;
        if (filters.q) {
          const query = String(filters.q).toLowerCase();
          return `${task.title} ${task.description}`.toLowerCase().includes(query);
        }
        return true;
      });
    },
    async createTask(task) {
      const created = createTask(task);
      tasks.push(created);
      return created;
    },
    async importTasks(importedTasks) {
      const created = importedTasks.map(createTask);
      tasks.push(...created);
      return created;
    },
    async replaceProjectTasks(projectId, importedTasks) {
      for (let index = tasks.length - 1; index >= 0; index -= 1) {
        if (tasks[index].projectId === projectId) tasks.splice(index, 1);
      }
      // A replace import targets one project, so force every imported row into
      // it — otherwise rows missing projectId would default to Homelab.
      return this.importTasks(importedTasks.map((task) => ({ ...task, projectId })));
    },
    async updateTask(id, fields) {
      const task = tasks.find(item => item.id === id && !item.archivedAt);
      if (!task) return null;
      Object.assign(task, fields, { updatedAt: new Date().toISOString() });
      return task;
    },
    async archiveTask(id) {
      const task = tasks.find(item => item.id === id && !item.archivedAt);
      if (!task) return null;
      task.archivedAt = new Date().toISOString();
      return task;
    },
    async restoreTask(id) {
      const task = tasks.find(item => item.id === id && item.archivedAt);
      if (!task) return null;
      task.archivedAt = null;
      return task;
    },
    async deleteArchivedTask(id) {
      const index = tasks.findIndex(item => item.id === id && item.archivedAt);
      if (index < 0) return null;
      return tasks.splice(index, 1)[0];
    },
    async reorderTasks(updates) {
      return updates.map((update) => {
        const task = tasks.find(item => item.id === update.id && !item.archivedAt);
        if (!task) return null;
        Object.assign(task, update, { updatedAt: new Date().toISOString() });
        return task;
      }).filter(Boolean);
    },

    async getTask(id) {
      // Return a snapshot (not the live object) so the route layer can compare
      // a task's prior status against the post-update status — updateTask
      // mutates the stored object in place, which would otherwise make the
      // `prior` reference reflect the new status before the comparison.
      const task = tasks.find(t => t.id === id);
      return task ? { ...task } : null;
    },
    async recordActivity(taskId, eventType, message) {
      const event = { id: `act-${activity.length + 1}`, taskId, eventType, message, createdAt: new Date().toISOString() };
      activity.push(event);
      return event;
    },
    async listTaskActivity(taskId) {
      return activity.filter(a => a.taskId === taskId).slice().reverse();
    },

    async listTaskBoardExtras(taskIds) {
      const ids = Array.isArray(taskIds) ? taskIds : [];
      const result = [];
      for (const taskId of ids) {
        const docsCount = links
          .filter(link => link.taskId === taskId)
          .map(link => documentsRef.find(doc => doc.id === link.documentId && !doc.archivedAt))
          .filter(Boolean).length;
        const items = checklistRepositoryRef ? await checklistRepositoryRef.listChecklist(taskId) : [];
        const taskActivity = activity.filter(a => a.taskId === taskId);
        result.push({
          taskId,
          docsCount,
          checklistDone: items.filter(item => item.completed).length,
          checklistTotal: items.length,
          nextChecklistItem: items.find(item => !item.completed)?.label || '',
          latestActivity: taskActivity.length ? taskActivity[taskActivity.length - 1].message : '',
        });
      }
      return result;
    },

    async listTaskDocuments(taskId) {
      return links
        .filter(link => link.taskId === taskId)
        .map(link => documentsRef.find(doc => doc.id === link.documentId && !doc.archivedAt))
        .filter(Boolean)
        .map(doc => ({ id: doc.id, title: doc.title, documentType: doc.documentType, projectId: doc.projectId }))
        .sort((a, b) => a.title.localeCompare(b.title));
    },

    async linkTaskDocument(taskId, documentId) {
      const existing = links.find(link => link.taskId === taskId && link.documentId === documentId);
      if (existing) {
        return { linked: true, alreadyLinked: true };
      }
      const taskExists = tasks.some(t => t.id === taskId && !t.archivedAt);
      const docExists = documentsRef.some(d => d.id === documentId && !d.archivedAt);
      if (!taskExists || !docExists) {
        return { linked: false };
      }
      links.push({ taskId, documentId });
      return { linked: true };
    },

    async unlinkTaskDocument(taskId, documentId) {
      const index = links.findIndex(link => link.taskId === taskId && link.documentId === documentId);
      if (index < 0) return false;
      links.splice(index, 1);
      return true;
    },
  };
}

const sharedDocuments = [
  createDocument({
    title: 'Cloudflare Tunnel Implementation Plan',
    documentType: 'note',
    projectId: PROJECT_ID_HOMELAB,
    tags: ['ingress', 'cloudflare'],
    sourceFilename: '2026-05-18-cloudflare-tunnel.md',
    body: [
      '# Cloudflare Tunnel Implementation Plan',
      '',
      '> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for implementation work.',
      '',
      '**Goal:** Stand up a Cloudflare Tunnel from `acme-homelab` to the Cloudflare edge without opening inbound ports.',
      '',
      '## Phase 0 - Manual prerequisites',
      '',
      '- [ ] Log into Cloudflare',
      '- [ ] Open Zero Trust',
      '- [ ] Record the team URL',
      '',
      '```yaml',
      'service:',
      '  name: moomora-console',
      '```',
    ].join('\n'),
  }),
  createDocument({
    title: 'CloudNativePG Restore',
    documentType: 'runbook',
    projectId: PROJECT_ID_HOMELAB,
    tags: ['postgres', 'backup'],
    sourceFilename: 'cloudnativepg-restore.md',
    body: '# CloudNativePG Restore\n\nSteps for testing restore flow.',
  }),
];

// ---------------------------------------------------------------------------
// Dependent counter — wired up after sharedDocuments is defined so that
// countProjectDependents can inspect tasks and docs by projectId.
// We close over sharedDocuments here; tasks are internal to the tasks repo
// so we only count documents from the demo perspective (good enough for demo).
// ---------------------------------------------------------------------------
function sharedProjectDependentCounter(projectId) {
  const taskCount = sharedTasks.filter(t => t.projectId === projectId && !t.archivedAt).length;
  const docCount = sharedDocuments.filter(d => d.projectId === projectId && !d.archivedAt).length;
  return taskCount + docCount;
}

function createMemoryLibraryRepository(documents) {
  return {
    async listDocuments(filters = {}) {
      return documents.filter((document) => {
        if (filters.projectId && document.projectId !== filters.projectId) return false;
        if (filters.documentType && document.documentType !== filters.documentType) return false;
        if (filters.kind && document.kind !== filters.kind) return false;
        if (!matchesArchived(document, filters.archived)) return false;
        if (filters.q) {
          const query = String(filters.q).toLowerCase();
          return `${document.title} ${document.body}`.toLowerCase().includes(query);
        }
        return true;
      });
    },
    async createDocument(document) {
      const created = createDocument(document);
      created.contentHash = hashBody(document.body);
      created.updatedBy = document.updatedBy || 'user';
      created.kind = document.kind || 'source';
      documents.push(created);
      return created;
    },
    async updateDocument(id, fields) {
      const document = documents.find(item => item.id === id && !item.archivedAt);
      if (!document) return null;
      Object.assign(document, fields, { updatedAt: new Date().toISOString() });
      document.updatedBy = fields.updatedBy || 'user';
      if (Object.prototype.hasOwnProperty.call(fields, 'body')) {
        document.contentHash = hashBody(fields.body);
      }
      if (Object.prototype.hasOwnProperty.call(fields, 'kind')) {
        document.kind = fields.kind;
      }
      return document;
    },
    async archiveDocument(id) {
      const document = documents.find(item => item.id === id && !item.archivedAt);
      if (!document) return null;
      document.archivedAt = new Date().toISOString();
      return document;
    },
    async restoreDocument(id) {
      const document = documents.find(item => item.id === id && item.archivedAt);
      if (!document) return null;
      document.archivedAt = null;
      return document;
    },
    async deleteArchivedDocument(id) {
      const index = documents.findIndex(item => item.id === id && item.archivedAt);
      if (index < 0) return null;
      return documents.splice(index, 1)[0];
    },
    async getDocument(id) {
      const doc = documents.find((d) => d.id === id);
      return doc ? { ...doc } : null;
    },
    async listActiveDocumentsForExport(filters = {}) {
      const filtered = documents.filter((document) => {
        if (document.archivedAt) return false;
        if (filters.projectId && document.projectId !== filters.projectId) return false;
        return true;
      });
      return filtered
        .map((doc) => {
          const project = sharedProjects.find(p => p.id === doc.projectId);
          return { ...doc, projectSlug: project?.slug || 'unknown' };
        })
        .sort((a, b) => {
          const slugCompare = (a.projectSlug || '').localeCompare(b.projectSlug || '');
          return slugCompare !== 0 ? slugCompare : (a.title || '').localeCompare(b.title || '');
        });
    },
  };
}

function createMemoryDocumentLinksRepository(documentsRef) {
  const links = []; // { sourceId, targetId, relation, targetHash? }
  const isLive = (id) => documentsRef.some((d) => d.id === id && !d.archivedAt);
  const toRef = (id, relation, direction) => {
    const d = documentsRef.find((doc) => doc.id === id && !doc.archivedAt);
    if (!d) return null;
    return { documentId: d.id, title: d.title, documentType: d.documentType, projectId: d.projectId, relation, direction };
  };
  return {
    async linkDocuments(sourceId, targetId, relation) {
      if (!isLive(sourceId) || !isLive(targetId)) return { linked: false };
      const existing = links.find((l) => l.sourceId === sourceId && l.targetId === targetId && l.relation === relation);
      if (existing) {
        if (relation === 'derived-from') {
          existing.targetHash = documentsRef.find((d) => d.id === targetId)?.contentHash;
        }
        return { linked: true, alreadyLinked: true };
      }
      const link = { sourceId, targetId, relation };
      if (relation === 'derived-from') {
        link.targetHash = documentsRef.find((d) => d.id === targetId)?.contentHash;
      }
      links.push(link);
      return { linked: true };
    },
    async unlinkDocuments(sourceId, targetId, relation) {
      const i = links.findIndex((l) => l.sourceId === sourceId && l.targetId === targetId && l.relation === relation);
      if (i < 0) return false;
      links.splice(i, 1);
      return true;
    },
    async listDocumentLinks(documentId, direction = 'both') {
      const out = [];
      if (direction !== 'inbound') {
        for (const l of links.filter((l) => l.sourceId === documentId)) {
          const ref = toRef(l.targetId, l.relation, 'outbound');
          if (ref) out.push(ref);
        }
      }
      if (direction !== 'outbound') {
        for (const l of links.filter((l) => l.targetId === documentId)) {
          const ref = toRef(l.sourceId, l.relation, 'inbound');
          if (ref) out.push(ref);
        }
      }
      return out;
    },
    async listStaleDocuments(projectId) {
      const results = [];
      // Group derived-from links where stored targetHash differs from current target contentHash
      const staleBySource = new Map();
      for (const l of links) {
        if (l.relation !== 'derived-from') continue;
        if (!l.targetHash) continue;
        const sourceDoc = documentsRef.find((d) => d.id === l.sourceId && !d.archivedAt);
        const targetDoc = documentsRef.find((d) => d.id === l.targetId && !d.archivedAt);
        if (!sourceDoc || !targetDoc) continue;
        if (l.targetHash === targetDoc.contentHash) continue;
        if (projectId && sourceDoc.projectId !== projectId) continue;
        if (!staleBySource.has(l.sourceId)) {
          staleBySource.set(l.sourceId, { doc: sourceDoc, staleSources: [] });
        }
        staleBySource.get(l.sourceId).staleSources.push({ documentId: targetDoc.id, title: targetDoc.title });
      }
      for (const { doc, staleSources } of staleBySource.values()) {
        results.push({
          documentId: doc.id,
          title: doc.title,
          documentType: doc.documentType,
          projectId: doc.projectId,
          updatedBy: doc.updatedBy || 'user',
          kind: doc.kind,
          staleSources,
        });
      }
      return results;
    },
    async listOrphanDocuments(projectId) {
      const linkedIds = new Set();
      for (const l of links) {
        linkedIds.add(l.sourceId);
        linkedIds.add(l.targetId);
      }
      return documentsRef
        .filter((d) => {
          if (d.archivedAt) return false;
          if (linkedIds.has(d.id)) return false;
          if (projectId && d.projectId !== projectId) return false;
          return true;
        })
        .map((d) => ({ documentId: d.id, title: d.title, documentType: d.documentType, projectId: d.projectId, kind: d.kind }));
    },
    async listOutboundLinksForDocuments(docIds) {
      const grouped = new Map();
      if (!Array.isArray(docIds) || docIds.length === 0) return grouped;
      const ids = new Set(docIds);
      for (const l of links) {
        if (!ids.has(l.sourceId)) continue;
        const target = documentsRef.find((d) => d.id === l.targetId && !d.archivedAt);
        if (!target) continue;
        const targetProject = sharedProjects.find((p) => p.id === target.projectId);
        if (!grouped.has(l.sourceId)) {
          grouped.set(l.sourceId, { 'derived-from': [], supersedes: [] });
        }
        const bucket = grouped.get(l.sourceId);
        if (l.relation === 'derived-from' || l.relation === 'supersedes') {
          bucket[l.relation].push({
            targetId: target.id,
            targetProjectSlug: targetProject ? targetProject.slug : 'unknown',
            targetSourceFilename: target.sourceFilename,
            targetTitle: target.title,
          });
        }
      }
      return grouped;
    },
  };
}

function createMemoryChecklistRepository() {
  const items = [];
  // Item ids must be UUIDs so they pass the route layer's itemId validation,
  // mirroring the real Postgres repository's gen_random_uuid() ids.
  const nextId = () => randomUUID();
  return {
    async listChecklist(taskId) {
      return items.filter(i => i.taskId === taskId).sort((a, b) => a.sortOrder - b.sortOrder);
    },
    async addChecklistItem(taskId, label) {
      const sortOrder = items.filter(i => i.taskId === taskId).reduce((m, i) => Math.max(m, i.sortOrder), -1) + 1;
      const item = { id: nextId(), taskId, label, completed: false, sortOrder, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      items.push(item);
      return item;
    },
    async setChecklistItemCompleted(taskId, itemId, completed) {
      const it = items.find(i => i.id === itemId && i.taskId === taskId);
      if (!it) return null;
      it.completed = completed; it.updatedAt = new Date().toISOString();
      return it;
    },
    async deleteChecklistItem(taskId, itemId) {
      const i = items.findIndex(x => x.id === itemId && x.taskId === taskId);
      if (i < 0) return null;
      return items.splice(i, 1)[0];
    },
    _seed(taskId, labels) { for (const l of labels) { const sortOrder = items.filter(i => i.taskId === taskId).length; items.push({ id: nextId(), taskId, label: l, completed: false, sortOrder, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); } },
  };
}

const checklistRepository = createMemoryChecklistRepository();

// Seed checklist items onto the "Back up CNPG" task so the demo detail panel
// shows a populated checklist out of the box.
const backupCnpgTask = sharedTasks.find(t => t.title === 'Back up CNPG');
if (backupCnpgTask) {
  checklistRepository._seed(backupCnpgTask.id, ['Verify backup CR', 'Confirm object-store creds']);
}

const config = loadConfig({
  ...process.env,
  DATABASE_URL: '',
  HOST: process.env.HOST || '127.0.0.1',
  PORT: process.env.PORT || '3100',
});

const app = await buildApp({
  config,
  logger: true,
  skipDb: true,
  tasksRepository: createMemoryTasksRepository(sharedDocuments, checklistRepository),
  libraryRepository: createMemoryLibraryRepository(sharedDocuments),
  projectsRepository: createMemoryProjectsRepository(sharedProjects),
  checklistRepository,
  documentLinksRepository: createMemoryDocumentLinksRepository(sharedDocuments),
});

await app.listen({ host: config.host, port: config.port });
