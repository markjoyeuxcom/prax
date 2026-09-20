import { createHash, randomUUID } from 'node:crypto';
import { normalizeTaskRow, buildUpdateTask, buildCreateTask, buildRecordActivity } from './tasksRepository.js';
import { normalizeDocumentRow, buildCreateDocument, buildArchiveDocument } from './libraryRepository.js';
import { normalizeProjectRow } from './projectsRepository.js';
import { planTaskRecurrenceTransition } from './recurrence.js';
import { classifyPlanChange } from './planning.js';
import { ageInDays, inboxSummary, isPendingInboxTask, isPendingInboxDocument, isWorkspaceReview } from '../public/js/inboxModel.js';

const TABLES = { task: 'tasks', document: 'markdown_documents' };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalize = (kind, row) => kind === 'task' ? normalizeTaskRow(row) : normalizeDocumentRow(row);
const run = (client, query) => client.query(query.text, query.values);
const fail = (status, reason, message) => { throw Object.assign(new Error(message), { status, reason }); };

export function inboxFingerprint(row) {
  // Embedding maintenance does not change what the person is reviewing.
  return hash(Object.fromEntries(Object.entries(row).filter(([key]) => !/^embed/.test(key)).sort(([a], [b]) => a.localeCompare(b))));
}

export function createInboxRepository(db) {
  async function read(client, kind, id) {
    const table = TABLES[kind];
    if (!Object.hasOwn(TABLES, kind)) fail(400, 'invalid-kind', 'Item kind is invalid.');
    return (await client.query(`select * from ${table} where id = $1`, [id])).rows[0] || null;
  }
  async function fingerprint(client, kind, row) {
    const queries = kind === 'task' ? [
      ['task_checklist_items', 'task_id = $1'], ['task_activity', 'task_id = $1'], ['task_documents', 'task_id = $1'],
    ] : [
      ['task_documents', 'document_id = $1'],
      ['document_links', 'source_document_id = $1 or target_document_id = $1'],
      ['document_external_refs', 'document_id = $1'], ['document_code_refs', 'document_id = $1'],
      ['runbook_runs', 'document_id = $1'],
    ];
    const related = [];
    for (const [table, where] of queries) {
      const rows = (await client.query(`select * from ${table} where ${where}`, [row.id])).rows;
      related.push(rows.map(value => JSON.stringify(value)).sort());
    }
    return hash([inboxFingerprint(row), related]);
  }
  async function transaction(work) {
    const client = await db.connect();
    try {
      await client.query('begin immediate');
      try { const result = await work(client); await client.query('commit'); return result; }
      catch (error) { await client.query('rollback').catch(() => {}); throw error; }
    } finally { client.release(); }
  }
  async function outcome(client, receipt, replayed = false) {
    const row = await read(client, receipt.item_kind, receipt.item_id);
    if (!row) fail(410, 'result-gone', 'This operation committed, but its source was deleted. It will not be recreated.');
    const created = [];
    for (const entry of JSON.parse(receipt.created_records)) {
      const item = await read(client, entry.kind, entry.id);
      created.push({ kind: entry.kind, id: entry.id, record: item ? normalize(entry.kind, item) : null });
    }
    return { committed: true, operationId: receipt.operation_id, action: receipt.action, replayed,
      undone: Boolean(receipt.undone_at), kind: receipt.item_kind, record: normalize(receipt.item_kind, row), created };
  }
  async function archive(client, kind, id) {
    if (kind === 'document') await run(client, buildArchiveDocument(id));
    else await client.query("update tasks set archived_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = $1", [id]);
  }
  async function activity(client, id, type, message, actor) { await run(client, buildRecordActivity(id, type, message, actor)); }

  return {
    async list({ view = 'pending', offset = 0, limit = 50 } = {}) {
      const client = await db.connect();
      try {
        const projects = (await client.query('select * from projects order by sort_order, name')).rows.map(normalizeProjectRow);
        const inbox = projects.find(p => p.slug === 'inbox');
        if (!inbox) fail(503, 'inbox-missing', 'Inbox is unavailable. Upgrade or restart Prax to restore it.');
        const tasks = (await client.query("select id, title, project_id, status, created_at, archived_at, substr(description,1,240) as description, substr(notes,1,240) as notes from tasks where project_id = $1 and archived_at is null and status <> 'completed'", [inbox.id])).rows.map(normalizeTaskRow);
        const documents = (await client.query("select id, title, project_id, status, document_type, tags, created_at, archived_at, substr(body,1,240) as body from markdown_documents where project_id = $1 and archived_at is null and status = 'active'", [inbox.id])).rows.map(normalizeDocumentRow);
        const items = view === 'reviews'
          ? documents.filter(isWorkspaceReview).map(record => ({ kind: 'document', record }))
          : [...tasks.filter(isPendingInboxTask).map(record => ({ kind: 'task', record })),
            ...documents.filter(isPendingInboxDocument).map(record => ({ kind: 'document', record }))];
        items.sort((a, b) => String(view === 'reviews' ? b.record.createdAt : a.record.createdAt)
          .localeCompare(String(view === 'reviews' ? a.record.createdAt : b.record.createdAt)) || a.record.id.localeCompare(b.record.id));
        const page = items.slice(offset, offset + limit).map(({ kind, record }) => ({ kind, id: record.id, title: record.title,
          preview: (kind === 'task' ? record.description || record.notes : record.body).slice(0, 240),
          createdAt: record.createdAt, ageDays: ageInDays(record.createdAt), documentType: record.documentType || null }));
        return { items: page, page: { offset, limit, returned: page.length, total: items.length,
          hasMore: offset + page.length < items.length, nextOffset: offset + page.length < items.length ? offset + page.length : null },
          summary: inboxSummary(tasks, documents, inbox.id), reviewCount: documents.filter(isWorkspaceReview).length,
          projects: projects.filter(p => p.slug !== 'inbox' && ['active', 'on-hold'].includes(p.status)), inboxId: inbox.id };
      } finally { client.release(); }
    },
    async get(kind, id) {
      const client = await db.connect();
      try {
        const row = await read(client, kind, id);
        if (!row) fail(404, 'item-missing', 'This item no longer exists.');
        const record = normalize(kind, row);
        if (kind === 'task') record.checklist = (await client.query('select label, completed from task_checklist_items where task_id = $1 order by sort_order, id', [id])).rows;
        return { kind, id, record, fingerprint: await fingerprint(client, kind, row) };
      } finally { client.release(); }
    },
    async apply(kind, id, input, actor = 'user') {
      return transaction(async client => {
        const intent = hash({ kind, id, ...input, actor });
        const priorReceipt = (await client.query('select * from inbox_action_receipts where operation_id = $1', [input.operationId])).rows[0];
        if (priorReceipt) {
          if (priorReceipt.intent_hash !== intent) fail(409, 'intent-mismatch', 'This operation ID belongs to a different decision.');
          return outcome(client, priorReceipt, true);
        }
        const row = await read(client, kind, id);
        if (!row) fail(404, 'item-missing', 'This item no longer exists.');
        if (await fingerprint(client, kind, row) !== input.fingerprint) fail(409, 'item-changed', 'This item changed after you opened it. Reload it before deciding.');
        const inbox = (await client.query("select id from projects where slug = 'inbox'")).rows[0];
        const record = normalize(kind, row);
        if (row.project_id !== inbox?.id || !(kind === 'task' ? isPendingInboxTask(record) : isPendingInboxDocument(record))) {
          fail(409, 'not-pending', 'This item is no longer waiting in Inbox.');
        }
        let destination;
        if (['file', 'reference'].includes(input.action)) {
          destination = (await client.query('select * from projects where id = $1', [input.projectId])).rows[0];
          if (!destination || destination.slug === 'inbox' || !['active', 'on-hold'].includes(destination.status)) fail(400, 'destination-invalid', 'Choose an active owning project outside Inbox.');
        }
        const before = {}, generated = [];
        if (input.action === 'archive' || (kind === 'task' && input.action === 'reference')) {
          before.archived_at = row.archived_at;
          await archive(client, kind, id);
        }
        if (kind === 'task') {
          if (input.action === 'file' || input.action === 'complete') {
            const fields = input.action === 'file' ? { projectId: destination.id } : { status: 'completed' };
            if (input.plannedFor) fields.plannedFor = input.plannedFor;
            const planning = classifyPlanChange(record, fields);
            if (planning.kind === 'carried') fields.carryCount = record.carryCount + 1;
            const transition = planTaskRecurrenceTransition(record, fields);
            for (const [key, column] of [['projectId', 'project_id'], ['status', 'status'], ['plannedFor', 'planned_for'], ['carryCount', 'carry_count'], ['recurrence', 'recurrence']]) {
              if (key in transition.fields) before[column] = row[column];
            }
            await run(client, buildUpdateTask(id, transition.fields));
            if (planning.kind !== 'none') await activity(client, id, planning.kind, planning.message, actor);
            if (input.action === 'complete') await activity(client, id, 'status', 'Status → completed', actor);
            if (transition.nextTask) {
              const created = (await run(client, buildCreateTask({ ...transition.nextTask, id: randomUUID() }))).rows[0];
              generated.push({ kind: 'task', id: created.id });
              await activity(client, created.id, 'created', 'Recurring successor created', actor);
            }
          } else if (input.action === 'reference') {
            const checks = (await client.query('select label, completed from task_checklist_items where task_id = $1 order by sort_order, id', [id])).rows;
            const body = [record.description, record.notes, checks.length ? '## Checklist\n\n' + checks.map(c => `- [${c.completed ? 'x' : ' '}] ${c.label}`).join('\n') : ''].filter(Boolean).join('\n\n') || record.title;
            const created = (await run(client, buildCreateDocument({ id: randomUUID(), title: record.title, body,
              projectId: destination.id, documentType: 'reference', tags: record.labels,
              updatedBy: 'agent', updatedByAgent: 'prax', kind: 'synthesized', verified: false }))).rows[0];
            await client.query('insert into task_documents (task_id, document_id) values ($1, $2)', [id, created.id]);
            generated.push({ kind: 'document', id: created.id });
          }
          await activity(client, id, 'inbox-triaged', `Inbox → ${input.action}${destination ? ` in ${destination.name}` : ''}`, actor);
        } else if (input.action !== 'archive') {
          before.project_id = row.project_id;
          before.document_type = row.document_type;
          // Metadata-only filing preserves content authorship and verification.
          await client.query("update markdown_documents set project_id = $2, document_type = $3, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = $1",
            [id, destination.id, input.action === 'reference' ? 'reference' : input.documentType || row.document_type]);
        }
        for (const created of generated) created.fingerprint = await fingerprint(client, created.kind, await read(client, created.kind, created.id));
        const receipt = { operation_id: input.operationId, intent_hash: intent, item_kind: kind, item_id: id,
          action: input.action, before_fields: JSON.stringify(before), after_fingerprint: await fingerprint(client, kind, await read(client, kind, id)),
          created_records: JSON.stringify(generated), undone_at: null };
        await client.query('insert into inbox_action_receipts (operation_id, intent_hash, item_kind, item_id, action, before_fields, after_fingerprint, created_records) values ($1,$2,$3,$4,$5,$6,$7,$8)',
          [receipt.operation_id, receipt.intent_hash, kind, id, input.action, receipt.before_fields, receipt.after_fingerprint, receipt.created_records]);
        return outcome(client, receipt);
      });
    },
    async undo(operationId, actor = 'user') {
      return transaction(async client => {
        const receipt = (await client.query('select * from inbox_action_receipts where operation_id = $1', [operationId])).rows[0];
        if (!receipt) fail(404, 'operation-missing', 'No committed Inbox action has this ID.');
        if (receipt.undone_at) return outcome(client, receipt, true);
        const row = await read(client, receipt.item_kind, receipt.item_id);
        if (!row || await fingerprint(client, receipt.item_kind, row) !== receipt.after_fingerprint) fail(409, 'undo-conflict', 'This item was changed or removed after processing. Undo would overwrite newer work.');
        const created = JSON.parse(receipt.created_records);
        for (const entry of created) {
          const item = await read(client, entry.kind, entry.id);
          if (!item || await fingerprint(client, entry.kind, item) !== entry.fingerprint) fail(409, 'undo-conflict', 'A generated reference or recurring task changed. Review it before undoing.');
        }
        for (const entry of created) await archive(client, entry.kind, entry.id);
        const before = Object.entries(JSON.parse(receipt.before_fields));
        await client.query(`update ${TABLES[receipt.item_kind]} set ${before.map(([column], index) => `${column} = $${index + 2}`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = $1`, [receipt.item_id, ...before.map(([, value]) => value)]);
        if (receipt.item_kind === 'task') await activity(client, receipt.item_id, 'inbox-undo', 'Inbox decision undone; generated records retained in Archive', actor);
        await client.query("update inbox_action_receipts set undone_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where operation_id = $1", [operationId]);
        return outcome(client, { ...receipt, undone_at: 'now' });
      });
    },
  };
}
