# Building the Prax desktop app

The desktop app is a Tauri 2 shell (`src-tauri/`) around the Node/Fastify
server, which runs as a **sidecar**: the bundled Node runtime executes
`resources/app/server/index.js` and announces its bound loopback port to its Rust parent.
The first launch asks the OS for a free port and persists it in `webview-port` under the app-data
directory; later launches bind that same port so webview drafts, preferences and saved views survive.
On upgrade, the latest child readiness record in `logs/server.log` or its rotated predecessor
recovers the prior origin when no port file exists. A port collision refuses startup: the recovery
screen names the port and asks you to quit the program using it, and the diagnostic log keeps the
error. Preserve the port file with the webview profile rather than deleting it to work around a
collision. The webview loads that exact origin only after `/readyz` answers. The database is an embedded
SQLite file — a packaged install has **zero external dependencies**.

Supported desktop builds and releases target **macOS Apple Silicon** and **Linux x64**.
Windows, Intel Mac and Linux ARM64 installers are not built or released (Linux ARM64 was dropped on
2026-09-07 when the pipeline moved to the project's own runners).

## Prerequisites

- Node.js ≥ 24 (the sidecar is a copy of *your* `node` binary; use the
  version you intend to ship)
- Rust (stable) — `rustup.rs`
- Platform toolchains: Xcode Command Line Tools (macOS Apple Silicon), or GTK/WebKitGTK
  development libraries (Linux; see the `apt-get install` list in `.github/workflows/desktop-build.yml`)

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
`tauri build` runs the same script as its `beforeBuildCommand`, deleting and re-staging the payload,
so checking `src-tauri/resources/app` before a build proves nothing about the package. After a
build, `npm run desktop:verify` (`--require-built`) checks what the build produced: the payload
beside the release binary (`src-tauri/target/release/resources/app`, which the unbundled binary and
`npm run desktop:smoke` run) and the payload inside every bundle under
`src-tauri/target/release/bundle/` (the macOS `Prax.app`, the `.deb` data tree). For each it proves
version/resource agreement, that every production dependency is present without development-only
packages, that the payload is the checkout's current `server/`, `public/`, `mcp/`, `cli/`,
`skills/`, `package.json` and backup/restore scripts file for file, and that its sidecar runs a
supported Node (the staged runtime, when still present). A stale or foreign payload fails with the
differing files. `node scripts/verify-desktop-release.mjs --require-prepared` still checks the
staged inputs before a build.

Both locations are generated and git-ignored. No window opens while the server starts: the main
window opens directly on the app once the server reports ready and `/readyz` answers. A failed
start opens the bundled page in `src-tauri/splash/` as the recovery screen instead.

## Build installers

```bash
npm run desktop:build
```

Outputs land under `src-tauri/target/release/bundle/`:

- macOS Apple Silicon: `.app` and `.dmg`
- Linux x64: `.deb` and `.AppImage`

Cross-compilation is not supported — build each platform on that platform. The pipeline builds
both on self-hosted group runners, so neither costs compute minutes:

| Job | Runner labels | Host | What the job installs itself |
|---|---|---|---|
| `desktop-linux-x64` | `self-hosted`, `homelab` | Linux amd64 with Docker; the job runs in the `node:24-bookworm` container for its Debian userland | WebKitGTK/GTK toolchain, an official Node `$NODE_VERSION` (pinned + checksummed; the image's own Node is not used), Rust `$RUST_VERSION` (rustup), xvfb/dbus smoke harness |
| `desktop-macos-arm64` | `self-hosted`, `macOS`, `ARM64` | Apple Silicon Mac running the GitHub Actions runner, on the host or inside a long-lived Tart VM | an official Node `$NODE_VERSION` (pinned + checksummed, under `$RUNNER_TEMP`) and Rust `$RUST_VERSION` (rustup); the machine supplies the Xcode command line tools |

Both runners are registered with the `markjoyeuxcom` organisation (Settings ▸ Actions ▸ Runners);
the Linux one carries the extra `homelab` label and needs Docker, because its jobs run in a
container. GitHub's runner has no throwaway-VM executor, so the macOS job assumes a persistent
machine: it installs the pinned Node under `$RUNNER_TEMP` and the pinned Rust toolchain through
rustup, names every path it needs explicitly, and never relies on what an earlier job left on
PATH. Running that runner inside a long-lived Tart VM cloned from
`ghcr.io/cirruslabs/macos-tahoe-base` keeps the builder separate from the Mac's own toolchain,
and a pull request from a fork never reaches a self-hosted runner without approval (the
organisation's Actions settings require it for outside collaborators).

**The macOS job must build with an official nodejs.org Node, and the pipeline pins which one.**
`scripts/prepare-sidecar.mjs` stages the sidecar by copying `process.execPath` verbatim, so the
Node that builds the package *is* the Node that ships inside it. An official build depends on
`/usr/lib` and `/System` alone; Homebrew's `node@24` links against `@rpath/libnode.<abi>.dylib`
and seventeen Cellar dylibs, so a `.dmg` built with it ships a sidecar that aborts with
`dyld: Library not loaded` on every Mac except the build machine. Nothing before the
packaged-runtime smoke notices, because the failure is in the child process. `prepare-sidecar`
now refuses a runtime that depends on anything outside macOS itself
(`foreignRuntimeDependencies`, pinned by `tests/backend/sidecarDependencies.test.js`).

The Linux job pins its Node the same way: it downloads the official `linux-x64` tarball for the
same `$NODE_VERSION` and checks it against `$NODE_LINUX_X64_SHA256`. Both jobs refuse to continue
unless `node --version` reports exactly `v$NODE_VERSION`, build with the `$RUST_VERSION` toolchain,
and run every cargo and Tauri build with `--locked`, so a release never resolves crate versions
that `src-tauri/Cargo.lock` does not name.

Each job stages the Node runtime and dependencies, builds the installers, verifies the payload the
build bundled (`npm run desktop:verify`), runs the packaged-runtime smoke, checksums its packages where it built them, and hands them to the release job as artifacts.
The release job verifies those checksums after artifact storage, then publishes one `SHA256SUMS`
covering exactly the attached files. Tagged releases attach both platforms' installers, and the
release is only created once every package is present.
GitHub-hosted macOS runners are billed at ten times the Linux rate and exhausted the Actions
allowance in September 2026, which is why every job runs on the project's self-hosted runners and
why Linux ARM64 (no self-hosted runner) is not a supported target. If a self-hosted runner is
offline the job queues for it rather than releasing without its package; bring the runner back
within GitHub's queue limit (24 hours) and the pending job starts, or re-run the workflow.

To build a package by hand instead, for example on a Mac:

```bash
npm ci && npm run desktop:build              # .dmg and .app under src-tauri/target/release/bundle/
npm run desktop:verify                       # the bundled payload is the current source
npm run desktop:smoke                        # packaged-runtime smoke of the built app
shasum -a 256 src-tauri/target/release/bundle/dmg/Prax_0.21.0_aarch64.dmg
```

## Where user data lives

| Platform | Location |
|---|---|
| macOS | `~/Library/Application Support/com.moomora.prax/` |
| Linux | `~/.local/share/com.moomora.prax/` |

Contents: `prax.db` (plus `-wal`/`-shm` WAL siblings) and `logs/server.log`
(the sidecar's output, plus the shell's own `[prax]` lifecycle and window-error lines). Back up
with the online backup command, by copying the database after quitting Prax (keep any `-wal`/`-shm`
siblings with it), or via the JSON/Markdown exports — see [../backup-restore.md](../backup-restore.md).
On macOS/Linux the app-data and log directories are owner-only. The log is capped at 5 MiB: it is
rotated to `server.log.1` at launch when it is over the cap, and during a session whenever the next
line would take it past the cap. Prax keeps one previous log. The desktop server writes no line per
request (Fastify's request lines carry full URLs, including search terms); errors, warnings and
lifecycle lines are still logged.

Library ZIP export crosses the desktop boundary through one registered command. The webview passes
the archive as the raw invoke body (not a JSON array of numbers, which cost roughly fourteen times
the archive's size in page memory) and a suggested basename in the `Prax-Export-Filename` header,
never a filesystem path; Rust sanitizes the name, opens the native Save
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

Because navigation is pinned to the sidecar, a clicked web link cannot open inside the window. The
page hands it to the system browser through the already-registered shell plugin's `open` command:
`capabilities/remote.json` grants `shell:allow-open` and nothing else from that plugin, and the
plugin's default open scope (no `plugins.shell.open` override in `tauri.conf.json`) accepts only
http(s), mailto and tel URLs. The browser build opens the same links in a new tab.

The export command is asynchronous. It uses the dialog builder's callback API and waits/writes on a
blocking worker, never the desktop UI event loop. A synchronous command combined with
`blocking_save_file` can display a macOS sheet while starving its controls and producing the spinning
wait cursor; the desktop contract test explicitly forbids that combination.

## Menu bar, quick capture, and closing the window

The main window **closes to the menu bar**: the red close button hides it and the sidecar keeps
running, so the capture shortcut and the memory skills keep working. Reopen it from the Dock or
the menu-bar icon (**Open Prax**); quit from the menu-bar icon (**Quit Prax**) or ⌘Q, which runs
the graceful shutdown below. Once the recovery screen is showing (after a failed start or a later
sidecar crash) the close button quits instead, so a dead server cannot leave a hidden process behind.

On macOS the shell installs its own app menu instead of Tauri's default. It has the same items —
About, Services, Hide, Hide Others, File › Close Window, the Edit items (Undo, Redo, Cut, Copy,
Paste, Select All, which the webview's text fields rely on), View › Enter Full Screen, and the
Window and Help menus — except **Quit Prax** (⌘Q). The default Quit sends `terminate:`, which ends
the app without the graceful-shutdown request; this item runs the same shutdown as the menu-bar
**Quit Prax**.

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

- **Port**: Node binds the port itself and reports it on its child stdout, so there is no
  released-port interval for another process to win. The first launch binds `127.0.0.1:0` and
  saves the port the OS chose; every later launch binds that saved port (see the top of this page).
  If another program holds it, the child prints `PRAX_DESKTOP_FAILED {"reason":"port-in-use",…}`
  and exits, and the recovery screen names the port and asks you to quit that program.
- **Upgrades**: pending migrations run before the server listens. The child reports each one
  (`PRAX_DESKTOP_PROGRESS`), and every report gives the start another ten minutes instead of the
  30-second budget, which applies again once migrations finish. The quit request and signal
  handling are installed before migrations: a quit during an upgrade stops at the next migration
  boundary (each migration is its own transaction) and closes the database cleanly.
- **Single instance**: `tauri-plugin-single-instance` focuses the existing
  window instead of letting a second process open the same database.
- **Shutdown**: every desktop quit writes a private `shutdown` command to the child stdin and
  waits up to five seconds for Fastify and SQLite to close; SQLite then folds `prax.db-wal` back
  into `prax.db`. A force-kill is only the bounded fallback. The menu-bar **Quit Prax**, ⌘Q and
  Restart do this in the background before exiting. Quit paths that end the app directly — the
  Dock's **Quit**, logout, restart or shutdown of the Mac — pass the same barrier as the app's
  final step, holding the process for at most five seconds. A force quit (Activity Monitor,
  `kill -9` of the app) cannot run it; the orphaned server then shuts itself down when its stdin
  closes. Plain-server deployments retain their `SIGTERM`/`SIGINT` path.
- **Recovery**: startup timeout, malformed readiness, early exit, and a later sidecar crash all show
  the bundled recovery screen with the exact log path and **Restart Prax**. After a crash the open
  main window navigates to that screen (a hidden window is shown again) and the capture bar is
  hidden; **Open Prax**, the capture shortcut and a second launch all bring the screen forward.
  Window creation or navigation failures are recorded in `logs/server.log`. Restart uses the same
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
sentinel remains and both sidecars report application-controlled zero-code exits. Those two launches
end through the app menu's Quit handler and must leave no un-checkpointed `prax.db-wal`. On macOS a
third launch ends with `NSApp terminate:` (what the Dock's Quit and logout send) and must meet the
same bar. A crash launch (`--desktop-smoke-exit crash`) SIGKILLs the sidecar after the main window
opened and passes only if that window is visible on the bundled recovery screen before the app quits.
A final launch (`--desktop-smoke-exit capture-crash`) opens the capture bar first, then kills the
sidecar, and passes only if the capture bar is hidden, the main window shows recovery, and a second
capture summon (the tray item's and the shortcut's path) brings the hidden recovery window back
while the bar stays hidden.
The temporary directory is removed on success and retained in the error message on failure. A smoke launch skips
the single-instance plugin (its socket is keyed on the app identifier, not the data directory), so
the smoke also passes on a machine where an installed Prax is running, such as the macOS runner.
The launched app does open a window briefly on that machine's desktop.

## Releases and updates

CI runs on GitHub Actions (`.github/workflows/`), and every job runs on the project's self-hosted
runners (`homelab` for Linux, the `macOS`/`ARM64` Mac for the macOS build); none uses a
GitHub-hosted runner. Every pull request and push to `main` runs the Node checks, the unit and
contract suite, the dependency audit and the browser suite (`ci.yml`); the two desktop builds are
**manual** there (the `Desktop builds` workflow, run from the Actions tab; each takes ten to
fifteen minutes) and automatic on release tags. A release tag `vX.Y.Z` or `vX.Y.Z-rc.N` is the
distribution gate (`release.yml`): the quality gate and both desktop builds with their
packaged-runtime smoke must succeed before one GitHub release is created with every package,
`SHA256SUMS`, and the changelog section as its body. A missing package is fatal. The workflow
builds and publishes **no container image**; `deploy/Dockerfile` is for building your own (see
`deploy/README.md`). A release candidate is published as a GitHub prerelease.

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
