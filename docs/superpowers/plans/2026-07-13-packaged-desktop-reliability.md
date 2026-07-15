# Packaged desktop reliability implementation plan

**Spec:** `docs/superpowers/specs/2026-07-13-packaged-desktop-reliability-design.md`

## 1. Lock the desktop boundary

- Add contract evidence for sidecar-owned ephemeral port binding, structured readiness, exact-origin
  navigation, cross-platform graceful shutdown, and the local restart command.
- Add Rust unit evidence for the pure lifecycle, URL, and log helpers.
- Add Node unit evidence for desktop readiness and stdin-controlled shutdown.

## 2. Correct launch and shutdown

- Move port selection into Fastify with `PORT=0` and announce the bound port on child stdout.
- Replace the single child mutex with explicit starting/ready/stopping/terminated lifecycle state.
- Restrict the window to the exact announced HTTP origin plus bundled recovery assets.
- Prevent ordinary exit until stdin shutdown completes, with one bounded force-kill fallback.

## 3. Make failure recoverable

- Replace startup and post-start sidecar failures with an accessible bundled recovery screen.
- Register a narrowly scoped restart command for the bundled origin only.
- Rotate desktop logs and tighten Unix application-data/log permissions.
- Preserve accurate language about WAL integrity versus unsaved draft recovery.

## 4. Prove build, launch, and update

- Add a release verifier for version, tag, resource, sidecar, and staged-payload agreement.
- Add an isolated packaged-runtime smoke mode and cross-platform harness.
- Make missing artifacts fatal and run the smoke journey in the native build matrix.
- Gate one tagged release on the container and all supported desktop artifacts; publish checksums and
  package assets together.
- Document the checksummed manual update/rollback drill and the signing prerequisite for any future
  automatic updater.

## 5. Close the excellence pass

- Run focused Node/contract/Rust suites while iterating.
- Run local sidecar preparation and the strongest practical packaged build/smoke evidence.
- Run `npm test`, `npm run check`, `cargo test`, `cargo check`, and `git diff --check`.
- Update the exceptional-quality ratchet and persist the durable desktop runbook to Prax when it is
  reachable.
