# Safe Deployment and Trustworthy Settings Implementation Plan

**Design:** `docs/superpowers/specs/2026-07-13-safe-deployment-settings-design.md`

## 1. Fail-closed network configuration

- Classify loopback hosts centrally in `server/config.js`.
- Keep the default bind on `127.0.0.1`.
- Refuse non-loopback `HOST` values unless
  `PRAX_ALLOW_UNAUTHENTICATED_NETWORK=true` is present.
- Cover IPv4, IPv6, hostname, refusal, and deliberate acknowledgement.

## 2. Safe shipped deployment artifacts

- Remove the baked-in non-loopback bind from the container image.
- Make Compose and Kubernetes acknowledge their required container/pod-network bind explicitly.
- Keep Compose host publication on loopback and every rendered Kubernetes overlay free of an
  `HTTPRoute`.
- Add artifact-level contract tests and align deployment/security documentation.

## 3. Visible deployment boundary in Settings

- Add a read-only deployment-status endpoint with bind scope and `authentication: none`.
- Load it when Settings opens and expose explicit loading/error/retry state.
- Render local-only and network/no-auth language in Data & admin without implying proxy detection.
- Add backend, API-client, renderer, and browser evidence.

## 4. Truthful provider-settings outcomes

- Preserve distinct status-load errors for semantic search and AI answers.
- Serialize provider mutations and disable conflicting controls while pending.
- Preserve correction/retry input on rejection and reconcile unknown outcomes through canonical
  readback.
- Add focused renderer and interaction tests for failure, pending, and readback outcomes.

## 5. Journey gate and roadmap

- Run focused tests while iterating.
- Run `npm test`, `npm run check`, and `npm run test:e2e`.
- Mark Journey 11 automated only when the production browser and deployment artifact evidence are
  green together.
- Update the quality-standard adoption sequence and attempt to remember the durable deployment
  boundary in Prax.

## Completion evidence

- `npm test`: 164/164 unit, integration, contract, CLI, and MCP test files passed.
- `npm run check`: passed, including the new provider-settings reconciliation module.
- `npm run test:e2e`: 53/53 production-server browser journeys passed.
- Deployment artifact contracts prove the image has no baked-in network escape hatch, Compose is
  host-loopback-only, Kubernetes is explicit ClusterIP with no rendered route, and every overlay is
  pinned to the package version.
- Browser evidence proves local/no-auth status, visible provider-status failure, single-flight lost
  response reconciliation without replay, and retained correction input after rejection.
