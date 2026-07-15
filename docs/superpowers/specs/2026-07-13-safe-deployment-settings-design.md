# Safe Deployment and Trustworthy Settings Design

**Date:** 2026-07-13
**Status:** Implemented

## Problem

Prax defaults to a localhost bind and its example Compose publication is localhost-only, but an
operator can still set `HOST=0.0.0.0` and start a completely unauthenticated workspace without any
explicit acknowledgement. The container image also bakes in a network bind, so a bare published
container is easier to expose than a bare local process. The Kubernetes base omits its example
`HTTPRoute`, which is good, but this boundary is documented rather than executable.

The application cannot prove that a reverse proxy supplies authentication or TLS. It therefore must
never claim that a network deployment is protected. What it can do is fail closed on accidental
network binding, make the remaining trust boundary visible, and continuously test the shipped
deployment examples.

Settings has a related truthfulness gap. Provider-status load failures currently look like an
unconfigured provider, mutations are not locked against repeat activation, and a failed or lost
mutation response can discard the values the person just entered. A settings surface that controls
external dependencies must distinguish off, unreachable, failed-to-load, pending, rejected, and
unknown-after-request outcomes.

## Outcomes

1. A normal local install listens only on loopback.
2. Any non-loopback bind refuses to start unless the operator explicitly acknowledges that Prax has
   no built-in authentication.
3. The container image itself has no baked-in network-bind or acknowledgement escape hatch. Compose
   and Kubernetes opt in explicitly because their process must listen on the container/pod network.
4. Compose remains published on host loopback only. The Kubernetes base remains ClusterIP-only and
   does not render the example `HTTPRoute`.
5. Settings reports the bind scope and the exact no-auth boundary without claiming knowledge of
   proxy authentication.
6. Provider status load failures are visible as failures, not rendered as “Off”. Provider mutations
   are single-flight and preserve a correct retry/reconciliation posture.
7. The production server, browser Settings surface, and shipped deployment artifacts all have
   automated evidence.

## Network-binding contract

`HOST` continues to default to `127.0.0.1`. Loopback hosts (`localhost`, IPv4 `127/8`, and IPv6
loopback) require no additional setting.

A non-loopback `HOST` requires the exact environment acknowledgement:

```text
PRAX_ALLOW_UNAUTHENTICATED_NETWORK=true
```

Without it, configuration fails before the database is opened or the HTTP listener starts. The
error names the unsafe host, states that there is no built-in authentication, and gives both safe
choices: bind to loopback or deliberately set the acknowledgement after arranging a trusted network
or authenticated TLS proxy.

The acknowledgement is intentionally blunt. It does not mean authentication is enabled and must
never be displayed as such. It records only that network reachability was intentional.

## Deployment examples

- The image defaults to the application's safe loopback behavior.
- Compose explicitly sets the non-loopback process bind and acknowledgement, while publishing only
  `127.0.0.1:3100` on the host.
- Kubernetes explicitly sets the same process-level acknowledgement. Its rendered base contains a
  single-replica/Recreate workload, ClusterIP Service, persistent SQLite volume, and no external
  route.
- The opt-in route keeps a `.invalid` hostname and remains excluded from every shipped overlay.
- Documentation explains that ClusterIP is still network access inside the cluster and that external
  exposure requires authentication and TLS before DNS is published.

Contract tests read the actual Dockerfile, Compose file, and manifests so these boundaries cannot
drift silently.

## Settings security status

`GET /api/settings/deployment` returns a deliberately small, non-secret status:

```json
{
  "authentication": "none",
  "bindHost": "127.0.0.1",
  "networkScope": "local",
  "networkAcknowledged": false
}
```

`networkScope` is `local` or `network`. On a network bind, Settings says “Trusted network — no
authentication” and explains that anyone who can reach Prax can read and change the workspace. On
loopback it says “Local only” and still states that Prax has no user accounts or authorization.
Failure to load this status is shown explicitly with a retry action.

## Provider-settings interaction

Semantic-search and answer-model controls share these rules:

1. A status request failure records `loadError`; it never falls back to an indistinguishable
   `{ available: false }` state.
2. One settings mutation may be active at a time. Provider cards, save/test buttons, and the semantic
   toggle are disabled and expose `aria-busy` while it is pending.
3. Values are captured before the request and retained when the server rejects the change or the
   outcome cannot be reconciled.
4. After a transport/unknown failure, Prax reads the canonical status. If readback succeeds, the UI
   reports the current committed provider rather than asserting that the mutation failed. If
   readback also fails, the UI says the outcome is unknown and offers status reload; it does not
   encourage blind repeated writes.
5. API keys are never returned. A successful/reconciled status uses only `hasApiKey`; a rejected
   draft may remain in the current in-memory form for correction but is never persisted in browser
   storage.

Provider selection remains an immediate, explicit setting in this pass. Its pending label and
readback behavior make that contract truthful; a larger atomic draft/apply redesign is not needed to
protect Journey 11.

## Evidence

- Unit tests for loopback classification, default safety, refusal, and explicit acknowledgement.
- Contract tests for the image, Compose publication, Kustomize base, Service, route exclusion, and
  placeholder hostname.
- Backend tests for the deployment-status response on local and acknowledged network configs.
- Frontend renderer/API tests for local, network, loading-failure, and pending states.
- Production-server browser evidence that default Settings reports local-only/no-auth truth and that
  failed provider-status loading cannot masquerade as “Off”.
- Full `npm test`, `npm run check`, and `npm run test:e2e` gates.

## Non-goals

- Prax does not gain built-in users, sessions, authorization, TLS termination, or proxy detection.
- The app does not accept a UI toggle that weakens the bind guard; this remains an operator-owned
  environment decision.
- This pass does not claim a Kubernetes cluster, reverse proxy, or identity provider was configured
  correctly merely because static manifests render.
- Packaged desktop build/update/recovery remains Journey 15, after the machine-interface breadth
  pass.
