import { randomUUID } from 'node:crypto';
import { loadConfig } from '../server/config.js';
import { buildApp } from '../server/index.js';

const now = new Date().toISOString();

function createTask(seed) {
  return {
    id: randomUUID(),
    title: seed.title,
    description: seed.description || '',
    priority: seed.priority || 'medium',
    status: seed.status || 'planned',
    context: seed.context || 'homelab',
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
    context: seed.context || 'homelab',
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

function createMemoryTasksRepository(documentsRef) {
  const links = [];
  const tasks = [
    createTask({
      title: 'Back up CNPG',
      description: 'Verify backup schedule',
      priority: 'high',
      status: 'planned',
      dueDate: '2026-05-18',
    }),
    createTask({
      title: 'Patch ingress',
      description: 'Review controller release notes',
      priority: 'medium',
      status: 'in-progress',
    }),
    createTask({
      title: 'Inventory UPS batteries',
      description: 'Backlog maintenance item',
      priority: 'low',
      status: 'planned',
      sortOrder: 1,
    }),
  ];

  return {
    async listTasks(filters = {}) {
      return tasks.filter((task) => {
        if (filters.context && task.context !== filters.context) return false;
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
    async replaceContextTasks(context, importedTasks) {
      for (let index = tasks.length - 1; index >= 0; index -= 1) {
        if (tasks[index].context === context) tasks.splice(index, 1);
      }
      return this.importTasks(importedTasks);
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

    async listTaskDocuments(taskId) {
      return links
        .filter(link => link.taskId === taskId)
        .map(link => documentsRef.find(doc => doc.id === link.documentId && !doc.archivedAt))
        .filter(Boolean)
        .map(doc => ({ id: doc.id, title: doc.title, documentType: doc.documentType, context: doc.context }))
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
    tags: ['postgres', 'backup'],
    sourceFilename: 'cloudnativepg-restore.md',
    body: '# CloudNativePG Restore\n\nSteps for testing restore flow.',
  }),
];

function createMemoryLibraryRepository(documents) {
  return {
    async listDocuments(filters = {}) {
      return documents.filter((document) => {
        if (filters.context && document.context !== filters.context) return false;
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
});

await app.listen({ host: config.host, port: config.port });
