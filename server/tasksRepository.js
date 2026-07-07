import { toIso } from './columnTypes.js';

const ALLOWED_CREATE_FIELDS = ['title', 'description', 'priority', 'status', 'projectId', 'dueDate', 'sortOrder', 'notes'];
const IMPORT_FIELDS = ['title', 'description', 'priority', 'status', 'projectId', 'dueDate', 'sortOrder', 'archivedAt'];
const UPDATE_COLUMN_MAP = {
  title: 'title',
  description: 'description',
  priority: 'priority',
  status: 'status',
  projectId: 'project_id',
  dueDate: 'due_date',
  sortOrder: 'sort_order',
  notes: 'notes',
};

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
    sortOrder: row.sort_order,
    archivedAt: toIso(row.archived_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function buildCreateTask(task) {
  return {
    text: `
      insert into tasks (title, description, priority, status, project_id, due_date, sort_order, notes)
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      returning *
    `,
    values: ALLOWED_CREATE_FIELDS.map(field => task[field] ?? null),
  };
}

export function buildImportTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error('No task import records provided');
  }

  const rows = tasks.map((_, rowIndex) => {
    const offset = rowIndex * IMPORT_FIELDS.length;
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`;
  });

  return {
    text: `
      insert into tasks (title, description, priority, status, project_id, due_date, sort_order, archived_at)
      values ${rows.join(', ')}
      returning *
    `,
    values: tasks.flatMap(task => IMPORT_FIELDS.map(field => task[field] ?? null)),
  };
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
    const offset = 2 + (rowIndex * REPLACE_FIELDS.length);
    // Column order: title, description, priority, status, project_id, due_date, sort_order, archived_at.
    // project_id is fixed to $1 (the target project); the other 7 columns are per-row placeholders.
    return `($${offset}, $${offset + 1}, $${offset + 2}, $${offset + 3}, $1, $${offset + 4}, $${offset + 5}, $${offset + 6})`;
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
        insert into tasks (title, description, priority, status, project_id, due_date, sort_order, archived_at)
        values ${rows.join(', ')}
        returning *
      `,
      values: [projectId, ...tasks.flatMap(task => REPLACE_FIELDS.map(field => task[field] ?? null))],
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
    values: [id, ...entries.map(([, value]) => value)],
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
  return { id: row.id, taskId: row.task_id, eventType: row.event_type, message: row.message, createdAt: toIso(row.created_at) };
}

export function buildRecordActivity(taskId, eventType, message) {
  return {
    text: `insert into task_activity (task_id, event_type, message) values ($1, $2, $3) returning *`,
    values: [taskId, eventType, message],
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

    async importTasks(tasks) {
      const query = buildImportTasks(tasks);
      const result = await db.query(query.text, query.values);
      return result.rows.map(normalizeTaskRow);
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

    async reorderTasks(updates) {
      const query = buildReorderTasks(updates);
      const result = await db.query(query.text, query.values);
      return result.rows.map(normalizeTaskRow);
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

    async recordActivity(taskId, eventType, message) {
      const q = buildRecordActivity(taskId, eventType, message);
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
