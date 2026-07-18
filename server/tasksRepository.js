import { toIso } from './columnTypes.js';

const ALLOWED_CREATE_FIELDS = ['title', 'description', 'priority', 'status', 'projectId', 'dueDate', 'dueTime', 'sortOrder', 'notes', 'recurrence', 'labels'];
const CREATE_COLUMN_MAP = {
  title: 'title',
  description: 'description',
  priority: 'priority',
  status: 'status',
  projectId: 'project_id',
  dueDate: 'due_date',
  dueTime: 'due_time',
  sortOrder: 'sort_order',
  notes: 'notes',
  recurrence: 'recurrence',
  labels: 'labels',
};
const IMPORT_FIELDS = [
  'title', 'description', 'notes', 'priority', 'status', 'projectId',
  'dueDate', 'dueTime', 'deferredUntil', 'recurrence', 'labels',
  'sortOrder', 'archivedAt',
];
const IMPORT_COLUMNS = [
  'title', 'description', 'notes', 'priority', 'status', 'project_id',
  'due_date', 'due_time', 'deferred_until', 'recurrence', 'labels',
  'sort_order', 'archived_at',
];
const UPDATE_COLUMN_MAP = {
  title: 'title',
  description: 'description',
  priority: 'priority',
  status: 'status',
  projectId: 'project_id',
  dueDate: 'due_date',
  dueTime: 'due_time',
  deferredUntil: 'deferred_until',
  recurrence: 'recurrence',
  labels: 'labels',
  sortOrder: 'sort_order',
  notes: 'notes',
};

// Labels are a JSON text array (like markdown_documents.tags). Local copies of
// the library's helpers — the codebase already duplicates these small pure
// functions rather than coupling the task and document repositories.
function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || value === '') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serializeLabels(labels) {
  return JSON.stringify(Array.isArray(labels) ? labels : []);
}

function taskImportDuplicateKey(task) {
  return [
    String(task?.title || '').trim().toLowerCase(),
    String(task?.projectId || '').trim().toLowerCase(),
    String(task?.status || 'planned').trim().toLowerCase(),
    String(task?.dueDate || '').trim(),
  ].join('\u001f');
}

// Skip-mode compares incoming tasks against what the TARGET already has —
// never against each other. The key is deliberately lossy (title/project/
// status/dueDate), so two legitimately distinct tasks in one export (same
// title+date, different notes/labels) can share it; deduping within the
// batch silently dropped one of them on restore into an empty project.
function filterTaskImportDuplicates(importedTasks, existingTasks) {
  const keys = new Set(existingTasks.map(taskImportDuplicateKey));
  return importedTasks.reduce((result, task) => {
    if (keys.has(taskImportDuplicateKey(task))) {
      result.skipped += 1;
    } else {
      result.tasks.push(task);
    }
    return result;
  }, { tasks: [], skipped: 0 });
}

// SQLite stores due_date as TEXT 'YYYY-MM-DD', which passes through unchanged.
// Date objects are still normalised defensively (the pg era returned DATE
// columns as JS Date objects, and callers may still hand one in).
function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export function normalizeTaskRow(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    notes: row.notes,
    priority: row.priority,
    status: row.status,
    projectId: row.project_id,
    dueDate: toDateOnly(row.due_date),
    dueTime: row.due_time ?? null,
    deferredUntil: toIso(row.deferred_until) ?? null,
    recurrence: row.recurrence ?? null,
    labels: parseJsonArray(row.labels),
    sortOrder: row.sort_order,
    archivedAt: toIso(row.archived_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function buildCreateTask(task, { ignoreIdConflict = false } = {}) {
  const fields = task.id ? ['id', ...ALLOWED_CREATE_FIELDS] : ALLOWED_CREATE_FIELDS;
  const columns = fields.map(field => (field === 'id' ? 'id' : CREATE_COLUMN_MAP[field]));
  return {
    text: `
      insert into tasks (${columns.join(', ')})
      values (${fields.map((_, index) => `$${index + 1}`).join(', ')})
      ${ignoreIdConflict ? 'on conflict(id) do nothing' : ''}
      returning *
    `,
    values: fields.map(field =>
      field === 'labels' ? serializeLabels(task.labels) : (task[field] ?? null),
    ),
  };
}

export function taskMatchesCreateFields(task, fields) {
  if (!task || !fields) return false;
  const labels = Array.isArray(fields.labels) ? fields.labels : [];
  return (!fields.id || task.id === fields.id)
    && task.title === fields.title
    && (task.description || '') === (fields.description || '')
    && (task.notes || '') === (fields.notes || '')
    && task.priority === fields.priority
    && task.status === fields.status
    && task.projectId === fields.projectId
    && (task.dueDate || null) === (fields.dueDate || null)
    && (task.dueTime || null) === (fields.dueTime || null)
    && (task.recurrence || null) === (fields.recurrence || null)
    && Array.isArray(task.labels)
    && task.labels.length === labels.length
    && task.labels.every((label, index) => label === labels[index])
    && task.sortOrder === fields.sortOrder;
}

export function buildImportTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error('No task import records provided');
  }

  const rows = tasks.map((_, rowIndex) => {
    const offset = rowIndex * IMPORT_FIELDS.length;
    return `(${IMPORT_FIELDS.map((_, fieldIndex) => `$${offset + fieldIndex + 1}`).join(', ')})`;
  });

  return {
    text: `
      insert into tasks (${IMPORT_COLUMNS.join(', ')})
      values ${rows.join(', ')}
      returning *
    `,
    values: tasks.flatMap(task => IMPORT_FIELDS.map(field => (
      field === 'labels' ? serializeLabels(task.labels) : (task[field] ?? null)
    ))),
  };
}

