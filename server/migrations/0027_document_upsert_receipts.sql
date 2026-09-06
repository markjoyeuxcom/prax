-- One receipt per caller-supplied upsert-by-title operation id. A replay of a
-- completed "remember" must return the document that operation produced
-- without re-applying its body over a newer accepted write (QINV-03), and the
-- same id sent with different content is a conflict, never a second update.
-- The receipt outlives the document on purpose: a replay after a permanent
-- delete must not quietly recreate a memory a person removed.
CREATE TABLE document_upsert_receipts (
  operation_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  intent_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
