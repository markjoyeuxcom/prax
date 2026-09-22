-- Titles are single-line (2026-09-22 review): a newline in a title let an
-- agent-written document open its own heading in a context pack and sit under
-- a trust label it never earned. Writes now collapse every whitespace run that
-- holds a line break or control character to one space (server/documentTitle.js);
-- this repairs titles stored before that rule.
--
-- SQLite has no regex, so each C0/C1 control character, U+2028 and U+2029 is
-- replaced by a space, and then (only in the rows that held one) runs of spaces
-- are collapsed. NUL is not handled here: SQLite truncates text at it.
--
-- The revision token (sha256 over title + body) cannot be computed in SQL, so
-- it is cleared and the repository's first-use backfill recomputes it. A
-- vector embedded from the old title is then correctly pending a reindex.
-- Verification and updated_at are deliberately left alone: the words a person
-- reviewed are unchanged, only the line breaks between them.
update markdown_documents
set title = coalesce(nullif(trim(
      replace(replace(replace(replace(replace(replace(r.replaced, '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' ')
    ), ''), 'Untitled'),
    revision = null
from (
  select id, replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(title,
          char(1), ' '), char(2), ' '), char(3), ' '), char(4), ' '), char(5), ' '), char(6), ' '),
          char(7), ' '), char(8), ' '), char(9), ' '), char(10), ' '), char(11), ' '), char(12), ' '),
          char(13), ' '), char(14), ' '), char(15), ' '), char(16), ' '), char(17), ' '), char(18), ' '),
          char(19), ' '), char(20), ' '), char(21), ' '), char(22), ' '), char(23), ' '), char(24), ' '),
          char(25), ' '), char(26), ' '), char(27), ' '), char(28), ' '), char(29), ' '), char(30), ' '),
          char(31), ' '), char(127), ' '), char(128), ' '), char(129), ' '), char(130), ' '), char(131), ' '),
          char(132), ' '), char(133), ' '), char(134), ' '), char(135), ' '), char(136), ' '), char(137), ' '),
          char(138), ' '), char(139), ' '), char(140), ' '), char(141), ' '), char(142), ' '), char(143), ' '),
          char(144), ' '), char(145), ' '), char(146), ' '), char(147), ' '), char(148), ' '), char(149), ' '),
          char(150), ' '), char(151), ' '), char(152), ' '), char(153), ' '), char(154), ' '), char(155), ' '),
          char(156), ' '), char(157), ' '), char(158), ' '), char(159), ' '), char(8232), ' '), char(8233), ' ') as replaced
  from markdown_documents
) as r
where r.id = markdown_documents.id
  and r.replaced <> markdown_documents.title;
