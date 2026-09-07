# Building the Prax desktop app

The desktop app is a Tauri 2 shell (`src-tauri/`) around the Node/Fastify
server, which runs as a **sidecar**: the bundled Node runtime executes
`resources/app/server/index.js` and announces its bound loopback port to its Rust parent.
The first launch asks the OS for a free port and persists it in `webview-port` under the app-data
directory; later launches bind that same port so webview drafts, preferences and saved views survive.
On upgrade, the latest child readiness record in `logs/server.log` or its rotated predecessor
recovers the prior origin when no port file exists. A port collision refuses startup and is
reported in the diagnostic log; close the occupying process before retrying. Preserve the port
file with the webview profile rather than deleting it to work around a collision. The webview loads that exact
origin only after `/readyz` answers. The database is an embedded
SQLite file — a packaged install has **zero external dependencies**.

Supported desktop builds and releases target **macOS Apple Silicon**, **Linux x64** and **Linux ARM64**.
Windows and Intel Mac installers are no longer built or released.

## Prerequisites

- Node.js ≥ 24 (the sidecar is a copy of *your* `node` binary; use the
  version you intend to ship)
- Rust (stable) — `rustup.rs`
- Platform toolchains: Xcode Command Line Tools (macOS Apple Silicon), or GTK/WebKitGTK
  development libraries (Linux; see the `apt-get install` list in `.gitlab-ci.yml`)

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

Staging removes any sidecar binary left by another host platform before copying the current target.
It also removes foreign platform/architecture directories from dependencies’ `prebuilds` trees.
This keeps native packagers from trying to resolve Android or other foreign libraries in the desktop payload;
host prebuilds, package JavaScript and metadata are retained. The unused development tests
from `@fastify/send` are omitted as well.
`npm run desktop:verify` then proves version/resource agreement and that the payload contains every
production dependency without development-only packages.

Both locations are generated and git-ignored. A native window opens on the
Prax splash and hands over to the app when the server reports ready.

## Build installers

```bash
npm run desktop:build
```

Outputs land under `src-tauri/target/release/bundle/`:

- macOS Apple Silicon: `.app` and `.dmg`
- Linux x64 and ARM64: `.deb` and `.AppImage` for each architecture

