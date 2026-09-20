# Complete workspace export and lifecycle-aware Markdown

The export audit found that Markdown omitted trust, attribution, code/external references and
lifecycle status, while its label incorrectly promised active-only content. The user authorized
fixing the gaps and publishing the combined Inbox/Library/export work.

Keep the existing Markdown ZIP path, extending its versioned front matter with document identity,
trust, agent attribution, lifecycle and archived timestamps, code/external references and graph
snapshot evidence. Offer an explicit include-archived checkbox. Describe default scope as
nonarchived documents, including labeled superseded/deprecated records. Share serialization
between server and browser to prevent drift; quote YAML special/typed scalars safely.

Add Full workspace backup as a format in the same export dialog. It always covers all projects
and all committed SQLite data: documents/types/templates/memory, tasks/checklists/history,
project metadata, links/citations, runbook runs, settings/index and mutation/Inbox receipts.
The ZIP contains a coherent validated SQLite snapshot, a checksummed manifest, bundled starter
resources and restore instructions. Clearly disclose saved provider credentials and the exclusion
of unsaved/browser-local state. Use the existing ZIP save APIs on desktop and browser.

Restore full state through a shipped offline command that validates the expected checksum,
integrity and foreign keys, refuses existing destinations, and preserves restrictive file modes.
Never replace an open live database through an HTTP upload. The supported full-fidelity recovery
path is the backup/restore pair; Markdown intake continues to create plain notes and says so.

Required evidence: real production ZIP fields and archived/retired content, coherent backup during
writes, full table equivalence after restore, successful restored app startup and Inbox receipt
replay/undo, corrupted/wrong-checksum/occupied-destination refusal, UI save/cancel/format scope,
keyboard/reflow checks, full unit/check/browser and GitLab native/package/release gates.
