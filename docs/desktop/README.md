# Prax Desktop — Planning Docs

Architecture and historical planning material for Prax's shipped Tauri desktop application. The
current build, lifecycle, release, update, and recovery contract lives in [`BUILD.md`](BUILD.md);
the design briefs and phased checklist below explain how that implementation was reached.

## Decisions so far

- **Shell:** Tauri (system webview, small installers, low memory) rather than Electron.
- **Backend:** keep the existing Node/Fastify server, run it as a Tauri **sidecar**; the
  webview points at `http://127.0.0.1:<port>`. Frontend stays a static bundle served by
  Fastify, so the web app, MCP server, and CLI keep sharing one backend.
- **Database:** **embedded SQLite** (in-process, single file) — lowest memory/footprint and no
  separate database process. FTS5 handles full-text retrieval; semantic providers degrade
  explicitly when none is configured.
- **Aesthetic:** drop the terminal/console look entirely for a modern, native desktop
  GUI/UX; the visual design is briefed out with full creative freedom.

## Files

- [`design-brief.md`](design-brief.md) — prompt for the design tool (visual/UX mockups +
  design system). Run this **first**.
- [`engineering-prompt.md`](engineering-prompt.md) — prompt for building the Tauri +
  embedded-SQLite desktop app. Run **after** the new frontend design lands in `public/`.
- [`checklist.md`](checklist.md) — phased execution checklist (design → frontend →
  SQLite data-layer rewrite → Tauri wrapper → packaging → optional `sqlite-vec`).

## Historical implementation order

1. Run `design-brief.md` → get the new frontend design.
2. Implement the design into `public/`.
3. Run `engineering-prompt.md` → SQLite data-layer rewrite + Tauri packaging.
4. (Optional, Phase 2) add `sqlite-vec` to restore semantic search.