Cross-compilation is not supported — build each platform on that platform
(CI jobs or per-machine builds). Linux ARM64 uses GitLab's hosted `saas-linux-medium-arm64` runner
to stage the ARM64 Node runtime and dependencies, build both installers, and run the same two-launch
runtime smoke as Linux x64 (`saas-linux-medium-amd64`). Tagged releases attach the
architecture-specific installers and checksums. See
[Tauri’s ARM AppImage guidance](https://v2.tauri.app/distribute/appimage/#appimages-for-arm-based-devices).

The macOS package is built by the `desktop-macos-arm64` job on GitLab's hosted Apple Silicon runner
(`saas-macos-medium-m1`, billed at a higher compute-minute factor than Linux). It runs automatically
on release tags but is **allowed to fail**, so a plan or quota that cannot run it never blocks a
release; on merge requests it is manual. To use your own Mac instead, register a runner and change
the job's tag. If the job did not produce the package, build it on a Mac and attach it to the
release:

```bash
npm ci && npm run desktop:build              # .dmg and .app under src-tauri/target/release/bundle/
npm run desktop:smoke                        # two-launch runtime smoke of the built app
glab release upload v0.21.0 src-tauri/target/release/bundle/dmg/Prax_0.21.0_aarch64.dmg
shasum -a 256 src-tauri/target/release/bundle/dmg/Prax_0.21.0_aarch64.dmg   # add to the release notes
```

## Where user data lives

| Platform | Location |
|---|---|
| macOS | `~/Library/Application Support/com.moomora.prax/` |
| Linux | `~/.local/share/com.moomora.prax/` |

Contents: `prax.db` (plus `-wal`/`-shm` WAL siblings) and `logs/server.log`
(the sidecar's output). Back up by copying the database file or via the
JSON/Markdown exports — see [../backup-restore.md](../backup-restore.md).
On macOS/Linux the app-data and log directories are owner-only. The log is rotated to
`server.log.1` when it exceeds 5 MiB; Prax keeps one previous log.

Library ZIP export crosses the desktop boundary through one registered command. The webview passes
the archive bytes and a safe suggested basename, never a filesystem path; Rust opens the native Save
dialog and atomically persists a same-directory temporary file only after the user confirms the
destination. The dialog capability is used inside Rust and is not exposed as a general filesystem
permission to the webview.

The sidecar page is a Tauri **remote origin** even though it is localhost. Rust's navigation policy
allows only the exact `127.0.0.1:<port>` announced by the child plus the bundled recovery origin;
a different local process/port is not trusted. The served application and bundled recovery page both
use self-only script CSP; framing, MIME sniffing, and referrer leakage are blocked. `src-tauri/build.rs`
therefore declares `save_library_export` in the application ACL manifest, and
`capabilities/remote.json` grants only its generated `allow-save-library-export` permission alongside
the existing titlebar controls. Registering an invoke handler without both ACL pieces compiles but is
rejected at runtime before the Save dialog opens.

The export command is asynchronous. It uses the dialog builder's callback API and waits/writes on a
blocking worker, never the desktop UI event loop. A synchronous command combined with
`blocking_save_file` can display a macOS sheet while starving its controls and producing the spinning
wait cursor; the desktop contract test explicitly forbids that combination.

## Menu bar, quick capture, and closing the window

The main window **closes to the menu bar**: the red close button hides it and the sidecar keeps
running, so the capture shortcut and the memory skills keep working. Reopen it from the Dock or
the menu-bar icon (**Open Prax**); quit from the menu-bar icon (**Quit Prax**) or ⌘Q, which runs
the graceful shutdown above. The recovery window shown after a failed start keeps close-to-exit.

**Capture task** in the menu bar (or ⌘⇧Space, changeable in Settings) summons a small always-on-top
bar served by the sidecar at `/capture.html`. Enter saves the text as a task in **Inbox**
(`#project`, `@label`, `!high` and a date word route it elsewhere); Esc or losing focus hides it
and keeps any unsent text as a draft. The main window refetches its collections when it regains
focus, becomes visible, or navigates, and the bar announces each save over a same-origin channel,
so a capture appears without a reload. The capture window is transparent so only the rounded bar
is drawn; on macOS that needs `app.macOSPrivateApi` in `tauri.conf.json` together with the
`macos-private-api` Tauri feature, which is why both are enabled. The window also draws no
window shadow: macOS renders that shadow for the whole rounded 640×128 frame, which on a
transparent window shows as a pale rounded slab with an outline behind the bar, so the bar
paints its own CSS shadow and the window's is off.

## macOS input behavior

The app opts its own defaults domain out of the press-and-hold accent picker
(`ApplePressAndHoldEnabled = false` for `com.moomora.prax`) so held keys
repeat in the Markdown editor. The system-wide setting and every other app
are untouched; restore the picker for Prax with
`defaults delete com.moomora.prax ApplePressAndHoldEnabled`.

## Lifecycle guarantees

- **Port**: Node binds `127.0.0.1:0` itself and reports the resulting port on its child stdout. There
  is no released-port interval for another process to win.
- **Single instance**: `tauri-plugin-single-instance` focuses the existing
  window instead of letting a second process open the same database.
- **Shutdown**: ordinary desktop quit writes a private `shutdown` command to the child stdin and
  waits up to five seconds for Fastify and SQLite to close. A force-kill is only the bounded fallback.
  Plain-server deployments retain their `SIGTERM`/`SIGINT` path.
- **Recovery**: startup timeout, malformed readiness, early exit, and a later sidecar crash all show
  the bundled recovery screen with the exact log path and **Restart Prax**. Restart uses the same
  graceful barrier if the child is still alive.
- **Draft truth**: WAL protects committed database work after a crash. It does not make an unsaved
  in-memory edit durable; editor/task draft recovery remains the last-mile protection for that state.

## Dual-OS working tree (macOS + Linux VM)

If this checkout is shared between macOS and a Linux VM (e.g. OrbStack), npm
installs native binding packages (`@tauri-apps/cli-*`, `@esbuild/*`) only for
the platform that ran the last install — the other OS then fails with
"Cannot find native binding". Don't follow the error's advice to delete the
lockfile; instead run:

```bash
npm run fix:bindings
```

which additively installs the bindings for **both** platforms without
touching `package.json` or the lockfile. Re-run it whenever a fresh
`npm install`/`npm ci` prunes the foreign-platform copies.

## Headless Linux verification (CI)

The Linux build runs headless for smoke tests — GTK needs a display *and* a
DBus session or startup blocks before the shell code runs:

```bash
npm run desktop:build -- --no-bundle
npm run desktop:smoke
```

The harness creates an isolated temporary app-data directory and launches the release binary under
DBus/Xvfb when necessary. It requires all migrations plus seed projects, inserts a persistence
sentinel, launches the package a second time against the same app data, and succeeds only when the
sentinel remains and both sidecars report application-controlled zero-code exits. The temporary
directory is removed on success and retained in the error message on failure.

## Releases and updates

CI runs on GitLab (`.gitlab-ci.yml`). Every merge request and push to `main` runs the Node checks,
the unit and contract suite, the dependency audit and the browser suite; the Linux desktop jobs are
**manual** there (they cost about fifteen compute minutes each) and automatic on release tags. A
release tag `vX.Y.Z` or `vX.Y.Z-rc.N` is the distribution gate: the quality gate, both Linux
desktop builds with their packaged-runtime smoke and the multi-arch container must succeed before
one GitLab release is created with the Linux packages, `SHA256SUMS`, and the changelog section as
its body. A missing Linux package is fatal. The macOS package is attached afterwards as described
above; the release notes say so.

Prax currently uses a deliberate installer update, not an in-app updater:

1. Verify the package against `SHA256SUMS` and read its release notes.
2. Quit Prax. Copy the complete app-data directory above to a dated backup location (or use the
   online backup command from [../backup-restore.md](../backup-restore.md) while the app is running).
3. Install the newer package over the application. Do not replace or move the app-data directory.
4. Launch Prax, let migrations finish, and inspect representative recent work.
5. If validation fails, quit; restore the dated database backup; then reinstall the prior package.

The stable application identifier keeps user data outside the replaceable app bundle. A future
automatic updater must add signed update manifests, a durable signing-key rotation runbook, and
platform signing credentials first; an unauthenticated updater is not a safe convenience feature.

## Unsigned distribution

Apple Developer ID signing and notarization are outside Prax's distribution scope.
Builds and installers may be distributed unsigned; signing credentials are not a
release-readiness requirement for this project.

Release notes must clearly state that the installers are unsigned and not notarized.
Publish SHA-256 checksums with the artifacts. These verify download integrity against
the release; they are not a platform-signing identity. macOS may require the person to
approve opening an unsigned application.

Updates remain deliberate installer replacements with a backup and rollback path as
described above. An automatic updater is a separate feature with its own authentication
and signing requirements.

## Size notes

The installer bundles the Node runtime (~50–110 MB uncompressed depending on
platform) plus ~50 MB of app payload; installer compression reduces the
download. Trimming to a custom Node build or a compiled single-executable
server is a possible follow-up if size matters.