export function buildImportChecklistItem(taskId, item, sortOrder) {
  return {
    text: `
      insert into task_checklist_items (task_id, label, completed, sort_order)
      values ($1, $2, $3, $4)
      returning *
    `,
    values: [taskId, item.label, Boolean(item.completed), sortOrder],
  };
}

async function importTaskRecords(client, tasks, { replaceProjectId = null } = {}) {
  if (replaceProjectId) {
    await client.query('delete from tasks where project_id = $1', [replaceProjectId]);
  }
  const imported = [];
  for (const candidate of tasks) {
    const task = replaceProjectId
      ? { ...candidate, projectId: replaceProjectId }
      : candidate;
    const taskQuery = buildImportTasks([task]);
    const taskResult = await client.query(taskQuery.text, taskQuery.values);
    const row = taskResult.rows[0];
    if (!row) throw new Error('Task import did not return a row');
    for (let index = 0; index < (candidate.checklist || []).length; index += 1) {
      const checklistQuery = buildImportChecklistItem(row.id, candidate.checklist[index], index);
      await client.query(checklistQuery.text, checklistQuery.values);
    }
    imported.push(normalizeTaskRow(row));
  }
  return imported;
}

// Fields written per imported row, excluding project_id — a replace import
// always belongs to the target project ($1), so we never trust the row's own
// projectId (a row missing it must not land in some default project).
const REPLACE_FIELDS = IMPORT_FIELDS.filter(field => field !== 'projectId');

export function buildReplaceProjectTasks(projectId, tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error('No task import records provided');
  }

  const rows = tasks.map((_, rowIndex) => {
    let next = 2 + (rowIndex * REPLACE_FIELDS.length);
    return `(${IMPORT_FIELDS.map((field) => (field === 'projectId' ? '$1' : `$${next++}`)).join(', ')})`;
  });

  // SQLite has no data-modifying CTEs (the pg version deleted inside a WITH),
  // so replace is two statements run inside one transaction — see
  // replaceProjectTasks below.
  return {
    delete: {
      text: `delete from tasks where project_id = $1`,
      values: [projectId],
    },
    insert: {
      text: `
        insert into tasks (${IMPORT_COLUMNS.join(', ')})
        values ${rows.join(', ')}
        returning *
      `,
      values: [projectId, ...tasks.flatMap(task => REPLACE_FIELDS.map(field => (
        field === 'labels' ? serializeLabels(task.labels) : (task[field] ?? null)
      )))],
    },
  };
}

export function buildUpdateTask(id, fields) {
  const entries = Object.entries(fields).filter(([key]) => UPDATE_COLUMN_MAP[key]);
  if (entries.length === 0) {
    throw new Error('No task fields provided');
  }

  const assignments = entries.map(([key], index) => `${UPDATE_COLUMN_MAP[key]} = $${index + 2}`);
  return {
    text: `
      update tasks
      set ${assignments.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      where id = $1 and archived_at is null
      returning *
    `,
    values: [id, ...entries.map(([key, value]) => (key === 'labels' ? serializeLabels(value) : value))],
  };
}

