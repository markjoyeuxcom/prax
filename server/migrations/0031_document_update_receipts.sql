-- Stable identities for updates as well as creates/upserts. Keep receipts when
-- a document is permanently deleted: replay must not recreate or reapply it.
CREATE TABLE document_update_receipts (
  operation_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  intent_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- A supersedes edge points from replacement to predecessor. Reject an edge
-- when the predecessor already reaches the replacement. UNION (not UNION ALL)
-- terminates even if a pre-migration library contains a cycle. This guard and
-- the existing lifecycle triggers execute within the inserting statement.
CREATE TRIGGER document_links_no_supersession_cycle
BEFORE INSERT ON document_links
WHEN NEW.relation = 'supersedes'
BEGIN
  SELECT RAISE(ABORT, 'supersession cycle')
  WHERE EXISTS (
    WITH RECURSIVE predecessors(id) AS (
      SELECT NEW.target_document_id
      UNION
      SELECT dl.target_document_id FROM document_links dl
      JOIN predecessors p ON dl.source_document_id = p.id
      WHERE dl.relation = 'supersedes'
    )
    SELECT 1 FROM predecessors WHERE id = NEW.source_document_id
  );
END;
