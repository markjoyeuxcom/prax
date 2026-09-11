-- Code-pinned memory: bind a claim to the code it describes so the repository
-- can answer whether the claim has gone stale.
--
-- Distinct from document_external_refs, which points at an outside URL and
-- deliberately has no staleness because nothing is copied. Here the CONTENT is
-- pinned: content_hash is a sha256 of the cited lines (line endings normalised),
-- and re-hashing the file in a checkout says current / moved / changed / missing.
-- The source itself is never stored — only its hash — which keeps code out of
-- the knowledge base and still allows relocated code to be re-found.
--
-- commit_sha records where the citation was taken, for a human reading a diff.
-- It is informational: the check is content-based, so a citation survives
-- rebases and branch switches that a commit comparison would false-alarm on.
CREATE TABLE IF NOT EXISTS document_code_refs (
  id text primary key default (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  document_id text not null references markdown_documents(id) on delete cascade,
  path text not null,
  start_line integer,
  end_line integer,
  commit_sha text,
  content_hash text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (document_id, path, start_line, end_line)
);

CREATE INDEX IF NOT EXISTS idx_document_code_refs_document on document_code_refs (document_id);
