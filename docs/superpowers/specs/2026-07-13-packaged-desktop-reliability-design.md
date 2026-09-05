# Packaged desktop reliability design

**Date:** 2026-07-13
**Journey:** 15 — packaged desktop build, launch, update, and recovery
**Quality invariants:** QINV-01, QINV-07, QINV-08, QINV-11

## Outcome

A supported Prax desktop package starts without a localhost ownership race, keeps its filesystem
and native-command boundary narrow, closes SQLite cleanly during an ordinary quit, and gives the
operator a useful recovery path when its local server cannot start or exits unexpectedly.

A tagged release is not complete until every supported package has built, run its packaged-runtime
smoke journey, and been attached to one release with checksums. Updating is an explicit installer
workflow that preserves the OS app-data directory. Prax does not present an unsigned or
unconfigured in-app updater as a finished safety feature.

## Supported packages

The release matrix is the source of truth. On 5 September 2026, the user removed Windows and
Intel Mac from supported desktop builds and releases, then added Linux ARM64:

- macOS Apple Silicon: `.app` and `.dmg`;
- Linux x64 and ARM64: `.deb` and `.AppImage` for each architecture.

Cross-compilation is not supported. Code-signing and notarization remain release-credential
concerns and must be reported truthfully; checksums do not substitute for platform signing.

## Findings

1. Rust currently binds and drops `127.0.0.1:0`, then asks Node to bind the selected port. Another
   process can acquire that port in between. The comment calls the race negligible, but the
   webview trusts whichever HTTP origin answers there.
2. The Node server handles `SIGTERM`/`SIGINT`, but Tauri's shell child `kill()` is a forceful
   termination and is the only path used on desktop exit. The documented graceful shutdown is
   therefore not the packaged behavior, especially on Windows.
3. A startup timeout points at a log but offers no action. If the sidecar exits after readiness,
   the existing webview is simply stranded.
4. The remote capability must use a wildcard port because the port is dynamic, while the window
   has no navigation policy limiting it to the exact sidecar origin selected for this process.
5. `server.log` grows without a bound and app-data/log permissions depend only on the launching
   process's umask.
6. Desktop CI builds bundles but does not run the packaged executable, tolerates missing artifacts,
   and leaves installers as expiring workflow artifacts rather than assets on the product release.
7. Version agreement, staged production payload, manual update preservation, and post-update
   recovery are described informally rather than checked as one release contract.

## Runtime contract

### Race-free endpoint ownership

The Node/Fastify sidecar receives `PORT=0` and binds its own ephemeral loopback port. Only after
`listen()` succeeds does it write one machine-readable readiness line to its stdout. Rust consumes
that line from the child it actually spawned, validates the port, probes `/readyz`, and then creates
the window. No port number is guessed or released between processes.

The main window accepts navigation only to:

- the exact `http://127.0.0.1:<announced-port>` origin for the live application; and
- Tauri's bundled application origin for the local startup/recovery screen.

A different localhost port is not interchangeable with the spawned Prax server even though the
static Tauri capability must describe dynamic localhost ports.

### Cross-platform graceful shutdown

Desktop mode gives the Node sidecar an authenticated-by-parent stdin control channel. On ordinary
quit, Rust prevents the first exit request, writes `shutdown\n`, and waits for the child to report
termination. Node closes Fastify and the SQLite handle before exiting. A bounded timeout force-kills
the child so a broken sidecar cannot make the desktop app impossible to quit.

The shutdown sequence is single-flight. A second exit request cannot start another shutdown, and
the final programmatic exit does not recurse into it. Unexpected sidecar termination is recorded
separately from an expected shutdown.

### Failure and recovery

Startup timeout, malformed readiness, early child exit, and post-start child exit all replace the
main content with the bundled recovery screen. The screen:

- names whether startup failed or the local server stopped;
- points to the exact log location;
- provides a keyboard-accessible **Restart Prax** action;
- never suggests that unsaved in-memory edits were persisted.

Restart uses the native application restart path. If the child is still alive, the same graceful
shutdown barrier runs before restart. SQLite WAL remains the crash-integrity layer; document/task
draft recovery remains the last-mile unsaved-input layer.

### Local data and logs

On Unix, the app-data and logs directories are tightened to owner-only access, and log files are
owner-readable/writable. Windows inherits the user's app-data ACL. At startup, the previous server
log is rotated when it exceeds a fixed bound so diagnostics cannot grow without limit. Rotation is
best effort and never prevents the database from opening.

## Build, release, and update contract

Before packaging, a deterministic verifier proves:

- `package.json`, `Cargo.toml`, and the Tauri-resolved version agree;
- the requested release tag is exactly `v<package version>`;
- sidecar staging contains the production server, public assets, runtime, and required production
  dependencies but no stale target for another platform;
- every configured icon/resource/sidecar input exists.

Each native release runner builds its own package and launches the built binary in an isolated
smoke data directory. The smoke path proves sidecar bind/readiness, real migrations/SQLite creation,
window construction, and graceful application-controlled exit. A missing installer or failed smoke
blocks that platform.

The release job waits for the container and every desktop package, downloads all native artifacts,
generates SHA-256 checksums, and attaches them to one GitHub release. This prevents a successful
container job from publishing a release that silently lacks a supported desktop package.

The supported update workflow is deliberate and manual:

1. back up `prax.db` with the documented online backup command;
2. quit Prax and install the newer package over the application bundle;
3. never replace or move the OS app-data directory;
4. launch, allow idempotent migrations to finish, and inspect recent sentinel work;
5. on failure, quit, restore the backup, and reinstall the prior package.

An automatic updater is deferred until Prax has durable platform signing credentials, an updater
public/private key rotation runbook, and signed update manifests. Manual, checksummed packages are
safer than an updater that cannot authenticate its payload.

## Compatibility

- Plain `npm start`, containers, MCP, and CLI keep their signal-based server shutdown behavior.
- `PORT=0` is used only by the desktop parent; ordinary server defaults remain `3000`.
- Existing data stays at the same application identifier path (`com.moomora.prax`).
- The Library export command and its native Save boundary are unchanged.
- Release artifacts change location from workflow-only storage to the tagged GitHub release; CI
  artifacts remain available for diagnosis.

## Acceptance evidence

- Rust unit tests pin readiness parsing, exact-origin navigation, log rotation, and state transitions.
- Node tests prove the desktop readiness line and stdin shutdown close the app exactly once.
- Contract tests pin command permissions, `PORT=0`, exact-origin navigation, graceful shutdown, and
  actionable recovery markup.
- The release verifier rejects version drift, missing staged payload, and the wrong tag.
- Packaged-runtime smoke runs on every release matrix platform and checks the isolated database/log.
- `cargo test`, `cargo check`, `npm test`, `npm run check`, and `git diff --check` pass.
