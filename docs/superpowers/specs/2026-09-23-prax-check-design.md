# prax check: cite-drift gate with hybrid citation anchors

Scope: give code citations anchors that survive line shifts and reformatting, and add a
read-only `prax check` command that a merge-request pipeline runs to find memories whose cited
code the change broke. Tracked in the Prax task "prax check: cite-drift CI gate with hybrid
citation anchors" (origin: the 2026-09-21 idea review). Zero new dependencies: no Tree-sitter,
no language server.

## Hybrid anchor

A citation (`document_code_refs`) keeps its **line hash** (`content_hash`, sha256 of the cited
lines with line endings normalised) and gains two nullable columns in migration `0039`:

- `normalized_hash`: sha256 of the cited lines with **all whitespace removed**, newlines
  included. Re-indentation, trailing spaces, blank lines and a formatter re-wrapping a call
  across lines all leave it unchanged. A difference that is only whitespace is not a
  different claim.
- `symbol`: the name of the definition that encloses the first cited line, found by a
  heuristic. Scan upwards from the first cited line to the nearest definition whose
  indentation is less than every non-blank line between it and the citation (the cited line
  may itself be the definition). A line that starts with a closing bracket does not end the
  search, so a signature wrapped over several lines still encloses its body.
  - Patterns are chosen by file extension, or by the shebang for an extensionless script.
  - JS/TS: `function`, `class`, `interface`, `type`, `enum`, `namespace`, `const x = (…) =>`
    and `function` expressions, and methods (`name(…) {`).
  - Python: `def`, `async def`, `class`.
  - Rust: `fn`, `struct`, `enum`, `trait`, `union`, `mod`, `impl` (named by type).
  - Go: `func`, with methods named `Type.Method`, and `type`.
  - Swift: `func`, `init`, `class`, `struct`, `enum`, `protocol`, `extension`, `actor`.
  - Shell: `name()` and `function name`.
  - Other files, and whole-file citations, have no symbol (`null`).

`normalized_hash` being non-null means "anchors computed"; `symbol` can then legitimately be
null. Rows written before 0039 are **legacy** (both null) and are checked with the line hash
alone. The store still keeps hashes and a name, never source.

### Writing and backfilling

- `prax remember --cite` and the prax-remember skill compute all three anchors at capture
  time. `POST …/code-refs` accepts `normalizedHash` (64 hex) and `symbol` (one line, up to
  200 characters). Its upsert overwrites both: a re-cite from an older client stores nulls,
  which is correct because the old anchors described old content.
- **Lazy backfill**: when recall checks a legacy citation and the line hash still matches
  (`current`, or `moved` by line hash), the lines in hand are exactly the pinned content, so
  recall computes the two missing anchors and sends them to
  `POST /api/library/documents/:id/code-refs/:refId/anchors`. The route is compare-and-set:
  it writes only while `content_hash` still equals the pinned hash and `normalized_hash` is
  still null, so a retry or a race cannot attach anchors to other content. It is best-effort:
  a failure (or an older server's 404) is ignored and recall proceeds unchanged.
- `prax check` never backfills: it is read-only.

### Relocation order

`checkCitation` tries, in order:

1. The **line hash** at the recorded range gives `current`.
2. The **line hash** over equal-length windows, nearest first, within the existing 1M-line
   budget, gives `moved`.
3. The **content hash** over variable-length windows gives `current` in place or `moved`,
   both with `anchor: "content"`.
   - Windows start at non-blank lines, nearest first, and extend up to twice the cited span
     plus 10 lines.
   - An incremental SHA-256 is copied and finalised at each line end, within a 250k-step
     budget of about 70 ms.
   - This step is skipped for legacy rows and for citations of blank lines only.
4. The **symbol** gives `changed`, with `symbol: { name, line }`: the content changed, but the
   enclosing definition still exists at `line` (nearest the recorded line when the name
   repeats). `line: null` means the definition is gone. This tells the reader where to
   re-cite; it never makes a changed citation count as holding.

A whole-file citation compares the line hash, then the content hash, over the whole file.
Results that the line hash settles keep their pre-0039 shape exactly. `anchor` and `symbol`
appear only when a later step decided.

Recall wording: a content-hash match in place says nothing, because the claim holds. A
content-hash move says `moved to p:a-b (whitespace changed)`. A symbol result adds
`(loadConfig is now at line 40)` or `(loadConfig is gone)` to the changed note.

## Query by path

`GET /api/library/code-refs?path=a&path=b[&project=slug]` returns
`{ items: [{ …citation, document: { id, title, documentType, status, verified, verifiedBy,
updatedAt, projectId, projectSlug, projectRepoUrl } }] }`.

- Only live, active documents are included. Archived, superseded and deprecated memories need
  no refresh.
- Paths must be relative. A request takes 1 to 200 paths; the CLI batches larger sets.
- An unknown `project` returns 400.
- An index on `document_code_refs(path)` (also in 0039) keeps the query from scanning every
  citation.

## `prax check`

```
prax check [--diff <range> | --files <a,b,…>] [--project <slug>] [--comment] [--strict] [--json]
git diff --name-only main... | prax check
```

- Input is exactly one of the following:
  - `--diff <range>` runs git over the checkout: `A...B` compares the merge base with B,
    `A..B` compares A with B, and `A` compares A with the working tree.
  - `--files` takes a comma- or newline-separated list of repository-relative paths.
  - Standard input takes a newline-separated list, read only when it is not a terminal.
- Git runs with `--unified=0 -M`, `core.quotePath=false` and explicit `a/` and `b/` prefixes,
  so user configuration (`diff.noprefix`, external diff drivers) cannot change what is
  parsed.
- **Which memories**: citations on every changed path, including the old path of a rename or
  deletion, from every project unless `--project` narrows it.
  - Recall's rule decides whether a citation belongs to this repository (the project's
    registered repo URL, else the pinned commit exists here). A citation from another
    repository is counted as not checked, never reported as drift.
  - An explicit `--project` vouches for its citations.
