# Library git mirror and compiled AGENTS.md block

User-approved scope: mirror a project's Library into its checkout as Markdown v3 so the knowledge
travels with the repository and changes are reviewable in merge requests, and compile the
project's verified decisions into the workspace instruction file so they are always-on for every
agent. Tracked in the Prax task "Git mirror of the project Library and compiled AGENTS.md block"
(`148bedc8`).

SQLite stays the single source of truth. The mirror is a one-way projection; git is never a
second writer. Receipts, revisions, run history, embeddings and document links do not round-trip
through git.

## Behaviour

- `prax mirror [--project <slug>] [--out <dir>] [--check] [--force] [--json]` writes the resolved
  project's Library into `<dir>` (default `.prax/library/` at the repository root, or the current
  directory outside a checkout).
- `prax mirror import [dir] [--project <slug>] [--trust-verifier <a,b>] [--json]` reads a mirror
  folder back into a library, as described under [Import](#import).
- `prax mirror --agents-block [--project <slug>] [--file <path>] [--type <a,b>] [--tag <a,b>]
  [--max-chars <n>] [--print | --remove] [--json]` compiles the managed instruction block.
- `skills/install.sh --library-block` compiles the `memory` project's verified conventions into
  each tool's global instruction file; `--uninstall` removes that block too.

## Export source

The mirror reuses the Markdown v3 renderer and the Library export's filename and link rules. The
existing route gains two query options, so there is still one exporter and one format:

- `GET /api/library/export?project=<slug>&format=json` returns the same rendered documents as
  JSON instead of a ZIP: `{ format: "prax.library-export", version: 1, markdownVersion: 3, scope,
  layout, includeArchived, documents: [{ path, id, title, documentType, status, tags, verified,
  verifiedBy, verifiedAt, contentHash, markdown }] }`. `markdown` is byte-for-byte the ZIP entry.
- `layout=mirror` places active documents at the folder root and superseded or deprecated
  documents under `retired/`. Link `ref`s point at those real paths. `README.md` at the root is a
  reserved name: a document whose file name folds to it takes the usual `-2` collision suffix.
- `format` accepts `zip` (default) and `json`; `layout` accepts `flat` (default) and `mirror`;
  other values are `400`. The ZIP default is unchanged.

Ordering becomes total so equal inputs render equal bytes: documents by project slug, title,
creation time and id; outbound links by source, relation, target title and target id; code
citations by document, path, start line and id. The ZIP export benefits from the same fix.

## Mirror layout

```
.prax/library/
  README.md            generated notice + a table of every mirrored document
  index.json           machine manifest (format prax.library-mirror, version 1)
  <file>.md            active documents
  retired/<file>.md    superseded and deprecated documents
```

- File names follow the export rule: `sourceFilename`, else the slugified title, else
  `untitled.md`, with case- and Unicode-folded collision suffixes. A title change is a file
  rename; git shows it as one.
- `index.json` lists `{ path, id, title, type, status, verified, verifiedBy, contentHash }` per
  document, sorted by path. Neither index file carries a timestamp, so nothing changes when the
  Library did not.
- Output is deterministic: the same Library state produces identical bytes, and a file whose bytes
  are unchanged is not rewritten (its mtime is kept).
- Archived and permanently deleted documents leave the mirror: their files are deleted.
  Retiring a document moves its file into `retired/`; restoring or reactivating moves it back.
- The mirror owns only the files its manifest lists. Before writing it records the union of the
  old and new paths in `index.json`, so an interrupted run can be finished by the next one. Any
  other `.md` file in the folder is reported as unmanaged and left in place.
- A non-empty folder without a mirror manifest is refused unless `--force` is given; adopting a
  folder with `--force` never deletes files the manifest did not list.
- `--check` compares without writing and exits `1` when the mirror is stale, for CI.
- The report lists added, updated, moved, deleted, unchanged and unmanaged files; `--json`
  returns the same as an object.

## Git hygiene

Commit `.prax/library/` (the default recommendation): it is the reviewable, diffable record of the
project's knowledge and lets teammates without Prax read it. Regenerate it with `prax mirror` and
commit the result with the change that motivated it. Do not edit mirrored files by hand: the next
mirror overwrites them, and import never writes over an existing document. A team that prefers not
to commit it adds `.prax/library/` to `.gitignore`; nothing else depends on it.

Not mirrored: operation receipts, content revisions, runbook run history, embeddings, activity,
settings, tasks and archived documents. `task_ids` in front matter are references only.

## Import

`prax mirror import` reads `index.json` and each listed file, and creates documents through the
existing Markdown-import route, `POST /api/library/documents` with the document's own UUID as the
caller id, which the record-creation receipt makes exact-once:

- `201`: created. `200`: the same document with the same content already exists (a replay).
  `409`: that id exists with different content, so the library copy wins and the file is skipped.
  `410`: the document was created before and permanently deleted, so it is not recreated.
- Only `active` documents are imported. Retired files are skipped and reported, because document
  links do not round-trip and a superseded document without its replacement would re-enter
  retrieval as active.
- Title, body, type, tags, kind and source file name are imported. The body is recovered exactly:
  the renderer adds a final newline, so when the file's body does not match `content_hash`, the
  importer tries it without that newline.
- External references are re-attached (idempotent). Code citations are re-attached only to a
  document this run created. Timestamps, author provenance, task ids and links are not imported:
  the import is stamped as an agent write by whoever ran it.
- Every document lands unverified (`verified: false` is sent explicitly).

### Trust rule

Front-matter verification is a claim made by whoever can commit to the repository. An imported
document is verified only when all of these hold:

1. the file says `verified: true` and names `verified_by`;
2. that name is in the trusted list: `--trust-verifier <a,b>` or `PRAX_TRUSTED_VERIFIERS`
   (comma-separated, exact match after trimming). The list is never read from the mirror or the
   repository, because a claim cannot vouch for itself;
3. the body's SHA-256 equals the file's `content_hash`, so the verifier reviewed this exact body
   (a git edit after verification breaks the claim);
4. the library copy is unverified and its content hash equals the claim; and
5. a person confirms, in an attended terminal, by typing `VERIFY <n>` after the list of documents
   and claimed verifiers is shown. This keeps verification the attended, named act the quality
   standard requires (QINV-04, QINV-11).

The verification is recorded through the ordinary verify route as the claimed verifier, bound to
the created document's revision. Claims that fail a condition, or that could not be confirmed,
are reported with the reason; those documents stay unverified and can be verified in the Library.
The claim covers the body, not the title: the title is shown in the confirmation list.

## Compiled instruction block

`prax mirror --agents-block` compiles one project's knowledge into a managed block of a workspace
instruction file (default: the repository root's `AGENTS.md`, else `CLAUDE.md`, else a new
`AGENTS.md`; `--file` chooses another).

- **Selection.** Only active, verified documents of type `decision`, plus active, verified
  documents of any type tagged `convention`. `--type` and `--tag` replace these defaults.
  Unverified documents are never compiled. An instruction file is loaded into every session, so
  it carries standing rules only; runbooks and references are task-specific and stay with recall
  and context packs, and a standing runbook or reference opts in with the `convention` tag.
- **Format.** A heading naming the project, a line saying the block is generated and how to
  refresh it, then one `###` entry per document in title order: its type, verifier and `prax get
  <id>`, then its body. Body headings become bold lines so they cannot restructure the host file;
  anything resembling the block's markers is neutralised.
- **Bounded.** At most `--max-chars` characters (default 8000). Each body is capped at 1500
  characters, cut at a line boundary (closing any open code fence), with a note naming `prax get
  <id>`. Documents that do not fit are omitted with an explicit note giving the count and the
  command that lists them. No timestamp: identical inputs give an identical block.
- **Markers.** `<!-- prax-library:start -->` / `<!-- prax-library:end -->`, distinct from the
  skills' `prax-memory` block. The edit is the installer's managed-marker routine
  (`cli/lib/managedBlock.js`, a parameterised port of `edit_instructions`, with a test holding the
  two to identical results): a symlinked file is edited at its target, the mode is kept, the write
  is atomic, only one marker pair is allowed, and malformed or duplicated markers refuse the edit
  without changing the file. An unchanged block is not rewritten. `--remove` deletes the block
  only; `--print` writes it to stdout without touching a file.
- **Coexistence with the skills' block.** Both blocks often share a file, in either order. Each
  editor matches only its own marker name, so a malformed block of one kind refuses that kind's
  edits and never stops or changes the other. An edit refuses when its block's span holds any
  other marker-shaped line, when its block sits between another block's start and end (nested or
  interleaved blocks), and when the new body holds marker-shaped text: each of those would let
  one edit replace or delete part of the other block. Removal takes the block, its line ending
  and the blank line the writer put before it when a blank line or the end of the file follows,
  so writing and removing the two blocks in any order gives the original bytes back (before
  this rule, removing the first of two blocks left an extra blank line, and `--uninstall` with the
  compiled block first did not restore the file).
