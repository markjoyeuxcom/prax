# Inbox processing and Library return review — 2026-09-20

Implemented in the checkout after v0.36.1, preserving the earlier default-system Inbox
work. This report does not claim a published release or an installed desktop update.

## Result

- Inbox has separate **To process** and **Reviews** tabs alongside its existing task views.
  Pending counts include incomplete tasks and active loose notes, exclude saved weekly
  reviews, and report capture age. New weekly reviews link directly to processing.
- **Process Inbox** supports filing into an owning project, an optional task planning date,
  completion with normal recurrence, linked reference creation, archive and skip.
  Task references retain description, notes and checklist, start unverified, and archive
  the original task. Document filing retains its content and trust.
- Decisions commit atomically with a receipt. Lost responses reuse the same operation ID;
  retries cannot repeat conversion or completion. Undo refuses changed or deleted sources
  and generated records, and archives generated copies rather than deleting them.
  Unfinished decisions and the last undo ID survive reloads in the same browser tab.
- AI suggestions use the configured answer model, disclose bounded coverage, validate IDs
  and types, and fill a form only after the person selects **Use suggestion in form**.
  Possible duplicates open for inspection; there is no automatic merge or trust change.
- Editor Back and its breadcrumb restore the originating Library filters, query, sorting,
  grouping, layout, loaded result window, scroll and document focus. Linked and archived
  documents preserve their origin; failed saves retain both draft and origin. Semantic
  results refresh after source/trust changes. The Library sidebar keeps its existing fresh
  navigation behavior. Documents opened in Inbox return to the originating Inbox tab.

## Verification

- `npm test`: **2,216 passed**, zero failed/skipped.
- `npm run check`: passed; entry-point syntax and committed skill bundles current.
- `git diff --check`: passed.
- Production SQLite Chromium journeys: **30 passed** in 28.2 seconds. Reviewed Parley run
  `b4188de8-8847-45e1-a54b-99dabe93d80b`, captured exit status 0, not cancelled,
  output not truncated. Test server used an isolated in-memory database, not the live app.
- Browser specs: `inbox-processing`, `inbox-system-project`, `library-return`,
  `library-navigation`, `library-editor-reflow`, `editor-autosave`, `review-repairs`,
  and `weekly-review`. The Inbox dialog passes axe WCAG A/AA checks in light/dark at
  1440px and 360px without exclusions, with keyboard containment and no horizontal overflow.
- Backend evidence covers pagination/classification, guarded filing/scheduling, receipt
  replay, concurrent decisions, SQLite rollback after injected link failure, reference
  preservation, recurrence, source deletion, generated-document edits blocking undo, restart
  persistence, malformed/unknown AI output, unavailable providers, sanitized errors,
  source truncation and changes during generation. Frontend evidence covers lost responses,
  reload recovery, single-flight writes, honest refresh failure, stale AI cancellation,
  form-only suggestions and nonaliasing Library snapshots.

The first browser pass found fixture timing/text assumptions; these were corrected against
observable UI state. Tests also exposed a late AI response reviving a finished pass and a
brief unlocked interval during post-commit refresh; both have regression coverage. A prior
review test caught the unintended sidebar navigation change, which was removed.

## Review boundaries

Reviewed current edits against a snapshot taken before this task to avoid folding earlier
release work into this change. The new migration is additive; no live captures or personal
notes were moved or deleted. Source guards include related checklist/activity/link state.
Metadata-only filing preserves human content attribution, generated references remain
unverified, and unknown outcomes never authorize a new operation identity.

Real vendor answer quality was not benchmarked; model validation used injected backend
responses and the browser exercised reviewed suggestions plus real no-provider fallback.
This is browser/SQLite evidence, not a new native package build, human assistive-technology
certification or large-workspace performance claim. Candidate generation considers a disclosed
subset, and a browser-tab decision checkpoint is not durable after closing the tab. The
receipt itself persists in SQLite. Packaging/publishing/installing remain release work.
