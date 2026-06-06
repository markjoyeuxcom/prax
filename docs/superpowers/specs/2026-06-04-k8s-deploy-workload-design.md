# Kubernetes Deploy — Argo CD Workload Contract

**Status:** Approved (brainstorm complete)
**Date:** 2026-06-04
**Branch:** `k8s-deploy-workload`

## Context

The homelab Argo CD **workloads ApplicationSet**
(`helm-apps/argo-cd/config/base/homelab/applicationset-workloads.yaml`) auto-discovers any repo
under `gitlab.com/markjoyeuxcom` or `github.com/awaybreaktoday` that contains a `deploy/`
directory, and creates one Argo CD Application per environment. `moomora-console`
(github.com/awaybreaktoday) qualifies.

This spec converts Moomora Console's deployment to that contract so it deploys to dev / staging /
prod via Argo CD.

### The contract (recap)

- A repo opts in with `deploy/base/` (env-agnostic, **no namespace**) + `deploy/overlays/<env>/`.
- The ApplicationSet reads `deploy/overlays/<env>`; a missing overlay errors that env's Application.
- No `namespace:` in any manifest — Argo injects the destination namespace `{repo}-{env}` and
  `CreateNamespace=true` creates it.
- Argo auto-detects Kustomize from `kustomization.yaml`.
- Env → revision: **dev** = `main` branch (auto-sync), **staging** = latest tag (auto-sync),
  **prod** = latest stable tag (manual sync). The image tag in each overlay moves with the git
  revision the env checks out.

## Goal

Add a `deploy/base` + `deploy/overlays/{dev,staging,prod}` Kustomize structure that deploys Moomora
Console (app + per-env CNPG pgvector Postgres + HTTPRoute) to the three environments, with semantic
search enabled against the homelab Ollama.

## Decisions (resolved during brainstorm)

| Topic | Decision |
|---|---|
| Database | Per-env **CloudNativePG `Cluster`** shipped in `deploy/base` (operator already installed). Generates the `moomora-console-db-app` secret in-namespace. |
| pgvector image | Public CNPG operand image **`ghcr.io/cloudnative-pg/pgvector:0.8.2-18-trixie`** (pgvector 0.8.2 on PG 18). No custom image to build. Extension created via `postInitApplicationSQL`. |
| App image | `ghcr.io/awaybreaktoday/moomora-console`, pinned **`v0.15.0`** in all three overlays for this first cut. |
| Exposure | **HTTPRoute** (Gateway API) → `parentRefs: external-gateway` in `gateway-system`. TLS assumed terminated at the gateway (`*.example.com`); the route carries only the hostname. |
| Hostnames | dev `moomora-console-dev.example.com`, staging `moomora-console-staging.example.com`, prod `moomora-console.example.com`. |
| Embeddings | **On** — `EMBEDDING_BACKEND=ollama`, `OLLAMA_URL=http://ollama.internal:11434`, `EMBEDDING_MODEL=qwen3-embedding:0.6b`. |
| CI | **Out of scope** for this cut. Overlays are pinned to `v0.15.0`; the image-build + `newTag`-bump CI (so dev tracks `main` and staging/prod move with tags) is a documented fast-follow. |
| Scale | 1 app replica + 1 DB instance per env for the first cut. Prod HA is a later overlay tweak. |

## Non-Goals (deferred)

- CI pipeline that builds/pushes the app image and bumps overlay `newTag` (the contract's full
  release-flow automation). This cut pins `v0.15.0` everywhere.
- Prod HA (multi-replica app, multi-instance DB), PodDisruptionBudgets, HPA.
- Backups / `barmanObjectStore` for the CNPG cluster.
- Per-env embedding-model differences (all three point at the same homelab Ollama).
- Network policies / securing the Ollama path.

## Architecture

```
Argo CD Application (per env)  ── path: deploy/overlays/<env>, dest ns: moomora-console-<env>
   │  Kustomize: ../../base + image newTag + HTTPRoute host patch
   ▼
namespace moomora-console-<env>  (created by Argo, CreateNamespace=true)
   ├── ConfigMap  moomora-console-config   (HOST/PORT, EMBEDDING_*)
   ├── Deployment moomora-console          (app :3000, DATABASE_URL from secret)
   ├── Service    moomora-console          (ClusterIP :3000)
   ├── HTTPRoute  moomora-console          (parentRef external-gateway, host per env)
   └── Cluster    moomora-console-db       (CNPG, pgvector image)
            └── Secret moomora-console-db-app   (key `uri` → DATABASE_URL)
```

## File structure

**New:**
```
deploy/base/kustomization.yaml
deploy/base/configmap.yaml
deploy/base/deployment.yaml
deploy/base/service.yaml
deploy/base/httproute.yaml
deploy/base/cluster.yaml
deploy/overlays/dev/kustomization.yaml
deploy/overlays/staging/kustomization.yaml
deploy/overlays/prod/kustomization.yaml
```

**Removed (superseded by `base/`):**
```
deploy/k8s/configmap.yaml
deploy/k8s/deployment.yaml
deploy/k8s/ingress.yaml
deploy/k8s/service.yaml
deploy/k8s/postgres-cluster.example.yaml
```
(`deploy/k8s/` directory removed entirely.)

**Kept:** `deploy/Dockerfile` (app build), `deploy/postgres/Dockerfile` (reference; the public CNPG
pgvector image is used by default now).

**Doc updates:** `README.md` and `docs/deployment.md` — replace `deploy/k8s/` references with the
new `deploy/base` + `deploy/overlays` Kustomize + Argo CD workflow, including the cluster-side
prerequisites below.

## Manifest detail

