# Claude CLI Chat Backend Implementation Plan

**Goal:** Prax's AI surfaces (Ask Prax, NL capture/filter, writing actions, review
narration) can run on the user's existing `claude` login — Pro/Max subscription, zero API
keys stored — by driving the Claude Code CLI headlessly (`claude -p`) as a first-class
chat backend alongside anthropic/openai/gemini/ollama/llamacpp.

**Source:** "can we build support directly so that the app can also use claude cli or
codex cli" (2026-07-21); assessment recommended Claude CLI first, user: "yes build it".
**Status:** Shipped

## Design decisions

1. **Keyless by design.** The local `claude` login IS the credential. Nothing is stored
   in Prax — no key field renders, `keyRequired: false`, and the settings API keeps its
   invariant that secrets are never echoed (here there is simply no secret at all).
2. **Safety fencing, non-negotiable.** A summarization call must never become an agent
   run. Every spawn gets `--max-turns 1` (no tool round-trip can complete), an **empty
   scratch cwd** under `tmpdir()/prax-claude-cli` (nothing sensitive to read), and
   `--strict-mcp-config --mcp-config '{"mcpServers":{}}'` (no MCP servers load — not
   even Prax's own, which would be a feedback loop). `supportsTools: false`, so the
   in-app assistant degrades honestly through the existing `assistantRoutes` gate
   instead of pretending.
3. **The PATH gotcha is a setting.** A GUI-launched desktop sidecar inherits a minimal
   PATH (`/usr/bin:/bin`) that cannot see `claude`. Resolution order: explicit
   configured `binaryPath` (must exist — a wrong explicit path is an error to surface,
   never silently replaced) → PATH scan → well-known homes (`~/.claude/local`,
   Homebrew, `/usr/local/bin`, `~/.local/bin`, `~/.npm-global/bin`). The Settings card
   has a Binary path field; empty = auto-detect.
4. **CLI words travel verbatim.** `-p --output-format json` result envelope → text;
   `is_error`/non-`success` subtypes throw with the CLI's own message (login prompts,
   rate limits), which the never-500 advisory regime surfaces as the degraded reason.
   Errors are never dressed up as ours.
5. **Serialized spawns.** One CLI process at a time through a promise queue —
   concurrent advisory calls (NL parse + narration) must not stampede a heavy
   subprocess. 120s timeout, SIGKILL on expiry.
6. **`isAvailable` = `--version`** — cheap, offline, quota-free. Login state is
   discovered honestly at first real use rather than burning a completion on a probe.
7. **Prompt over stdin** (`serializeTurns`): a single user turn passes through
   untouched; rare multi-turn advisory calls become a labelled `User:/Assistant:`
   transcript — fidelity without session plumbing. System prompt via
   `--append-system-prompt` so the CLI's own guardrails stay underneath.
8. **Codex CLI deferred.** Same chassis can host it later; its headless mode is
   rougher (no `--append-system-prompt` equivalent, different envelope). Optional
   later phase: prompted tool-calling for CLI backends.

## Work

- [x] `server/chat/claudeCli.js`: `resolveClaudeBinary` / `serializeTurns` /
      `buildCliArgs` / `parseCliResult` / `createClaudeCliChat` (queue, fencing,
      timeout, honest errors, `isAvailable`).
- [x] `server/chat/index.js`: `claude-cli` factory case.
- [x] `server/chatProvider.js`: backend registered (not key-required); `binaryPath`
      through sanitize/validate (≤500 chars, trim, `''` = auto-detect)/defaults
      (`{ model: 'haiku', binaryPath: '' }`)/redacted status/getChat/putSettings.
- [x] `server/settingsRoutes.js`: `binaryPath` in CHAT_FIELDS + chat status.
- [x] `public/js/renderSettings.js`: Claude CLI provider card + dedicated config
      branch (binary path + model, no key/baseUrl, honest description: login, rate
      limits shared, assistant tools still need an API backend).
- [x] `public/js/main.js`: save handler collects `data-ai-chat-binary`.
- [x] Tests: `tests/backend/chatClaudeCli.test.js` — arg/parse/resolve pins, fake-spawn
      complete (success, stderr verbatim, missing binary, timeout kill, tools refusal,
      queue serialization), `--version` probe, provider round-trip, ai-answers route
      (status shape + honest `connected: false`, 400 on bad binaryPath). renderSettings
      test: keyless card renders binary+model fields and no key/baseUrl fields.
- [x] Full gates: `npm test`, `npx playwright test` (no schema change — no migration
      pins or drills touched).
- [x] CHANGELOG entry.

## Verification

- Unit: 12 adapter/provider/route tests; 1 renderSettings test (all green).
- Full suites green (see CHANGELOG entry for counts).
- Deviations: one field-found fix. First real use surfaced that the CLI writes its
  failure envelope (e.g. "Not logged in · Please run /login", `is_error: true` under
  `subtype: "success"`) to stdout **with a non-zero exit code**; the first cut rejected
  on non-zero exit before parsing, leaking 300 chars of raw JSON as the error. `run()`
  now resolves on any exit and `parseCliResult` takes the exit code, so the CLI's own
  words always surface; regression test pins the observed envelope verbatim.
