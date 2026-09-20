# Implementation plan

1. Reproduce Library Back and introduce a bounded return snapshot behind the existing
   save barrier; cover filtered and archived views and editor links.
2. Add a shared Inbox classification/aging model, server paging, transactional action
   receipts with guarded undo, and a read-only reviewed-suggestion endpoint.
3. Build Inbox views and the processing dialog with recoverable draft/operation state,
   explicit outcomes, undo, candidate review and responsive keyboard access.
4. Connect Inbox counts and weekly-review links; keep ordinary task views accessible.
5. Add adverse-path tests, run required suites and browser journeys, review the task
   diff against its starting snapshot, update docs and durable memory, and close tasks.
