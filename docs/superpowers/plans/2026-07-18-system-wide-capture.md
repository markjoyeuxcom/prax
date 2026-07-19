# System-Wide Capture Implementation Plan

**Goal:** Capture a task from anywhere on the desktop — global hotkey or tray click summons a
tiny capture bar that writes to the Inbox through the existing exact-once pipeline, without
switching to (or even opening) the main Prax window.

**Roadmap:** [Workflow & Self-Organisation Roadmap](2026-07-18-workflow-selforganisation-roadmap.md) · item 1
**Status:** Increments 1–2 shipped; increment 3 (shortcut preference, per-OS packaging pass) open

## Current state

- The Tauri v2 shell ([src-tauri/src/lib.rs](../../../src-tauri/src/lib.rs)) spawns the bundled
  Node/Fastify sidecar on an OS-assigned localhost port, waits for the structured readiness
  line, probes `/readyz`, and holds the port in `ServerPhase::Ready(port)`. Plugins present:
  `dialog`, `shell`, `single-instance`. **No global-shortcut plugin, no tray.**
- Capture in the web app: idempotent `POST /api/tasks` (client-generated UUID → exact-once on
  retry), shorthand tokens in [captureShorthand.js](../../../public/js/captureShorthand.js)
  (`#project @label !priority` etc.), NL parsing via `POST /api/tasks/nl-capture` (degrades
  honestly when no chat model), crash-draft recovery in `taskCaptureRecovery.js`.
- The system Inbox project is seeded and guarded server-side; `project: 'inbox'` resolves.

## Design decisions

1. **The capture bar is a second webview window, served by the sidecar** (e.g.
   `/capture.html`), not a separate asset bundle — it reuses `captureShorthand.js` and the
   API client verbatim, and the shell already knows the port. One rendering pipeline, no
   drift between in-app and system-wide capture semantics.
2. **Tray-first, shortcut-second.** The tray icon + "Capture" menu item is the always-works
   path; the global shortcut (default `Cmd/Ctrl+Shift+Space`) is an accelerator on top.
   Shortcut registration can fail (another app owns it) — that failure must be visible, not
   silent: the tray tooltip and the capture window footer show "shortcut unavailable".
3. **Window behavior:** small, centered-top, always-on-top, skip-taskbar, hidden on blur/Esc,
   recreated cheap. Summoning focuses the text field. Closing the main window does not exit
   the app while the tray is alive (existing single-instance behavior extended).
4. **Never lose a capture.** Submit uses the existing idempotent create with a client id;
   a failed POST keeps the text in the field with the error inline, and the crash-draft
   recovery store also covers the capture window (its own owner token — the multi-tab owner
   guard already exists). Dismissing with text present stores a draft, not a discard.
5. **Scope guard:** slice 1 is plain text + shorthand tokens → Inbox/tokened project. NL
   parse preview and project pickers come later; no offline queue (the shell owns the server
   process — if the shell is up, the server is up).

## Work

### Increment 1 — tray + shortcut + minimal capture window

- [x] Add `tauri-plugin-global-shortcut = "2"` and the core `tray-icon` feature to
      [src-tauri/Cargo.toml](../../../src-tauri/Cargo.toml); `hide_capture_window` command
      in build.rs + a dedicated `desktop-capture` capability for the capture window.
- [x] Tray icon with menu: **Capture task**, **Open Prax** (shows or rebuilds the main
      window), **Quit Prax**. The sidecar-served main window closes to the tray; recovery
      windows keep close-to-exit so a failed startup cannot leave a hidden zombie. macOS
      dock reopen and second-launch both funnel through `show_main_window`.
- [x] Global shortcut (`CmdOrCtrl+Shift+Space`) registered after the server is ready;
      registration failure surfaces in the tray tooltip and the tray path keeps working.
      *(Shipped tooltip-only; the capture-window footer status was dropped as redundant.)*
- [x] `public/capture.html` + `captureBar.js`/`captureBarCore.js`: Enter submits with a
      client-generated id (exact-once retry identity kept while text is unchanged; dropped
      on deterministic 4xx), Esc hides via IPC, failure renders inline and keeps the text.
- [x] Summon shows the always-on-top window (created once, then shown/hidden), input
      focused per summon; blur hides; drafts survive via localStorage.

### Increment 2 — shorthand + capture parity

- [x] `captureShorthand.js` token parsing wired in (`#project @label !priority`, due
      keywords/ISO dates) with a live destination hint line.
- [x] Resolved destination shown before submit; unknown project tokens fall back to Inbox
      with the token restored into the title.
- [x] Draft isolation from the in-app capture: the bar uses its OWN storage key
      (`prax.captureBar.draft`) instead of adopting the shared owner token — the two
      surfaces can never clobber each other because they never share a slot. *(Deliberate
      simplification of the planned owner-token adoption; strictly safer.)*

### Increment 3 — polish + packaging

- [ ] Preference (Settings ▸ Appearance or a new Desktop section): customize/disable the
      shortcut; persists via the shell (shortcut is a shell concern, not `app_settings`).
- [ ] Per-OS packaging pass: icon set for the tray (light/dark), macOS accessory-window
      behavior, Windows/Linux tray quirks; document in the packaging notes.
- [ ] CHANGELOG entry; update [docs/](../../) desktop docs with the shortcut and tray
      behavior.

## Verification

- Unit: `tests/frontend/captureBarCore.test.js` — 7 tests (shorthand resolution, unknown
  token survival, token-only guard, payload assembly, hint, draft round-trip + broken
  storage). All pass.
- E2e: `tests/e2e/capture-bar.spec.js` — 4 journeys: shorthand create, failed-submit
  retention + exact-once retry (no duplicate), draft-survives-reload, unknown-token →
  Inbox. All pass against the production server.
- Rust: `cargo check` clean (no warnings) and the 5 existing shell unit tests pass on the
  linux toolchain (sidecar binary stubbed for the check — gitignored). **The
  tray/shortcut/window behavior itself needs the documented manual check on macOS at next
  packaged build** (Playwright cannot reach the shell), per the packaged-desktop
  precedent.
- Gates: `npm test`, `npx playwright test` — green; no schema change, so no migration pins
  or portable/restore drills touched.

## Risks / notes

- Global shortcuts are contended: default must be uncommon, failure loud but non-fatal.
- The capture window must never block on the main window's state — it talks only to the
  sidecar HTTP API.
- Tauri v2 tray + global-shortcut are stable plugin-supported paths; pin versions alongside
  the existing `2.x` tree.
