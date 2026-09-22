-- Caller-identified creates (a task, a checklist item, or a document created
-- by ID without an operationId) record their intent here in the same
-- transaction as the insert. A retry is then judged by the receipt, not by the
-- row's current content: an identical retry after an edit replays the current
-- record, and one after permanent delete is refused instead of recreating it.
-- Receipts outlive the created row by design (no foreign key). Rows created
-- before this migration have no receipt and keep the content-matching replay.
-- Runtime metadata only; not part of portable export.
create table record_creation_receipts (
  record_kind text not null check (record_kind in ('task', 'checklist-item', 'document')),
  record_id text not null,
  intent_hash text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  primary key (record_kind, record_id)
);