### `base/deployment.yaml`
- 1 replica; label `app.kubernetes.io/name: moomora-console` (selector + template consistent).
- Container `app`, image `ghcr.io/awaybreaktoday/moomora-console` (tag set by overlay), `containerPort: 3000`.
- `envFrom: [configMapRef: moomora-console-config]`.
- `env: DATABASE_URL` ← `secretKeyRef { name: moomora-console-db-app, key: uri }`.
- Probes (all `httpGet` on port 3000): `startupProbe` `/healthz` (failureThreshold 30, period 2s → ~60s for first-boot migrations), `livenessProbe` `/healthz`, `readinessProbe` `/readyz` (DB connectivity).
- Resources: requests `cpu 50m / memory 128Mi`, limits `cpu 500m / memory 256Mi`.
- `argocd.argoproj.io/sync-wave: "1"` (after the DB).

### `base/configmap.yaml` — `moomora-console-config`
```
HOST: "0.0.0.0"
PORT: "3000"
EMBEDDING_BACKEND: "ollama"
OLLAMA_URL: "http://ollama.internal:11434"
EMBEDDING_MODEL: "qwen3-embedding:0.6b"
```
(No secret needed beyond the DB secret — Ollama is keyless.)

### `base/service.yaml`
- `ClusterIP`, `port: 3000` → `targetPort: 3000`, name `http`, selector `app.kubernetes.io/name: moomora-console`.

### `base/httproute.yaml`
- `gateway.networking.k8s.io/v1` HTTPRoute named `moomora-console`.
- `parentRefs: [{ name: external-gateway, namespace: gateway-system }]`.
- Placeholder `hostnames: ["moomora-console.invalid"]` (every overlay replaces it).
- `rules: [{ backendRefs: [{ name: moomora-console, port: 3000 }] }]`.

### `base/cluster.yaml`
- `postgresql.cnpg.io/v1` Cluster named `moomora-console-db`.
- `instances: 1`, `imageName: ghcr.io/cloudnative-pg/pgvector:0.8.2-18-trixie`.
- `bootstrap.initdb: { postInitApplicationSQL: ["CREATE EXTENSION IF NOT EXISTS vector"] }`.
- `storage: { size: 5Gi }`.
- `argocd.argoproj.io/sync-wave: "0"` (created before the Deployment).

### `base/kustomization.yaml`
- `resources: [configmap.yaml, cluster.yaml, deployment.yaml, service.yaml, httproute.yaml]`.
- The `app.kubernetes.io/name: moomora-console` selector labels are **hand-written** in
  `deployment.yaml` (`selector.matchLabels` + `template.metadata.labels`) and `service.yaml`
  (`selector`) — Kustomize is NOT used to inject selectors (avoids the `commonLabels`/`labels`
  selector-mutation footguns). Optionally a `labels:` block adds non-selector common labels.
- **No `namespace:` field.**

### `overlays/<env>/kustomization.yaml` (single file each)
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
images:
  - name: ghcr.io/awaybreaktoday/moomora-console
    newTag: v0.15.0
patches:
  - target: { kind: HTTPRoute, name: moomora-console }
    patch: |
      apiVersion: gateway.networking.k8s.io/v1
      kind: HTTPRoute
      metadata:
        name: moomora-console
      spec:
        hostnames:
          - moomora-console-<env>.example.com   # prod: moomora-console.example.com
```
No `namespace:` field. Strategic-merge patch replaces the placeholder hostname.

## Behaviour notes

- **First-sync eventual consistency:** on initial sync Argo creates the namespace, the Cluster, and
  the app together. CNPG takes ~1 min to provision and emit `moomora-console-db-app`. Until then the
  app pod cannot read `DATABASE_URL` / reach the DB and will restart (CrashLoopBackOff), then recover
  once the secret + DB are ready. The `sync-wave` annotations and `startupProbe` reduce thrash; this
  is expected, not a failure.
- **First boot runs migrations** (incl. `0007`) against the fresh `app` database; `readyz` gates
  traffic until the DB is reachable.

## Cluster-side prerequisites (operator's responsibility — documented, not set by this repo)

1. **CloudNativePG operator** installed (confirmed).
2. **`external-gateway`** (in `gateway-system`) must `allowedRoutes` from the
   `moomora-console-*` namespaces and have a `*.example.com` TLS listener.
3. **DNS** for the three hostnames resolves to the gateway address.
4. **Network reachability** from pods to `ollama.internal:11434` (Ollama).
5. The **workloads ApplicationSet** discovers the repo once `deploy/overlays/*` is on `main`.

## Verification (no cluster required)

For each env: `kubectl kustomize deploy/overlays/<env>` renders without error, and the output:
- contains **no** `namespace:` field on any resource;
- sets the HTTPRoute `hostnames` to the env's host;
- sets the Deployment image to `ghcr.io/awaybreaktoday/moomora-console:v0.15.0`;
- includes the CNPG `Cluster` with the pgvector `imageName`;
- HTTPRoute `parentRefs` → `external-gateway` / `gateway-system`;
- Deployment `DATABASE_URL` sourced from `moomora-console-db-app` secret key `uri`.

## Success criteria

1. `kubectl kustomize deploy/overlays/{dev,staging,prod}` all render cleanly with the per-env host
   and pinned image, and no `namespace:` field.
2. The manifests match the ApplicationSet contract (base + overlays, Kustomize auto-detected).
3. Docs describe the deploy flow + cluster prerequisites accurately.
4. On a real sync, an env comes up Healthy: CNPG provisions, the app migrates `0007`, `/readyz`
   passes, and the host serves through `external-gateway`. (Verified by the operator post-merge.)
