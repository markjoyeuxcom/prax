-- Hybrid citation anchors: a citation keeps its line hash (content_hash) and
-- gains two anchors that survive what a line hash cannot.
--
-- normalized_hash: sha256 of the cited lines with ALL whitespace removed
-- (newlines included), so re-indentation, trailing spaces and a formatter
-- re-wrapping a call leave it unchanged. symbol: the name of the definition
-- enclosing the first cited line, from a zero-dependency heuristic
-- (cli/lib/codeRefs.js), so a citation whose content changed can still say
-- where its function now lives.
--
-- Both are nullable. A row with normalized_hash NULL predates these anchors
-- ("legacy") and is checked with the line hash alone; recall backfills it the
-- next time the line hash proves the checkout holds the pinned content. A
-- non-null normalized_hash means the anchors were computed, so symbol may then
-- be NULL legitimately (a whole-file citation, or code outside any definition).
-- Only hashes and a name are stored, never source.
ALTER TABLE document_code_refs ADD COLUMN normalized_hash text;
ALTER TABLE document_code_refs ADD COLUMN symbol text;

-- `prax check` looks citations up by the paths a change touched.
CREATE INDEX IF NOT EXISTS idx_document_code_refs_path ON document_code_refs (path);
