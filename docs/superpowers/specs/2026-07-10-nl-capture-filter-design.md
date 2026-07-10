# Tier-3 #8 — Natural-language capture & NL→filter

Status: Shipped 2026-07-10 (judge panel winner "chips-preview-capture-and-filter-translate"
with grafts from the trust-first and minimal-footprint proposals; hardened by an adversarial
review pass — stale-NL-state resets on every capture open/close path, keyword-date words
preserved in confirmed titles, the due-today default surfaced as a removable chip, re-parse
resends the original phrase, Enter double-fire guarded, in-flight responses dropped when the
input/view changed underneath them, calendar-valid date coercion). Roadmap: `docs/ROADMAP.md`
→ AI feature tiers → Tier 3.

## Principle

One mental model for both halves: **the input you already use, plus one explicit chord —
Ctrl/Cmd+Enter — that asks the AI to produce a transparent artifact you confirm or edit.**
Plain typing and plain Enter remain byte-identical to today. The model never gains write
access or predicate power: it only emits text in languages the app already validates
deterministically (the task-filter grammar; a strictly whitelisted capture-fields JSON).

## NL→filter

- **Entry**: the existing Filter view input. A `✦ Translate` button (right of the match
  count) and ⌘/Ctrl+Enter inside `[data-filter-input]`. Plain Enter stays a no-op. Button
  gated on `chatStatus.available` (disabled + `title="Set an AI model in Settings ▸
  Intelligence"`); the chord is ignored when unavailable.
- **Output contract**: a **grammar string** that lands in the visible filter input via the
  existing `setState({ activeFilterExpr, activeSmartViewId: null })` pipeline — live results,
  match count, error hint, and "Save as view" all work unchanged. Transparent, editable,
  portable (the expression string is the artifact).
- **Provenance**: hint line shows `✦ from "<English>" · restore`; the restore link puts the
  original English back (`state.nlFilterSource`). Any manual edit of the input clears
  `nlFilterSource` (the hint must never misrepresent a hand-edited expression).
- **Invalid output**: no server-side repair round-trip (graft). If the model emits an
  extractable-but-invalid expression, return it with `valid:false` + the parse error and
  still land it in the input — the existing errHint explains, and hand-fixing `(p1` is one
  keystroke. If nothing extractable: "The model couldn't produce a filter. Try rephrasing."
- **Semantic lint (server)**: beyond `parseTaskFilter(expr).ok`, audit atoms and return
  `warnings[]`: unknown `#project`/`@label` (vs grounded lists), invalid `due:`/`priority:`/
  `status:`/`is:` args (they silently compile to match-nothing), and **bareword-matches-
  project detection** (model emitting `homelab` instead of `#homelab` is parse-valid but
  means title-substring — warn "did the model mean #homelab?").
- **Idempotence**: prompt rule — if the input is already a valid filter expression, return
  it unchanged.

## NL capture

- **Entry**: quick capture. `N → type → Enter` stays byte-identical (deterministic shorthand,
  instant create, zero model). ⌘/Ctrl+Enter = **smart add**: footer swaps to "✦ Parsing…",
  then a chips preview appears; **plain Enter confirms** (total cost: one extra keystroke).
  When no model is configured the chord **falls through to plain add** — never a dead
  keystroke. Footer affordance `✦ ⌘↵ smart add` gated on `chatStatus.available`.
- **Preview** (trust: see-and-correct BEFORE effect, per the writing-actions precedent):
  - The **cleaned title replaces the input value** (editable in place — graft); the original
    raw text is kept in `state.nlCaptureRaw` for restore.
  - Chips between input and footer: project (with dot), priority, due date rendered as the
    **resolved absolute date with weekday** ("Fri Jul 17 · 09:00" — the disambiguation
    artifact for relative-date errors; **is-past dates get a warning tone**), `↻ weekly`,
    `@label`s. Each chip is a button (`data-action="drop-nl-field"`) — click removes that
    field (correction = removal back to defaults; deeper edits happen post-create in the
    drawer, as with all capture today).
  - Dropped hallucinations render as a muted note: `ignored: #homlab (no such project)`.
  - Footer hint: `↵ add task · ⌘↵ re-parse · esc cancel`.
  - **Escape layering**: with a preview showing (or a parse in flight), the first Esc
    aborts/discards and restores the raw text; only a second Esc closes the overlay.
- **Raw text to the model** (essential graft, judge-verified): the AI path sends the RAW
  typed text — `DATE_KEYWORDS` matches bare `friday` but not `next friday`, so stripping
  shorthand first would resolve "next friday" to THIS Friday and mangle the residual title.
  On confirm, **sigiled tokens win**: `!priority`, `@labels` (union), `#project`, and
  explicit ISO dates from `parseCaptureShorthand(raw)` override the model's fields; keyword
  dates are the model's job in the AI path. Merge lives in a pure exported helper
  (`mergeNlCapture` beside `parseCaptureShorthand`) so it's unit-testable.
