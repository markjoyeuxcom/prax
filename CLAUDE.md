# Moomora Console — agent guide

Project-specific guidance for AI agents (e.g. Claude Code) working in this repo.

## Agent memory

This project can act as your **long-term memory** via the library + semantic search. Use the
`memory` skills to carry durable knowledge across sessions instead of relearning it:

- **Recall first.** Before starting a task, run `moomora-recall "<what you're about to work on>"`
  to surface prior context, decisions, and runbooks. An honest "no relevant memory" means start
  fresh.
- **Remember durable findings.** When you learn something that outlives this session — how a system
  works, a decision/convention, a reusable procedure — run
  `moomora-remember "<title>" "<body>"`. It de-dups by title (updates in place) and stamps agent
  provenance. Don't persist transient/session-only state.
- **Supersede, don't duplicate.** Re-`remember` an existing title to refine it; use the MCP
  `link_documents` (`supersedes`) tool when one memory replaces a different one.

These skills are token-cheaper than pulling raw results through the MCP tools (they return a
distilled summary). The MCP server stays the right tool for interactive edits and linking. The
skills and MCP both reach the app at `MOOMORA_API_URL` (default `http://127.0.0.1:3000`); semantic
recall needs the app running with `EMBEDDING_BACKEND` set.

See [docs/agent-memory.md](docs/agent-memory.md) for the full convention.
