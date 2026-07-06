# Prax Kubernetes Deployment

Prax runs as one Node container that serves the frontend and API. Kubernetes manifests
use a Kustomize **base + overlays** layout under `deploy/`, designed for GitOps with Argo CD.

> **These are sanitized example manifests** for self-hosters — the hostnames (`example.com`), the
> Ollama endpoint (`ollama.internal`), and the gateway are placeholders to adapt to your own
> cluster, not a turnkey config. The maintainer's live deployment config is kept in a separate
> private GitOps repo; this `deploy/` tree is a reference example.

## Layout

```text
deploy/base/                          # env-agnostic manifests (no namespace field)
deploy/overlays/dev/                  # dev: image tag + hostname patch
deploy/overlays/staging/              # staging: image tag + hostname patch
deploy/overlays/prod/                 # prod: image tag + hostname patch
```

`deploy/base/` contains:

- `cluster.yaml` — CloudNativePG `Cluster` resource (`prax-db`)
- `configmap.yaml` — non-secret app env vars (host, port, embedding config)
- `deployment.yaml` — app `Deployment`
- `service.yaml` — `ClusterIP` `Service`
- `httproute.yaml` — Gateway API `HTTPRoute` (placeholder hostname; patched by each overlay)
- `kustomization.yaml`

No manifest in `deploy/base/` sets a `namespace:` field. The namespace is injected by Argo CD at
sync time.

## Argo CD ApplicationSet

A homelab Argo CD ApplicationSet auto-discovers this repo and creates one `Application` per
environment. Each Application:

- Points at `deploy/overlays/<env>` as its source path.
- Deploys into namespace `prax-<env>` (e.g. `prax-dev`), with
  `CreateNamespace=true` so the namespace is created automatically.
- Injects the namespace into all resources at sync time — no manifest hard-codes one.

## Per-environment overlays

Each overlay pins the image tag and patches the `HTTPRoute` hostname:

| Environment | Namespace                   | Hostname                              |
|-------------|----------------------------|---------------------------------------|
| dev         | `prax-dev`      | `prax-dev.example.com`   |
| staging     | `prax-staging`  | `prax-staging.example.com` |
| prod        | `prax-prod`     | `prax.example.com`       |

Overlays are currently pinned to `v0.15.0`. CI-driven `newTag` bumping on release is planned as
future work.

## CloudNativePG Cluster

Each environment provisions its own CNPG `Cluster` resource named `prax-db`. It runs the
stock CNPG **operand** image `ghcr.io/cloudnative-pg/postgresql:18-minimal-trixie` and mounts
`pgvector` from the public **extension** image as a Kubernetes ImageVolume (CNPG ≥ 1.27, PostgreSQL
18's `extension_control_path`):

```yaml
spec:
  imageName: ghcr.io/cloudnative-pg/postgresql:18-minimal-trixie
  postgresql:
    extensions:
      - name: pgvector
        image:
          reference: ghcr.io/cloudnative-pg/pgvector:0.8.2-18-trixie
```

> Note: `ghcr.io/cloudnative-pg/pgvector:*` is an **extension-only** image (it has no Postgres
> binaries) — it must be mounted via `postgresql.extensions`, not used as the cluster `imageName`.

At bootstrap, the cluster runs:

```sql
CREATE EXTENSION IF NOT EXISTS vector
```

This is required because `vector` is not a trusted extension — the non-superuser app role the
app runs migrations as cannot `CREATE EXTENSION` it. Migration `0005`'s
`CREATE EXTENSION IF NOT EXISTS vector` then becomes a no-op.

CNPG generates the `prax-db-app` secret automatically. The app reads its `uri` key as
`DATABASE_URL`.

## Database Schema

The app applies database migrations automatically on startup, so deploying the container is
sufficient to initialise or upgrade the schema. To apply migrations explicitly:

```bash
DATABASE_URL=$(kubectl get secret prax-db-app -n prax-<env> \
  -o jsonpath='{.data.uri}' | base64 -d)
DATABASE_URL="$DATABASE_URL" npm run migrate
```

Migrations are forward-only and tracked in a `schema_migrations` table; re-running is safe.

## Build and Publish Image

```bash
docker build -f deploy/Dockerfile -t ghcr.io/awaybreaktoday/prax:<tag> .
docker push ghcr.io/awaybreaktoday/prax:<tag>
```

Update the `newTag` in each overlay's `kustomization.yaml` to deploy a new version.

## Semantic Search

Semantic search is enabled in the base ConfigMap with these values:

```yaml
EMBEDDING_BACKEND: "ollama"
OLLAMA_URL: "http://ollama.internal:11434"
EMBEDDING_MODEL: "qwen3-embedding:0.6b"
```

All three environments inherit this config. The pgvector CNPG image ensures the `vector` extension
is available. Pods must be able to reach `ollama.internal:11434` (the cluster-local Ollama host).

To use a different embedding backend, patch the ConfigMap in the relevant overlay.

## Exposure: Gateway API HTTPRoute

The app is exposed via a Gateway API `HTTPRoute` attached to the `external-gateway` in the
`gateway-system` namespace. TLS is terminated at the gateway — no TLS config lives in the
app manifests.

Each overlay patches the `HTTPRoute` hostname (see the table above).

## Cluster-side Prerequisites

These must be in place before syncing — they are the cluster operator's responsibility:

1. **CNPG operator** installed in the cluster.
2. **`external-gateway`** in `gateway-system` must:
   - Have `allowedRoutes` configured to permit routes from `prax-*` namespaces.
   - Terminate TLS for `*.example.com`.
3. **DNS** records for all three hostnames pointing at the gateway's external IP/hostname.
4. **Ollama reachability**: pods in `prax-*` namespaces must reach
   `ollama.internal:11434` for semantic search to function.

## Local Render Check

No cluster needed — render any overlay with:

```bash
kubectl kustomize deploy/overlays/dev
kubectl kustomize deploy/overlays/staging
kubectl kustomize deploy/overlays/prod
```

## Health Checks

- `/healthz` — confirms the Node process is alive.
- `/readyz` — confirms database connectivity through `DATABASE_URL`.

## Data Movement

Prax exports backups with the `moomora.tasks` format. Import accepts current Prax
Console envelopes or raw task arrays, with append, skip duplicates, and replace-context modes
available from the Admin panel.
