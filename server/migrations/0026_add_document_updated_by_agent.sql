-- Which agent CLI last wrote the document ('claude', 'codex', …). NULL for
-- human edits and for agent writes that did not identify themselves. Taken
-- from the x-prax-agent header only when x-prax-origin is 'agent'; a human
-- edit clears it, so the value always describes the CURRENT revision's author.
ALTER TABLE markdown_documents ADD COLUMN updated_by_agent TEXT;
