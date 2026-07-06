# Prax Kubernetes Deployment

Prax runs as one Node container that serves the frontend and API, with all data in a single
embedded SQLite file on a persistent volume — there is no separate database server. Kubernetes
manifests use a Kustomize **base + overlays** layout under `deploy/`, designed for GitOps with
Argo CD.

> **These are sanitized example manifests** for self-hosters — the hostnames (`example.com`) and
> the gateway are placeholders to adapt to your own cluster, not a turnkey config. The
> maintainer's live deployment config is kept in a separate private GitOps repo; this `deploy/`
> tree is a reference example.

## Layout

```text
deploy/base/                          # env-agnostic manifests (no namespace field)
deploy/overlays/dev/                  # dev: image tag + hostname patch
deploy/overlays/staging/              # staging: image tag + hostname patch
deploy/overlays/prod/                 # prod: image tag + hostname patch
```

`deploy/base/` contains:

- `configmap.yaml` — non-secret app env vars (host, port, embedding config)
- `pvc.yaml` — `prax-data` PersistentVolumeClaim for the SQLite file
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

## Data Volume

All application data lives in one SQLite database file. The `Deployment` sets:

```yaml
env:
  - name: PRAX_DB_FILE
    value: /data/prax.db
```

and mounts the `prax-data` PVC (`pvc.yaml`, 1Gi, `ReadWriteOnce`) at `/data`. `PRAX_DB_FILE` is
the canonical setting; `DATABASE_URL` is still read as a plain file path for back-compat with
pre-rename setups. The database runs in WAL mode, so `-wal`/`-shm` sibling files may appear next
to `prax.db` on the volume.

SQLite is embedded and single-writer, which shapes the Deployment:

- **`replicas: 1`** — two pods cannot share the database file, so the app does not scale
  horizontally. Scale vertically via the resource limits instead.
- **`strategy: Recreate`** — a rolling update would briefly run old and new pods at once, both
  wanting the file and the `ReadWriteOnce` volume. Recreate stops the old pod (releasing the
  volume and the SQLite lock) before starting the new one, at the cost of a short gap during
  upgrades.

The container runs with `readOnlyRootFilesystem: true`; the only writable paths are `/data` (the
PVC) and `/tmp` (an `emptyDir`). `fsGroup: 1000` makes the volume writable by the non-root app
user.

## Database Schema

The app applies database migrations automatically at boot, directly against the SQLite file, so
deploying the container is sufficient to initialise or upgrade the schema. Each pending `.sql`
file runs in its own transaction opened with `BEGIN IMMEDIATE` (taking SQLite's write lock up
front) and is recorded in a `schema_migrations` table. Migrations are forward-only; re-running is
safe.

There is no separate database to reach from outside the pod. To apply migrations explicitly
against a local file (e.g. when developing):

```bash
PRAX_DB_FILE=./prax.db npm run migrate
```

## Build and Publish Image

```bash
docker build -f deploy/Dockerfile -t ghcr.io/awaybreaktoday/prax:<tag> .
docker push ghcr.io/awaybreaktoday/prax:<tag>
```

Update the `newTag` in each overlay's `kustomization.yaml` to deploy a new version.

## Semantic Search

Semantic search is currently unavailable on the embedded SQLite engine. The base ConfigMap
disables it:

```yaml
# Semantic search returns with the sqlite-vec follow-up (Phase 5).
EMBEDDING_BACKEND: "none"
```

All three environments inherit this. It returns with the sqlite-vec follow-up (Phase 5); until
then, leave `EMBEDDING_BACKEND` at `none`.

## Exposure: Gateway API HTTPRoute

The app is exposed via a Gateway API `HTTPRoute` attached to the `external-gateway` in the
`gateway-system` namespace. TLS is terminated at the gateway — no TLS config lives in the
app manifests.

Each overlay patches the `HTTPRoute` hostname (see the table above).

## Cluster-side Prerequisites

These must be in place before syncing — they are the cluster operator's responsibility:

1. **Default StorageClass** (or one the cluster binds automatically) so the `prax-data`
   PVC provisions — the manifest does not name a `storageClassName`.
2. **`external-gateway`** in `gateway-system` must:
   - Have `allowedRoutes` configured to permit routes from `prax-*` namespaces.
   - Terminate TLS for `*.example.com`.
3. **DNS** records for all three hostnames pointing at the gateway's external IP/hostname.

## Local Render Check

No cluster needed — render any overlay with:

```bash
kubectl kustomize deploy/overlays/dev
kubectl kustomize deploy/overlays/staging
kubectl kustomize deploy/overlays/prod
```

## Health Checks

- `/healthz` — confirms the Node process is alive (startup and liveness probes).
- `/readyz` — confirms the embedded database answers a query; returns `503 not-ready` otherwise
  (readiness probe).

## Data Movement

The authoritative backup is a copy of the database file — see
[backup-restore.md](backup-restore.md) for taking one with `sqlite3 .backup` against the live
file (or a plain file copy while stopped), the Kubernetes `kubectl exec`/`kubectl cp` recipe,
and the restore procedure.

For portability rather than backup, the Admin panel exports tasks as a `moomora.tasks` JSON
envelope and library documents as a ZIP of `.md` files. Import accepts current Prax Console
envelopes or raw task arrays, with append, skip duplicates, and replace-context modes.
