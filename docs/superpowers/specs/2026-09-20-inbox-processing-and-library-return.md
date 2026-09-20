# Inbox processing and Library return

The user approved all four Inbox follow-ups and reported that opening a filtered
Library document and using Back loses the previous view.

## Inbox

Inbox gains a To process view containing open tasks and active loose notes, oldest
first, and a separate Reviews view for documents tagged `weekly-review`. The badge
and aging summary count pending tasks and notes, not retained reviews. Existing task
list/board/backlog/archive views stay available. Collections declare totals and have
an explicit load-more path.

Process Inbox shows one item with its source text and an explicit destination. File
to a project, optionally plan a task for a date, complete a task, keep a capture as
reference, archive, or skip. Filing requires a destination outside Inbox. Keeping a
task as reference creates an unverified linked document and archives the original;
undo retains the generated document in Archive and restores the original task.
References and task successors are never silently deleted.

Actions use durable operation IDs, compare the exact observed source fingerprint,
and commit changes, activity and receipts together. Replay returns the current result;
changed intent conflicts and deleted results are not recreated. Undo checks the source
and any generated result before restoring only fields changed by the operation. Later
changes prevent undo with an explicit conflict. Recurring completion keeps the normal
recurrence planner. No model is involved in normal processing.

An optional Suggest button uses the configured answer model on the selected item and
a bounded set of real project/candidate summaries. Suggestions name validated existing
projects/types and possible duplicates; they never mutate data. The person reviews
and chooses whether to use the suggestion, then explicitly applies the action. Missing
providers, invalid output, omitted candidates and stale suggestions are disclosed.
Possible duplicates can be opened; merging is not automatic.

Weekly review counts pending Inbox tasks and notes, excludes saved reviews, and includes
a link to the processing view. The UI validates and handles only the fixed internal
Inbox link. Model output cannot create arbitrary application commands.

## Library return

Capture the originating Library filters, query/mode, sort/layout, collection window,
loaded semantic results and scroll before opening the editor. Back and the Library
breadcrumb restore that context after the existing draft-save barrier succeeds.
Editor-to-editor links keep the original return target. An Inbox document returns to
Inbox. Explicit new Library views still reset as intended. In-flight stale responses
must not replace the restored view; a pending semantic search is restarted if needed.

## Evidence

Backend tests cover receipts, conflict/replay/delete, concurrent intents, undo with
later edits, preservation of provenance, recurring completion and reference creation,
pagination/aging, candidate bounds and invalid/unavailable AI. Frontend tests cover
queue grouping, recovery state and return snapshots. Production browser journeys cover
filing/scheduling/reference/undo, reviewed suggestions, reload/failure recovery, saved
reviews, weekly links, Library facets/search/scroll/back and failed-save navigation.
Use narrow widths, keyboard controls and automated accessibility checks. Run the full
unit/contract suite and syntax/bundle checks. Publication is a separate release task.
