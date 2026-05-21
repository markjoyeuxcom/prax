import { randomUUID } from 'node:crypto';
import { loadConfig } from '../server/config.js';
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
  return {
    id: randomUUID(),
    title: seed.title,
    body: seed.body || '',
    documentType: seed.documentType || 'note',
    projectId: seed.projectId || PROJECT_ID_HOMELAB,
    tags: seed.tags || [],
    sourceFilename: seed.sourceFilename || null,
    createdAt: seed.createdAt || now,
    updatedAt: seed.updatedAt || now,
    archivedAt: seed.archivedAt || null,
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

function createMemoryTasksRepository(documentsRef) {
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
      documents.push(created);
      return created;
    },
    async updateDocument(id, fields) {
      const document = documents.find(item => item.id === id && !item.archivedAt);
      if (!document) return null;
      Object.assign(document, fields, { updatedAt: new Date().toISOString() });
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
    async setChecklistItemCompleted(itemId, completed) {
      const it = items.find(i => i.id === itemId);
      if (!it) return null;
      it.completed = completed; it.updatedAt = new Date().toISOString();
      return it;
    },
    async deleteChecklistItem(itemId) {
      const i = items.findIndex(x => x.id === itemId);
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
  tasksRepository: createMemoryTasksRepository(sharedDocuments),
  libraryRepository: createMemoryLibraryRepository(sharedDocuments),
  projectsRepository: createMemoryProjectsRepository(sharedProjects),
  checklistRepository,
});

await app.listen({ host: config.host, port: config.port });
