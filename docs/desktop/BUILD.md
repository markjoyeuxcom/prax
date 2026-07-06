# Building the Prax desktop app

The desktop app is a Tauri 2 shell (`src-tauri/`) around the Node/Fastify
server, which runs as a **sidecar**: the bundled Node runtime executes
`resources/app/server/index.js` on a free localhost port, and the webview
loads the served app once `/readyz` answers. The database is an embedded
SQLite file — a packaged install has **zero external dependencies**.

## Prerequisites

- Node.js ≥ 22.5 (the sidecar is a copy of *your* `node` binary; use the
  version you want to ship — we develop on Node 24)
- Rust (stable) — `rustup.rs`
- Platform toolchains: Xcode Command Line Tools (macOS) or the MSVC Build
  Tools + WebView2 runtime (Windows)

## Develop

```bash
npm install
npm run desktop:dev
```

`tauri dev` first runs `scripts/prepare-sidecar.mjs`, which:

1. stages `server/`, `public/`, `mcp/`, `cli/` and the **production**
   `node_modules` into `src-tauri/resources/app/` (`npm ci --omit=dev`), and
2. copies the current `node` executable to
   `src-tauri/binaries/prax-server-<target-triple>` (Tauri's sidecar naming).

Both locations are generated and git-ignored. A native window opens on the
Prax splash and hands over to the app when the server reports ready.

## Build installers

```bash
npm run desktop:build
```

Outputs land under `src-tauri/target/release/bundle/`:

- macOS: `.app` and `.dmg`
- Windows: `.msi` (WiX) and `.exe` (NSIS)
- Linux: `.deb` / `.rpm` / `.AppImage`

Cross-compilation is not supported — build each platform on that platform
(CI matrix or per-machine builds).

## Where user data lives

| Platform | Location |
|---|---|
| macOS | `~/Library/Application Support/com.moomora.prax/` |
| Windows | `%APPDATA%\com.moomora.prax\` |
| Linux | `~/.local/share/com.moomora.prax/` |

Contents: `prax.db` (plus `-wal`/`-shm` WAL siblings) and `logs/server.log`
(the sidecar's output). Back up by copying the database file or via the
JSON/Markdown exports — see [../backup-restore.md](../backup-restore.md).

## Lifecycle guarantees

- **Port**: the shell binds `127.0.0.1:0` to pick a free port and passes it to
  the sidecar via `PORT`; a port collision therefore cannot happen at launch.
- **Single instance**: `tauri-plugin-single-instance` focuses the existing
  window instead of letting a second process open the same database.
- **Shutdown**: the sidecar is killed when the app exits. SQLite WAL is
  crash-safe by design, and the server also closes the database cleanly on
  SIGTERM/SIGINT for the non-desktop deployments.
- **Startup failure**: if `/readyz` never answers within 30s, the splash
  window shows the error and points at `logs/server.log`.

## Headless Linux verification (CI)

The Linux build runs headless for smoke tests — GTK needs a display *and* a
DBus session or startup blocks before the shell code runs:

```bash
dbus-run-session -- xvfb-run -a ./src-tauri/target/release/prax
```

Watch for `prax.db` and `logs/server.log` appearing under
`~/.local/share/com.moomora.prax/` — that proves the sidecar lifecycle
(WebKitGTK additionally requires the usual VM workarounds for *rendering*,
but the server boots regardless because it starts before any webview work).

## Signing & notarization (release builds)

Unsigned dev builds run locally (macOS: right-click → Open past Gatekeeper).
For distribution:

- **macOS**: set `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` in
  the environment — Tauri signs and notarizes the bundle during
  `tauri build`. (Developer ID Application certificate required.)
- **Windows**: configure `bundle.windows.certificateThumbprint` (or use
  `signtool` post-build) with a code-signing certificate.
- The Tauri **updater** is not enabled yet; releases are manual downloads.

## Size notes

The installer bundles the Node runtime (~50–110 MB uncompressed depending on
platform) plus ~50 MB of app payload; DMG/MSI compression roughly halves the
download. Trimming to a custom Node build or a compiled single-executable
server is a possible follow-up if size matters.
