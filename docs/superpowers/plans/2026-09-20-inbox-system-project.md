# Inbox implementation plan

1. Record the updated user preference and supersede the obsolete no-Inbox memory.
2. Add migration 0032 to restore/adopt Inbox without touching its contents or
   reusing a deleted ID. Update declared migration-boundary evidence.
3. Share the protected-project definition between HTTP routes and UI. Align
   cards, header actions and system-role hints; include defaults in the demo.
4. Add migration/API/frontend regressions and a production browser journey.
5. Run the full unit/contract suite and syntax/bundle checks, then affected
   browser journeys. Review the diff against the pre-task snapshot, document
   actual results and complete the Prax task. No release is part of this request.
