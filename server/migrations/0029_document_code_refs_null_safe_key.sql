-- A whole-file citation has NULL line bounds, and SQLite treats NULLs as
-- distinct inside a UNIQUE constraint — so the (document_id, path, start_line,
-- end_line) key in 0028 never fired for whole-file citations, and every re-cite
-- (or retried POST) inserted another row instead of refreshing the pin.
--
-- A unique index over coalesced bounds makes the key NULL-safe: 0 is never a
-- real line number (they start at 1), so it is a safe sentinel INSIDE THE
-- INDEX ONLY. The columns keep storing NULL for "the whole file"; nothing that
-- reads them changes. The upsert's conflict target names this index.
--
-- Rows already duplicated by 0028's key collapse to the newest pin per
-- logical key first, otherwise the unique index could not be created.
DELETE FROM document_code_refs
WHERE rowid NOT IN (
  SELECT max(rowid)
  FROM document_code_refs
  GROUP BY document_id, path, coalesce(start_line, 0), coalesce(end_line, 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_document_code_refs_range
  ON document_code_refs (document_id, path, coalesce(start_line, 0), coalesce(end_line, 0));
