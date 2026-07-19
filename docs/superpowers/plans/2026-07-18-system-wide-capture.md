# System-Wide Capture Implementation Plan

**Goal:** Capture a task from anywhere on the desktop — global hotkey or tray click summons a
tiny capture bar that writes to the Inbox through the existing exact-once pipeline, without
switching to (or even opening) the main Prax window.

**Roadmap:** [Workflow & Self-Organisation Roadmap](2026-07-18-workflow-selforganisation-roadmap.md) · item 1
**Status:** Proposed

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

- [ ] Add `tauri-plugin-global-shortcut = "2"` and the core `tray-icon` feature to
      [src-tauri/Cargo.toml](../../../src-tauri/Cargo.toml); add matching capability
      permissions under `src-tauri/capabilities/`.
- [ ] Tray icon with menu: **Capture** (summon bar), **Open Prax** (show/focus main window),
      **Quit**. Main-window close hides to tray instead of exiting (preference-gated later).
- [ ] Register the global shortcut after `ServerPhase::Ready`; on failure set a
      `shortcut_status` the capture window can read (Tauri command), and reflect it in the
      tray tooltip. Registration failure is a degraded state, never a crash.
- [ ] `public/capture.html` + `public/js/captureBar.js`: single text input, Enter submits,
      Esc hides; posts to `POST /api/tasks` with a client-generated id and `project: 'inbox'`;
      failure renders inline and keeps the text.
- [ ] Summon → always-on-top window at top-center, input focused; blur hides (text
      preserved for next summon via the recovery store).

### Increment 2 — shorthand + capture parity

- [ ] Wire `captureShorthand.js` token parsing into the bar (`#project @label`, priority,
      due tokens) with the same inline token pills the in-app capture shows.
- [ ] Show the resolved destination ("→ Inbox" / "→ #project") before submit; unknown
      project tokens fall back to Inbox with the token kept in the title, same as in-app.
- [ ] Adopt the capture-recovery owner token so an in-app tab and the capture bar cannot
      clobber each other's crash drafts (guard logic already exists in
      `taskCaptureRecovery.js`).

### Increment 3 — polish + packaging

- [ ] Preference (Settings ▸ Appearance or a new Desktop section): customize/disable the
      shortcut; persists via the shell (shortcut is a shell concern, not `app_settings`).
- [ ] Per-OS packaging pass: icon set for the tray (light/dark), macOS accessory-window
      behavior, Windows/Linux tray quirks; document in the packaging notes.
- [ ] CHANGELOG entry; update [docs/](../../) desktop docs with the shortcut and tray
      behavior.

## Verification

- Unit: shorthand parsing reuse (no new parser), capture payload building, failure-path
  text retention, owner-token adoption (`node --test`).
- E2e: `capture.html` served by the plain server is drivable in Playwright — cover submit
  success, server-error retention, Esc-preserves-draft. Tray/shortcut themselves are
  shell-side and not Playwright-reachable: cover with a documented manual check per OS
  (the packaged-desktop-reliability plan's precedent).
- Gates: `npm test`, `npx playwright test`; no schema change, so no migration pins or
  portable/restore drills are touched.

## Risks / notes

- Global shortcuts are contended: default must be uncommon, failure loud but non-fatal.
- The capture window must never block on the main window's state — it talks only to the
  sidecar HTTP API.
- Tauri v2 tray + global-shortcut are stable plugin-supported paths; pin versions alongside
  the existing `2.x` tree.
