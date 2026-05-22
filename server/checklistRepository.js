export function normalizeChecklistRow(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    label: row.label,
    completed: row.completed,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function buildListChecklist(taskId) {
  return {
    text: `select * from task_checklist_items where task_id = $1 order by sort_order, created_at`,
    values: [taskId],
  };
}

export function buildAddChecklistItem(taskId, label) {
  // sort_order is derived from the current max within a single INSERT. This is
  // not serialized, so two concurrent adds for the same task could collide on
  // sort_order — acceptable for this single-user console where list/order is a
  // best-effort display concern, not a uniqueness constraint.
  return {
    text: `
      insert into task_checklist_items (task_id, label, sort_order)
      values ($1, $2, (select coalesce(max(sort_order), -1) + 1 from task_checklist_items where task_id = $1))
      returning *
    `,
    values: [taskId, label],
  };
}

export function buildSetChecklistItemCompleted(taskId, itemId, completed) {
  return {
    text: `update task_checklist_items set completed = $3, updated_at = now() where id = $2 and task_id = $1 returning *`,
    values: [taskId, itemId, completed],
  };
}

export function buildDeleteChecklistItem(taskId, itemId) {
  return {
    text: `delete from task_checklist_items where id = $2 and task_id = $1 returning *`,
    values: [taskId, itemId],
  };
}

export function createChecklistRepository(db) {
  return {
    async listChecklist(taskId) {
      const q = buildListChecklist(taskId);
      const result = await db.query(q.text, q.values);
      return result.rows.map(normalizeChecklistRow);
    },
    async addChecklistItem(taskId, label) {
      const q = buildAddChecklistItem(taskId, label);
      const result = await db.query(q.text, q.values);
      return normalizeChecklistRow(result.rows[0]);
    },
    async setChecklistItemCompleted(taskId, itemId, completed) {
      const q = buildSetChecklistItemCompleted(taskId, itemId, completed);
      const result = await db.query(q.text, q.values);
      return result.rows[0] ? normalizeChecklistRow(result.rows[0]) : null;
    },
    async deleteChecklistItem(taskId, itemId) {
      const q = buildDeleteChecklistItem(taskId, itemId);
      const result = await db.query(q.text, q.values);
      return result.rows[0] ? normalizeChecklistRow(result.rows[0]) : null;
    },
  };
}
