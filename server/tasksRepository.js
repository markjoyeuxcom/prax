const ALLOWED_CREATE_FIELDS = ['title', 'description', 'priority', 'status', 'context', 'dueDate', 'sortOrder'];
const UPDATE_COLUMN_MAP = {
  title: 'title',
  description: 'description',
  priority: 'priority',
  status: 'status',
  context: 'context',
  dueDate: 'due_date',
  sortOrder: 'sort_order',
};

export function normalizeTaskRow(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    context: row.context,
    dueDate: row.due_date,
    sortOrder: row.sort_order,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function buildCreateTask(task) {
  return {
    text: `
      insert into tasks (title, description, priority, status, context, due_date, sort_order)
      values ($1, $2, $3, $4, $5, $6, $7)
      returning *
    `,
    values: ALLOWED_CREATE_FIELDS.map(field => task[field] ?? null),
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
      set ${assignments.join(', ')}, updated_at = now()
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

  const rows = updates.map((_, index) => {
    const offset = index * 3;
    return `($${offset + 1}::uuid, $${offset + 2}::text, $${offset + 3}::integer)`;
  });

  return {
    text: `
      with updates(id, status, sort_order) as (
        values ${rows.join(', ')}
      )
      update tasks
      set status = updates.status, sort_order = updates.sort_order, updated_at = now()
      from updates
      where tasks.id = updates.id and archived_at is null
      returning tasks.*
    `,
    values: updates.flatMap(update => [update.id, update.status, update.sortOrder]),
  };
}

export function createTasksRepository(db) {
  return {
    async listTasks(filters = {}) {
      const clauses = [];
      const values = [];

      if (filters.context) {
        values.push(filters.context);
        clauses.push(`context = $${values.length}`);
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
        clauses.push(`(title ilike $${values.length} or description ilike $${values.length})`);
      }

      const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
      const result = await db.query(`
        select * from tasks
        ${where}
        order by context, status, sort_order, created_at
      `, values);
      return result.rows.map(normalizeTaskRow);
    },

    async createTask(task) {
      const result = await db.query(buildCreateTask(task).text, buildCreateTask(task).values);
      return normalizeTaskRow(result.rows[0]);
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
        set archived_at = now(), updated_at = now()
        where id = $1 and archived_at is null
        returning *
      `, [id]);
      return result.rows[0] ? normalizeTaskRow(result.rows[0]) : null;
    },
  };
}
