import { toIso } from './columnTypes.js';
import { createWithReceipt, creationIntentHash } from './creationReceipts.js';

// One bound, enforced at BOTH creation and import: whatever the app lets a
// task accumulate, the app must be able to restore. A creation-side cap that
// import does not honour (or vice versa) makes the app's own export
// unrestorable — the 2026-07-18 review confirmed exactly that with the old
// import-wide 500-item cumulative cap.
export const MAX_CHECKLIST_ITEMS_PER_TASK = 200;

export function normalizeChecklistRow(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    label: row.label,
    // SQLite stores booleans as 0/1; pg returned real booleans — normalize here.
    completed: Boolean(row.completed),
    sortOrder: row.sort_order,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
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

export function buildAddChecklistItemIdempotent(taskId, label, id) {
  return {
    text: `
      insert into task_checklist_items (id, task_id, label, sort_order)
      values ($1, $2, $3, (select coalesce(max(sort_order), -1) + 1 from task_checklist_items where task_id = $2))
      on conflict(id) do nothing
      returning *
    `,
    values: [id, taskId, label],
  };
}

export function buildGetChecklistItem(id) {
  return {
    text: 'select * from task_checklist_items where id = $1 limit 1',
    values: [id],
  };
}

export function buildSetChecklistItemCompleted(taskId, itemId, completed) {
  return {
    text: `update task_checklist_items set completed = $3, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = $2 and task_id = $1 returning *`,
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
    // Receipt-backed like task creation (see creationReceipts.js): the
    // outcome carries `replayed`, `gone` or `conflict`; `capped` means a new
    // item would exceed `maxItems`. A replay outranks the cap.
    async addChecklistItemIdempotent(taskId, label, id, { maxItems = null } = {}) {
      const result = await createWithReceipt(db, {
        kind: 'checklist-item',
        id,
        intentHash: creationIntentHash('checklist-item', id, [taskId, label]),
        async load(client) {
          const get = buildGetChecklistItem(id);
          return (await client.query(get.text, get.values)).rows[0] || null;
        },
        async beforeInsert(client) {
          if (maxItems === null) return null;
          const count = await client.query('select count(*) as n from task_checklist_items where task_id = $1', [taskId]);
          return Number(count.rows[0]?.n) >= maxItems ? { capped: true } : null;
        },
        async insert(client) {
          const q = buildAddChecklistItemIdempotent(taskId, label, id);
          return (await client.query(q.text, q.values)).rows[0] || null;
        },
      });
      if (result.refused) return { capped: true, created: false };
      const { row, ...outcome } = result;
      return row === undefined ? outcome : { ...outcome, item: row ? normalizeChecklistRow(row) : null };
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
