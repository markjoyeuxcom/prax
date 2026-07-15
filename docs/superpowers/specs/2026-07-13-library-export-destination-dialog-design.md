# Library Export Destination Dialog Design

**Date:** 2026-07-13
**Status:** Implemented

## Decision

Library export is an intentional file operation, not an immediate navigation. Every Library
Markdown export entry point opens one shared dialog before work begins. The dialog makes the export
scope, generated ZIP filename, included content, and destination behavior explicit.

The dialog offers the entire active Library or one owning project. Project choices include every
managed project because completed projects may still own active documents. Prax exports one Markdown
file per active document; this is a portable content export, not the authoritative database backup.

## Destination behavior

Destination selection depends on the host's safe file APIs:

- Desktop Prax uses an operating-system Save dialog. A narrowly scoped Tauri command accepts only a
  suggested ZIP filename and archive bytes, prompts the user for the path, and writes only after the
  user confirms that path. Because the sidecar UI is a localhost remote origin, the command is
  declared in the application ACL manifest and is the only custom command granted by the localhost
  capability. No arbitrary caller-supplied path is accepted.
- Browsers supporting the File System Access API use `showSaveFilePicker`. The picker opens directly
  from the user's submit gesture, before network work, preserving the browser's user-activation
  requirement. Prax then fetches and writes the archive to that handle.
- Other browsers cannot choose an arbitrary destination folder. The dialog labels its action
  `Download ZIP` and explains that the browser's Downloads / “Ask where to save” preference controls
  the destination.

Cancelling either real picker is neutral: the dialog stays open and does not claim failure. While an
archive is being fetched or written, scope and dismissal controls are locked. A failed fetch/write
keeps the dialog open with an announced error. A successful picker write closes it and reports the
saved filename; a fallback download reports only that the download started.

## Accessibility and continuity

The export surface is a labelled modal with initial focus, contained Tab navigation, Escape and
scrim dismissal while idle, pending-state dismissal protection, and focus return to the exact entry
point. The generated filename updates when scope changes. All dynamic project names and errors are
HTML-escaped.

## Evidence

- Pure archive-save tests prove picker-before-fetch ordering, byte writes, cancellation, desktop
  invocation, fallback download semantics, filename generation, and HTTP failures.
- Pure renderer tests prove scope choices, truthful platform messaging, filenames, disabled pending
  state, errors, and escaping.
- Production-server browser coverage proves the Library button opens the dialog, a project can be
  selected, the chosen archive is written through a browser save handle, and keyboard modal behavior
  remains correct.
- Rust tests cover suggested-filename normalization; desktop compilation proves command and plugin
  integration.

## Completion evidence

- `npm test`: 161/161 unit, route, repository, SQLite, frontend, MCP, CLI, and contract files passed,
  including the desktop command-permission linkage/least-privilege regression.
- `npm run check`: passed, including the archive saver and dialog renderer.
- `npm run test:e2e`: 49/49 production-server browser journeys passed; three cover Library export.
- `npm run verify:portable`: 200 tasks and 150 checklist items round-tripped with the pinned digest.
- `npm run verify:restore`: live-WAL `large` and historical `0009` destructive restores passed at
  `0014_add_task_import_operations.sql`.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: native filename test passed.
- `cargo check --manifest-path src-tauri/Cargo.toml --all-targets`: passed with the dialog plugin,
  registered command, capability configuration, and atomic save implementation.

## Desktop permission regression, 2026-07-13

The first live desktop attempt exposed a gap that compilation alone could not catch: Tauri rejects
custom-command IPC from a remote origin unless the application manifest declares the command and a
matching remote capability grants its generated permission. Prax is served from a localhost sidecar,
so the registered Rust handler was unreachable even though `cargo check` passed. The build now
generates only `allow-save-library-export`, and the localhost capability explicitly grants that one
permission. A contract test keeps the Rust handler, build manifest, and capability in lockstep. Tauri
string rejections are also retained in the visible dialog instead of collapsing to a generic error.
The repaired configuration generated the expected application permission/schema and passed the Rust
unit test, all-target check, and a fresh debug desktop build.

## macOS dialog responsiveness regression, 2026-07-13

The first permission-correct live attempt opened the macOS Save sheet but left it under a spinning
wait cursor. The command was synchronous and used `blocking_save_file`, so Tauri executed the call on
the UI-thread command path and starved the sheet's event loop. The command is now async, opens the
native dialog through its callback API, and performs callback waiting plus atomic persistence away
from the UI thread. The desktop contract test rejects any return to `blocking_save_file` and requires
the async handler, callback dialog, and blocking worker boundary together.
