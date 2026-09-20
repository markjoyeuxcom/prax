# Default system Inbox

Inbox is a dependency of context-free capture and new weekly-review documents, but
v0.36.1 only protects Memory. A person can remove or archive Inbox and break those
flows. The current user decision restores Inbox as a default protected project.

## Behaviour

- Fresh installations contain Inbox and Memory. Upgrades restore a missing Inbox,
  or reactivate and relabel the existing `inbox` row while retaining its ID and
  all content and relationships. A replacement gets a new ID; a deleted ID is
  never reused. An existing row with another slug is never repurposed.
- Inbox and Memory use the same server/UI system-project policy. Project rename,
  metadata/status changes, archive and permanent deletion return 403. Tasks and
  documents inside them remain editable, movable and removable normally.
- Inbox stays pinned in navigation. Project cards and headers describe the
  system role; no rename, lifecycle or Ops controls promise forbidden edits.
- Inbox is for unassigned capture and workspace-level reviews. Known work goes
  directly to its owning project; shared conventions belong in Memory.
- Weekly review continues to save in Inbox. This change does not move existing
  reviews or regenerate their content. It needs no AI or additional background work.

## Evidence

Migration cases: fresh database, deleted Inbox, renamed/archived Inbox with linked
content, a manually recreated Inbox, original ID occupied by another project,
unchanged healthy Inbox, and repeat startup. API cases exercise both protected
projects while ordinary project deletion and content moves still work. Verify
capture and weekly review after upgrade. Browser evidence covers header/card
controls, pinned navigation, mobile width, capture and weekly review.

## Proposed follow-up improvements

These are recommendations, not part of the implemented protection change:

1. A focused Process Inbox flow: choose an owning project, plan work, complete
   it, keep it as reference, or archive it. Reuse existing mutation/undo handling.
2. Separate items awaiting triage from saved workspace reviews. Include loose
   notes in triage; stored weekly reviews should not inflate an unprocessed badge.
3. Show oldest unprocessed age and link weekly-review aging findings to triage.
4. Optional agent suggestions for destination/type/duplicates, reviewed before
   applying. Preserve provenance and unverified status; never move notes silently.
