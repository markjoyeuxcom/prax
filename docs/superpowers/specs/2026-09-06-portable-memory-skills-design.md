# Portable memory skills — design

**Status:** implemented on `feat/portable-memory-skills` (2026-09-06).
**Origin:** review of the agent-memory path on 2026-09-05 (memory "Prax memory system review
2026-09-05"), which found the loop sound but unusable outside a checkout and by Codex, plus four
defects.

## Goals

1. An agent CLI (Claude Code, Codex) can gain the `prax-recall` / `prax-remember` skills on a
   machine that has never had this repository, with one command.
2. Both tools see the same skills in a checkout without per-tool copies.
3. The defects found in review are fixed with regression evidence:
   superseded-title overwrite, concurrent same-title duplicates, silently dropped `--ref`,
   vendor-less provenance, and the drifted `CLAUDE.md` / unreachable desktop port.

## Design

- **One source, one bundle.** `skills/src/*.mjs` import `cli/lib` (the shared code path behind
  `prax`). `scripts/build-skills.mjs` bundles each with esbuild into
  `skills/<name>/scripts/*.mjs` — one file, Node builtins only. Bundles are committed;
  `npm run check` fails when stale, so the installed script always equals the reviewed source.
- **Standard layout, two mirrors.** `skills/` follows agentskills.io. Claude Code reads
  `.claude/skills/`, Codex reads `.agents/skills/`; both are symlinks to `skills/` (Claude Code
  follows symlinked skill folders; verified in-session by the skills appearing in the loaded
  skill list).
- **Install without a checkout.** `skills/install.sh` does a blobless sparse clone of `skills/`
  into a temp dir, copies the two skills to `~/.agents/skills`, symlinks them into
  `~/.claude/skills`, and deletes the clone. The repo is also a Claude Code plugin marketplace
  (`.claude-plugin/`), source `./`, for `claude plugin install prax@prax`.
- **App discovery.** `cli/lib/apiClient.js` resolves candidates: explicit URL → desktop
  `webview-port` (Tauri app-data dir per platform) → `127.0.0.1:3000`, trying the next on a
  connection failure and pinning the first that answers. An explicit URL has no fallback.
- **Atomic remember.** `POST /api/library/documents/upsert-by-title` runs find-active-by-title
  then update-or-insert in one `begin immediate` session. The client sends a stable id so a
  lost response replays safely. Clients fall back to the old path only on 404.
- **Vendor provenance.** `x-prax-agent: <id>` (honoured only with `x-prax-origin: agent`,
  sanitised to `[a-z0-9][a-z0-9._-]{0,63}`) → column `updated_by_agent` (migration 0026), API
  field `updatedByAgent`, cleared on human edits. Detected from `CLAUDECODE` /
  `CODEX_THREAD_ID`; `PRAX_AGENT` or `--agent` overrides.
- **Strict skill arguments.** `cli/lib/skillArgs.js`: unknown options are errors; `--ref` is
  validated and attached best-effort after the write.

## Evidence

- `tests/cli/skillArgs.test.js`, `tests/cli/apiClient.test.js` (discovery, fallback, headers),
  `tests/cli/remember.test.js` (upsert path, 404 fallback, active-only legacy dedup).
- `tests/backend/libraryUpsertByTitle.test.js` (real SQLite: create, update-keeps-type,
  superseded-not-revived, 5-way concurrent race → one document, id replay, validation, human
  write), `tests/backend/editOrigin.test.js` and `libraryRepository.agent.test.js` (header →
  column).
- `npm run check` includes `skills:check`; `claude plugin validate .` passes.

## Out of scope

- Exporting `updatedByAgent` in the portable Markdown format (contract change; not needed for
  recall).
- The MCP server sending `x-prax-agent` (it does not identify its host; `PRAX_AGENT` could be
  threaded later).
- Installing an embedding backend; without one recall is keyword-only and says so.