- **Diff mode, touch rule**: the citation is located in the **base** version (by the relocation
  order above), and it is touched when that range overlaps a changed old-side line.
  - An insertion counts when it falls strictly inside the range.
  - A whole-file citation, a deleted file or a renamed file is always touched.
  - A citation that already did not hold at base is located by its recorded range and its
    symbol block.
  - Untouched citations in changed files are ignored.
- **Diff mode, verdicts** for touched citations, checked against the head version:
  - `drift` means the citation held at base and does not hold at head: it changed, it is
    missing, or its file was renamed (the stored path is now wrong). The same applies when the
    file is new in this diff. **Fails.**
  - `stale` means it already did not hold at base. It is reported but does not fail, because
    one old rotten memory must not block every merge request that touches its file.
  - `holds` means it is current, moved or whitespace-only. It is reported with its new
    location when it moved. A change that repairs an already-broken citation also `holds`.
- **File mode verdicts**: there is no base, so every citation on a listed file is checked
  against the working tree. `drift` (fails) or `holds`.
- **Exit codes**, following grep and diff:
  - `0` means no drift, or the check was skipped fail-open.
  - `1` means drift.
  - `2` means the check could not run: a usage error, git failure, no checkout, an API error,
    or an unreachable Prax under `--strict`.
- **Output**: a text summary by default, and `--json` for the structured report.
  - `--comment` prints a Markdown merge-request comment body: a table of drifted memories
    (title, project, trust, citation, what happened, where the symbol is now), then stale and
    still-holding sections, then how to fix it.
  - The comment says how to fix drift: refresh the memory and re-cite with `--cite`, or retire
    it with `prax supersede`.
- **Fail-open**: Prax is local-first and usually runs on a person's machine. A shared runner
  often cannot reach it, and a gate that fails whenever a laptop sleeps would be switched off
  within a week.
  - So an unreachable instance (connection refused, DNS, timeout) or a server without the
    by-path route (404) exits `0`.
  - It prints `prax check: skipped — Prax is not reachable at <url>; cited memories were not
    checked` on stderr, and in the comment body when `--comment` is given.
  - `--strict` turns this into exit `2`, for teams that host Prax where CI can reach it.
  - Any other API error (a 5xx or 400) is exit `2` regardless: a misconfigured gate should be
    visible.
- A change that touches no files never contacts Prax.
- **Read-only**: GET requests only, no backfill, no writes to the checkout.

A GitLab CI example lives in `docs/cli.md` only. This repository's pipeline does not add the
job: its runners cannot reach a developer's desktop Prax, so the job would only ever skip.

## Portability

- **Workspace backup**: the SQLite snapshot carries the new columns as-is. An older backup
  restores and migrates to 0039 with legacy citations.
- **Portable Markdown v3**: each `code_refs` entry gains `normalizedHash` and `symbol`. This is
  additive within the existing JSON objects (importers ignore unknown fields), so the version
  stays 3. Markdown import remains one-way and does not read front matter.

## Risks

- The symbol heuristic misreads unusual formatting, for example a column-0 heredoc inside a
  function. It only ever adds a hint or widens the stale touch rule, never turns drift into a
  hold.
- Inbox undo fingerprints include citation rows, so a backfill on an Inbox document with
  citations makes an older undo report "changed". This is rare: an Inbox capture with code
  citations that is recalled between the decision and the undo.
- Line-shift noise remains for legacy rows until recall backfills them or they are re-cited.

## Evidence

- `tests/cli/citationAnchors.test.js`: anchors and the symbol heuristic per language, the
  relocation order, and the backfill.
- `tests/cli/check.test.js`: diff parsing, the touch rule, verdicts, the comment body, and
  `prax check` end to end against a temporary git repository and a throwaway in-process server
  on a random port, including the fail-open and `--strict` paths.
- `tests/backend/codeRefAnchors.test.js`: migration 0039, backfill compare-and-set, the
  by-path route, and the export and backup round trip.
- Updated migration lists.
- `npm test`, `npm run check`, `npm run verify:restore`, `npm run verify:portable`.
