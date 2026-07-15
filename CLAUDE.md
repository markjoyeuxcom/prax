# Prax — agent guide

Project-specific guidance for AI agents (e.g. Claude Code) working in this repo.

## Agent memory

This project can act as your **long-term memory** via the library + semantic search. Use the
`memory` skills to carry durable knowledge across sessions instead of relearning it:

- **Recall first.** Before starting a task, run `prax-recall "<what you're about to work on>"`
  to surface prior context, decisions, and runbooks. An honest "no relevant memory" means start
  fresh.
- **Remember durable findings.** When you learn something that outlives this session — how a system
  works, a decision/convention, a reusable procedure — run
  `prax-remember "<title>" "<body>"`. It de-dups by title (updates in place) and stamps agent
  provenance. Don't persist transient/session-only state.
- **Supersede, don't duplicate.** Re-`remember` an existing title to refine it; run
  `prax supersede <oldId> --with <newId>` when one memory replaces a different one.

The skills + `prax` CLI are the **canonical agent path** for memory (one shared code path,
distilled summaries, lazy-loading — token-cheaper than always-on MCP tool schemas). The MCP server
remains a product feature but is **not enabled by default** for agent sessions here; re-add it with
`claude mcp add` only for a heavy task-curation session. Skills/CLI reach the app at
`PRAX_API_URL` (default `http://127.0.0.1:3000`); semantic recall needs the app running with
`EMBEDDING_BACKEND` set.

See [docs/agent-memory.md](docs/agent-memory.md) for the full convention.

## Product quality

The active quality policy is
[Exceptional Prax — Product Quality Standard](docs/superpowers/specs/2026-07-13-exceptional-prax-quality-standard.md).
Its Gate A invariants apply to every change immediately. Preserve the evidence-backed baseline,
do not knowingly leave an invariant violation in a proposed release, and add regression evidence
for confirmed defect classes where practical.