export function buildReorderTasks(updates) {
  if (!Array.isArray(updates) || updates.length === 0) {
    throw new Error('No task reorder updates provided');
  }

  // One set-based UPDATE ... FROM (SQLite 3.33+) over the updates decoded from
  // a single JSON array parameter (the pg version used a VALUES CTE).
  return {
    text: `
      with updates(id, status, sort_order) as (
        select
          json_extract(value, '$.id'),
          json_extract(value, '$.status'),
          json_extract(value, '$.sortOrder')
        from json_each($1)
      )
      update tasks
      set status = updates.status, sort_order = updates.sort_order, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      from updates
      where tasks.id = updates.id and archived_at is null
      returning *
    `,
    values: [JSON.stringify(updates.map(({ id, status, sortOrder }) => ({ id, status, sortOrder })))],
  };
}

export function buildRestoreTask(id) {
  return {
    text: `
      update tasks
      set archived_at = null, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      where id = $1 and archived_at is not null
      returning *
    `,
    values: [id],
  };
}

export function buildDeleteArchivedTask(id) {
  return {
    text: `
      delete from tasks
      where id = $1 and archived_at is not null
      returning *
    `,
    values: [id],
  };
}

export function buildListTaskDocuments(taskId) {
  return {
    text: `
      select d.id, d.title, d.document_type, d.project_id
      from task_documents td
      join markdown_documents d on d.id = td.document_id
      where td.task_id = $1 and d.archived_at is null
      order by d.title
    `,
    values: [taskId],
  };
}

// The inverse of buildListTaskDocuments: the non-archived tasks that link a
// given document. Powers the editor's "Referenced by N tasks" backlinks.
export function buildListTasksForDocument(documentId) {
  return {
    text: `
      select t.id, t.title, t.priority, t.project_id
      from task_documents td
      join tasks t on t.id = td.task_id
      where td.document_id = $1 and t.archived_at is null
      order by t.title
    `,
    values: [documentId],
  };
}

export function buildLinkTaskDocument(taskId, documentId) {
  return {
    text: `
      insert into task_documents (task_id, document_id)
      select $1, $2
      where exists (select 1 from tasks where id = $1 and archived_at is null)
        and exists (select 1 from markdown_documents where id = $2 and archived_at is null)
      on conflict (task_id, document_id) do nothing
      returning task_id, document_id
    `,
    values: [taskId, documentId],
  };
}

export function buildUnlinkTaskDocument(taskId, documentId) {
  return {
    text: `
      delete from task_documents where task_id = $1 and document_id = $2 returning task_id, document_id
    `,
    values: [taskId, documentId],
  };
}

export function buildLinkExists(taskId, documentId) {
  return {
    text: `
      select 1
      from task_documents td
      join tasks t on t.id = td.task_id and t.archived_at is null
      join markdown_documents d on d.id = td.document_id and d.archived_at is null
      where td.task_id = $1 and td.document_id = $2
    `,
    values: [taskId, documentId],
  };
}

export function normalizeActivityRow(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    eventType: row.event_type,
    message: row.message,
    actor: row.actor || 'user',
    createdAt: toIso(row.created_at),
  };
}

export function buildRecordActivity(taskId, eventType, message, actor = 'user') {
  return {
    text: `insert into task_activity (task_id, event_type, message, actor) values ($1, $2, $3, $4) returning *`,
    values: [taskId, eventType, message, actor === 'agent' ? 'agent' : 'user'],
  };
}

export function buildListTaskActivity(taskId) {
  return {
    text: `select * from task_activity where task_id = $1 order by created_at desc, id desc`,
    values: [taskId],
  };
}

export function buildListTaskBoardExtras(taskIds) {
  // The requested ids arrive as one JSON array parameter; json_each's key is
  // the 0-based ordinal (replaces unnest ... with ordinality / = any(...)).
  return {
    text: `
      with requested(position, task_id) as (
        select key, value from json_each($1)
      ),
      docs as (
        select td.task_id, count(*) as docs_count
        from task_documents td
        join markdown_documents d on d.id = td.document_id and d.archived_at is null
        where td.task_id in (select value from json_each($1))
        group by td.task_id
      ),
      checklist as (
        select
          c.task_id,
          count(*) filter (where c.completed = 1) as checklist_done,
          count(*) as checklist_total,
          (
            select c2.label
            from task_checklist_items c2
            where c2.task_id = c.task_id and c2.completed = 0
            order by c2.sort_order, c2.created_at
            limit 1
          ) as next_checklist_item
        from task_checklist_items c
        where c.task_id in (select value from json_each($1))
        group by c.task_id
      ),
      activity as (
        select task_id, message as latest_activity
        from (
          select
            task_id,
            message,
            row_number() over (partition by task_id order by created_at desc, id desc) as rn
          from task_activity
          where task_id in (select value from json_each($1))
        )
        where rn = 1
      )
      select
        requested.task_id,
        coalesce(docs.docs_count, 0) as docs_count,
        coalesce(checklist.checklist_done, 0) as checklist_done,
        coalesce(checklist.checklist_total, 0) as checklist_total,
        coalesce(checklist.next_checklist_item, '') as next_checklist_item,
        coalesce(activity.latest_activity, '') as latest_activity
      from requested
      left join docs on docs.task_id = requested.task_id
      left join checklist on checklist.task_id = requested.task_id
      left join activity on activity.task_id = requested.task_id
      order by requested.position
    `,
    values: [JSON.stringify(taskIds)],
  };
}