- **Installer.** `install.sh --library-block` runs the pack's CLI to compile the `memory`
  project (override with `PRAX_LIBRARY_BLOCK_PROJECT`) into the same four global instruction
  files as `--instructions`. It needs the app payload (`cli/` beside `skills/`) and a running
  app; when the app is unreachable it says so and leaves the files unchanged without failing the
  install. `--uninstall` removes the block through the same CLI, and reports a file it cannot
  clean when there is no payload beside the installer.

## Reliability

- The mirror and the block are pure reads of the library; they never write to SQLite.
- Import writes are receipt-backed creates (safe to retry after a lost response), idempotent
  external references, and the verify route with the displayed revision.
- File writes are atomic (temporary file and rename) and skip unchanged content.

## Evidence

- `tests/cli/mirror.test.js`: deterministic bytes, updates, retirements (move), archive and delete
  (removal), reserved names, unmanaged files, the `--force` guard, `--check`.
- `tests/cli/mirrorImport.test.js`: trust rule (each condition), body recovery, receipt outcomes.
- `tests/cli/agentsBlock.test.js`: verified-only selection, bounds and truncation notes, marker
  neutralisation, idempotent write, removal, symlink, and parity with install.sh's routine.
- `tests/backend/libraryExportRoute.test.js`: `format=json`, `layout=mirror` and validation.
- `tests/contract/libraryMirror.test.js`: a real app on SQLite, mirrored, imported into a second
  app, re-mirrored; the portable fields round-trip and the trust rule holds.
- `tests/skills/managedBlocksCoexist.test.js`: the two blocks in either order through both
  routines and the real entry points (`install.sh --instructions`, `--uninstall` from the bundle
  and piped, `prax mirror --agents-block` and `--remove`): refresh and removal leave the other
  block byte-for-byte, removal in any order restores the original file, a malformed block refuses
  only its own edits, and nested or interleaved blocks refuse every edit.
- `tests/skills/installLibraryBlock.test.js`: `--library-block` write beside the skills' block,
  verified-only, idempotence, unreachable app, uninstall, and a payload-less uninstall that
  refuses to guess.

## Open points

- `npm run check` syntax-checks a fixed list of CLI modules; the new `cli/lib/mirror*.js`,
  `agentsBlock.js` and `managedBlock.js` are exercised by the tests but not added to that list,
  to keep this change clear of the shared `package.json` line.
- Deprecated status cannot be set through the API, and links do not round-trip, which is why
  import skips retired files rather than reviving them.
