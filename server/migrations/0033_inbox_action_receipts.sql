-- Receipts outlive source deletion: retry never recreates a removed result.
create table inbox_action_receipts (
  operation_id text primary key,
  intent_hash text not null,
  item_kind text not null check (item_kind in ('task', 'document')),
  item_id text not null,
  action text not null,
  before_fields text not null,
  after_fingerprint text not null,
  created_records text not null default '[]',
  undone_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