export function normalizeTaskBoardExtraRow(row) {
  return {
    taskId: row.task_id,
    docsCount: Number(row.docs_count || 0),
    checklistDone: Number(row.checklist_done || 0),
    checklistTotal: Number(row.checklist_total || 0),
    nextChecklistItem: row.next_checklist_item || '',
    latestActivity: row.latest_activity || '',
  };
}

export function buildGetTask(id) {
  return { text: `select * from tasks where id = $1 limit 1`, values: [id] };
}

export function createTasksRepository(db) {
  return {
    async listTasks(filters = {}) {
      const clauses = [];
      const values = [];

      if (filters.projectId) {
        values.push(filters.projectId);
        clauses.push(`project_id = $${values.length}`);
      }
      if (filters.status) {
        values.push(filters.status);
        clauses.push(`status = $${values.length}`);
      }
      if (filters.archived === true || filters.archived === 'true') {
        clauses.push('archived_at is not null');
      } else if (filters.archived !== 'all') {
        clauses.push('archived_at is null');
      }
      if (filters.q) {
        values.push(`%${filters.q}%`);
        // SQLite LIKE is only case-insensitive for ASCII; lower() both sides
        // to keep the pg ILIKE behaviour.
        clauses.push(`(lower(title) like lower($${values.length}) or lower(description) like lower($${values.length}))`);
      }

      const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
      const result = await db.query(`
        select * from tasks
        ${where}
        order by project_id, status, sort_order, created_at
      `, values);
      return result.rows.map(normalizeTaskRow);
    },

    async createTask(task) {
      const query = buildCreateTask(task);
      const result = await db.query(query.text, query.values);
      return normalizeTaskRow(result.rows[0]);
    },

    // A caller-supplied UUID is also the creation retry identity. The first
    // insert wins; an exact replay reads the existing row instead of adding a
    // second task. The route checks that the existing content still matches.
    async createTaskIdempotent(task) {
      if (!task?.id) throw new Error('Idempotent task creation requires an id');
      const createQuery = buildCreateTask(task, { ignoreIdConflict: true });
      const created = await db.query(createQuery.text, createQuery.values);
      if (created.rows[0]) return { task: normalizeTaskRow(created.rows[0]), created: true };
      const getQuery = buildGetTask(task.id);
      const existing = await db.query(getQuery.text, getQuery.values);
      return {
        task: existing.rows[0] ? normalizeTaskRow(existing.rows[0]) : null,
        created: false,
      };
    },

    async importTasks(tasks) {
      const query = buildImportTasks(tasks);
      const result = await db.query(query.text, query.values);
      return result.rows.map(normalizeTaskRow);
    },

    // The portable format treats each task and its checklist as one record.
    // Insert rows one at a time inside a single transaction so checklist
    // association never depends on RETURNING order from a batch statement.
    async importTasksWithChecklists(tasks, { replaceProjectId = null } = {}) {
      if (!Array.isArray(tasks) || tasks.length === 0) {
        throw new Error('No task import records provided');
      }
      const client = await db.connect();
      try {
        await client.query('begin immediate');
        try {
          const imported = await importTaskRecords(client, tasks, { replaceProjectId });
          await client.query('commit');
          return imported;
        } catch (err) {
          await client.query('rollback').catch(() => {});
          throw err;
        }
      } finally {
        client.release();
      }
    },

    // `requestId` identifies the whole normalized import intent, not an
    // individual generated task. The operation row and every task/checklist
    // mutation share one transaction, making a lost-response retry exact-once.
    async importTasksExactlyOnce(tasks, {
      requestId,
      payloadHash,
      mode,
      projectId,
      replaceProjectId = null,
    } = {}) {
      if (!requestId || !payloadHash || !mode || !projectId) {
        throw new Error('Exact-once task import requires operation metadata');
      }
      if (!Array.isArray(tasks)) throw new Error('Task import records are invalid');
      const client = await db.connect();
      try {
        await client.query('begin immediate');
        try {
          const existing = await client.query(
            'select payload_hash, result_json from task_import_operations where id = $1 limit 1',
            [requestId],
          );
          if (existing.rows[0]) {
            await client.query('commit');
            if (existing.rows[0].payload_hash !== payloadHash) return { conflict: true };
            return { ...JSON.parse(existing.rows[0].result_json), replayed: true };
          }

          let candidates = tasks;
          let skipped = 0;
          if (mode === 'skip') {
            const existingRows = await client.query(
              'select * from tasks where project_id = $1',
              [projectId],
            );
            const filtered = filterTaskImportDuplicates(
              tasks,
              existingRows.rows.map(normalizeTaskRow),
            );
            candidates = filtered.tasks;
            skipped = filtered.skipped;
          }
          const imported = await importTaskRecords(client, candidates, { replaceProjectId });
          const result = {
            mode,
            imported: imported.length,
            skipped,
            tasks: imported,
          };
          await client.query(`
            insert into task_import_operations (id, project_id, mode, payload_hash, result_json)
            values ($1, $2, $3, $4, $5)
          `, [requestId, projectId, mode, payloadHash, JSON.stringify(result)]);
          await client.query('commit');
          return { ...result, replayed: false };
        } catch (err) {
          await client.query('rollback').catch(() => {});
          throw err;
        }
      } finally {
        client.release();
      }
    },

    async replaceProjectTasks(projectId, tasks) {
      const query = buildReplaceProjectTasks(projectId, tasks);
      // Delete + insert must land together; run both on one session inside a
      // transaction (SQLite cannot express the pg writable-CTE single statement).
      const client = await db.connect();
      try {
        await client.query('begin immediate');
        try {
          await client.query(query.delete.text, query.delete.values);
          const result = await client.query(query.insert.text, query.insert.values);
          await client.query('commit');
          return result.rows.map(normalizeTaskRow);
        } catch (err) {
          await client.query('rollback').catch(() => {});
          throw err;
        }
      } finally {
        client.release();
      }
    },

    async updateTask(id, fields) {
      const query = buildUpdateTask(id, fields);
      const result = await db.query(query.text, query.values);
      return result.rows[0] ? normalizeTaskRow(result.rows[0]) : null;
    },

    // Task completion plus recurring-successor creation is one authoritative
    // lifecycle transition. The planner is pure; every resulting write lands
    // on this one session or the whole transition rolls back.
    async updateTaskLifecycle(id, fields, planner) {
      const client = await db.connect();
      try {
        await client.query('begin immediate');
        try {
          const priorQuery = buildGetTask(id);
          const priorResult = await client.query(priorQuery.text, priorQuery.values);
          const prior = priorResult.rows[0] ? normalizeTaskRow(priorResult.rows[0]) : null;
          if (!prior || prior.archivedAt) {
            await client.query('commit');
            return { task: null, prior, nextTask: null, transition: null };
          }
          const transition = planner(prior, fields);
          const updateQuery = buildUpdateTask(id, transition.fields);
          const updateResult = await client.query(updateQuery.text, updateQuery.values);
          const task = updateResult.rows[0] ? normalizeTaskRow(updateResult.rows[0]) : null;
          let nextTask = null;
          if (task && transition.nextTask) {
            const createQuery = buildCreateTask(transition.nextTask);
            const createResult = await client.query(createQuery.text, createQuery.values);
            if (!createResult.rows[0]) throw new Error('Recurring successor creation returned no task');
            nextTask = normalizeTaskRow(createResult.rows[0]);
          }
          await client.query('commit');
          return { task, prior, nextTask, transition };
        } catch (err) {
          await client.query('rollback').catch(() => {});
          throw err;
        }
      } finally {
        client.release();
      }
    },

    async reorderTasks(updates) {
      const query = buildReorderTasks(updates);
      const result = await db.query(query.text, query.values);
      return result.rows.map(normalizeTaskRow);
    },

    // A board move can also cross the completion boundary. Apply all moved
    // tasks and any recurring successors in one transaction so a failed clone
    // cannot leave a partially moved board.
    async reorderTasksWithLifecycle(updates, planner) {
      if (!Array.isArray(updates) || updates.length === 0) {
        throw new Error('No task reorder updates provided');
      }
      const client = await db.connect();
      try {
        await client.query('begin immediate');
        try {
          const results = [];
          for (const update of updates) {
            const priorQuery = buildGetTask(update.id);
            const priorResult = await client.query(priorQuery.text, priorQuery.values);
            const prior = priorResult.rows[0] ? normalizeTaskRow(priorResult.rows[0]) : null;
            if (!prior || prior.archivedAt) continue;
            const transition = planner(prior, {
              status: update.status,
              sortOrder: update.sortOrder,
            });
            const updateQuery = buildUpdateTask(update.id, transition.fields);
            const updateResult = await client.query(updateQuery.text, updateQuery.values);
            const task = updateResult.rows[0] ? normalizeTaskRow(updateResult.rows[0]) : null;
            let nextTask = null;
            if (task && transition.nextTask) {
              const createQuery = buildCreateTask(transition.nextTask);
              const createResult = await client.query(createQuery.text, createQuery.values);
              if (!createResult.rows[0]) throw new Error('Recurring successor creation returned no task');
              nextTask = normalizeTaskRow(createResult.rows[0]);
            }
            if (task) results.push({ task, prior, nextTask, transition });
          }
          await client.query('commit');
          return results;
        } catch (err) {
          await client.query('rollback').catch(() => {});
          throw err;
        }
      } finally {
        client.release();
      }
    },

    async archiveTask(id) {
      const result = await db.query(`
        update tasks
        set archived_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        where id = $1 and archived_at is null
        returning *
      `, [id]);
      return result.rows[0] ? normalizeTaskRow(result.rows[0]) : null;
    },

    async restoreTask(id) {
      const query = buildRestoreTask(id);
      const result = await db.query(query.text, query.values);
      return result.rows[0] ? normalizeTaskRow(result.rows[0]) : null;
    },

    async deleteArchivedTask(id) {
      const query = buildDeleteArchivedTask(id);
      const result = await db.query(query.text, query.values);
      return result.rows[0] ? normalizeTaskRow(result.rows[0]) : null;
    },

    async listTaskDocuments(taskId) {
      const query = buildListTaskDocuments(taskId);
      const result = await db.query(query.text, query.values);
      return result.rows.map(row => ({
        id: row.id,
        title: row.title,
        documentType: row.document_type,
        projectId: row.project_id,
      }));
    },

    async listTasksForDocument(documentId) {
      const query = buildListTasksForDocument(documentId);
      const result = await db.query(query.text, query.values);
      return result.rows.map(row => ({
        id: row.id,
        title: row.title,
        priority: row.priority,
        projectId: row.project_id,
      }));
    },

    async linkTaskDocument(taskId, documentId) {
      const query = buildLinkTaskDocument(taskId, documentId);
      const result = await db.query(query.text, query.values);
      if (result.rows.length > 0) {
        return { linked: true };
      }
      const existsQuery = buildLinkExists(taskId, documentId);
      const existsResult = await db.query(existsQuery.text, existsQuery.values);
      if (existsResult.rows.length > 0) {
        return { linked: true, alreadyLinked: true };
      }
      return { linked: false };
    },

    async unlinkTaskDocument(taskId, documentId) {
      const query = buildUnlinkTaskDocument(taskId, documentId);
      const result = await db.query(query.text, query.values);
      return result.rows.length > 0;
    },

    async getTask(id) {
      const q = buildGetTask(id);
      const result = await db.query(q.text, q.values);
      return result.rows[0] ? normalizeTaskRow(result.rows[0]) : null;
    },

    async recordActivity(taskId, eventType, message, actor = 'user') {
      const q = buildRecordActivity(taskId, eventType, message, actor);
      const result = await db.query(q.text, q.values);
      return normalizeActivityRow(result.rows[0]);
    },

    async listTaskActivity(taskId) {
      const q = buildListTaskActivity(taskId);
      const result = await db.query(q.text, q.values);
      return result.rows.map(normalizeActivityRow);
    },

    async listTaskBoardExtras(taskIds) {
      if (!Array.isArray(taskIds) || taskIds.length === 0) return [];
      const q = buildListTaskBoardExtras(taskIds);
      const result = await db.query(q.text, q.values);
      return result.rows.map(normalizeTaskBoardExtraRow);
    },
  };
}