- **Backlog-status fix (drive-by, same code path)**: `addQuickTask` currently sends design-
  vocab `'backlog'` raw and 400s; route capture status through `apiStatus()`.

## Backend

- **Pure module `server/nlParse.js`** (mirrors `writingActions.js`):
  `buildNlCaptureMessages({ text, date, projects, labels })`,
  `buildNlFilterMessages({ text, date, projects, labels })`,
  `coerceNlCaptureFields(rawModelText, { projectSlugs, knownLabels, rawText })
  → { fields, dropped } | null`,
  `auditFilterExpr(expr, { projects, labels }) → { ok, parseError, warnings }`,
  plus the grammar cheatsheet constant. JSON extraction via the string-aware
  `extractJsonObject` (lifted from `kbHealthReview.js` into a shared import, or imported
  directly). The parser is total: bad output → null, never throw.
- **Two routes in `server/tasksRoutes.js`** (task domain; `options.chat ?? app.chatProvider`
  mirror, same as libraryRoutes):
  - `POST /api/tasks/nl-capture` `{ text, date?, projects?, labels? }` →
    `{ fields|null, dropped[], degraded, reason?, model }`
  - `POST /api/tasks/nl-filter` `{ text, date?, projects?, labels? }` →
    `{ expr|null, valid, parseError?, warnings[], degraded, reason?, model }`
  - Never-500 degraded-200 regime (stateless parse-and-return; the client creates the task
    via the normal `POST /api/tasks`). Validation order: 400 for empty text BEFORE
    `resolveChat()`; text truncated at 500 chars; degraded reasons logged via `request.log`
    for a minimal failure signal.
- **Grounding, client-sent** (graft): the client already holds `state.projects` and labels
  derivable from `state.tasks`; it sends both lists in the request. Server caps ≤50 each,
  truncates names (60/40 chars) — bounded prompt, no new repository method. Prompt-shaped
  text inside a project/label name is contained by the coercion whitelist + preview-before-
  commit.
- **Prompts**: temperature 0; maxTokens 300 (capture) / 200 (filter). System prompt carries
  "Today is <weekday>, <YYYY-MM-DD>" — weekday computed from **local date parts**
  (`new Date(y, m-1, d)`, never `new Date('YYYY-MM-DD')` which parses UTC). The user
  message's FIRST LINE is the raw text (fake-chat echo contract). Capture prompt: output
  ONLY one JSON object, whitelisted keys, omit-when-unclear, project MUST be a listed slug,
  fixed time-word map (morning→09:00, noon→12:00, afternoon→14:00, evening→18:00,
  night→20:00). Filter prompt: grammar cheatsheet (reuse the `search_tasks` description
  wording) + grounding + 4 few-shot pairs + idempotence rule.
- **Coercion (never trust the model)**: whitelist keys; clamp enums
  (priority/recurrence/status vocab = API vocab); regex-validate `YYYY-MM-DD` / `HH:MM`;
  drop `dueTime` without `dueDate`; unknown project slug → `dropped`; **verbatim-label
  rule** — keep a model label only if it's in the known list OR appears verbatim
  (case-insensitive) in the raw text; title hard-capped at 300 chars.

## Client plumbing

- `taskApi.js`: `parseNlCapture(payload)` / `parseNlFilter(payload)` (writing-action shape).
- **Timeout/abort** (all three judges): both calls use `AbortController` with a ~20s
  timeout; Esc mid-flight aborts. Module-level generation tokens (`nlCaptureToken`,
  `nlFilterToken`) bumped on start/cancel/close/navigation, checked after every await
  (the `writeToken` pattern, including the #7 lessons: reset on view/doc navigation).
- State: `nlCaptureLoading/nlCaptureFields/nlCaptureDropped/nlCaptureRaw/nlCaptureError`,
  `nlFilterLoading/nlFilterSource/nlFilterWarnings/nlFilterError`.
- **Chord handling**: ⌘/Ctrl+Enter checked BEFORE the plain-Enter branch; ignored during IME
  composition (`event.isComposing`). Capture re-renders (loading → preview) restore focus +
  caret to the input like the filter input handler does.

## Verification

- **Backend tests** (writingActions.test.js pattern): pure-module (prompt grounding bounded,
  raw-text-first-line, weekday correctness, every coercion rule, audit lint cases) + route
  tests with scripted chat — clean JSON, fence-wrapped JSON, prose-embedded JSON,
  no-chat-model, generation-failed, 400-on-empty, model-field discipline.
- **Frontend tests**: `mergeNlCapture` sigil-override rules; captureShorthand untouched.
- **Browser**: extend `server/chat/fake.js` with a generic directive — if the last user
  message contains `>>{...}`, the completion is exactly that JSON (works for any
  JSON-output feature; without a directive the echo exercises the degraded path). Verify
  both flows + degraded/abort paths against the fake backend; then a manual pass against a
  real provider (fake proves plumbing, not extraction quality).
- Out of scope (noted for later): a pinned phrase→expected eval set for prompt regressions;
  non-English NL input behavior; aggregate degraded-rate telemetry in Settings.
