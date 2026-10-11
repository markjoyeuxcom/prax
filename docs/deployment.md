# Prax Kubernetes Deployment

Prax runs as one Node container that serves the frontend and API, with all data in a single
embedded SQLite file on a persistent volume — there is no separate database server. Kubernetes
manifests use a Kustomize **base + overlays** layout under `deploy/`, designed for GitOps with
Argo CD.

> **These are sanitized example manifests** for self-hosters. The opt-in exposure example uses
> placeholder Gateway and hostname values to adapt to your own cluster; it is not turnkey. The
> maintainer's live deployment config is kept in a separate private GitOps repo; this `deploy/`
> tree is a reference example.

## Layout

```text
deploy/base/                          # env-agnostic manifests (no namespace field)
deploy/overlays/dev/                  # dev: image tag
deploy/overlays/staging/              # staging: image tag
deploy/overlays/prod/                 # prod: image tag
```

`deploy/base/` contains:

- `configmap.yaml` — non-secret app env vars (host, port, embedding config)
- `pvc.yaml` — `prax-data` PersistentVolumeClaim for the SQLite file
- `deployment.yaml` — app `Deployment`
- `service.yaml` — `ClusterIP` `Service`
- `networkpolicy.yaml` — admits traffic to Prax's port only from pods in its own namespace
- `httproute.yaml` — opt-in Gateway API example; intentionally excluded from rendered resources
- `kustomization.yaml`

No manifest in `deploy/base/` sets a `namespace:` field. The namespace is injected by Argo CD at
sync time.

## Bind safety

The application defaults to `HOST=127.0.0.1`. Any non-loopback bind is refused before the listener
opens unless the environment also contains:

```text
PRAX_ALLOW_UNAUTHENTICATED_NETWORK=true
```

The check runs after the SQLite database has been opened and migrated (startup builds the app,
applies pending migrations, then validates the bind); a refused bind therefore leaves a migrated
database behind but never an open network socket.

The container image **does** bake in both `HOST=0.0.0.0` and this acknowledgement
(`deploy/Dockerfile`): a container bound to loopback is unreachable by definition, so the process
listens on the container network and reachability becomes the operator's exposure decision at the
publication boundary — which host port or pod network the container is attached to (`-p`,
`--network`, a Service). Compose keeps that boundary on host loopback only (`127.0.0.1:3100`), and
the Kubernetes base exposes only a ClusterIP Service. The flag adds no authentication and is not
evidence that a reverse proxy is safe; it only makes network reachability a deliberate decision
instead of an accidental `HOST` change.

### Host names (DNS rebinding)

`PRAX_ALLOWED_HOSTS` turns the `Host` header check on for any bind. When it is set, Prax accepts
loopback names, IP literals (DNS rebinding always needs a hostname) and the comma-separated names
listed, and answers `403` to anything else; `*` turns the check off. Unset, only an unacknowledged
loopback bind is checked. The container image sets `PRAX_ALLOWED_HOSTS=localhost`, so the Compose
install keeps the DNS-rebinding defence even though the process listens on `0.0.0.0`; add a
reverse proxy's public hostname to the list when you put one in front. The Kubernetes base sets
`"*"` because pods are reached by Service DNS and gateway names; replace it with those names to keep
the check. The image also stores its database at `/data/prax.db`, a directory owned by the non-root
`node` user, so a fresh Compose volume is writable.

Settings → Data & admin reports whether the running process is local-only or network-reachable and
always reports the application's authentication mode as `none`.

## Argo CD ApplicationSet

A homelab Argo CD ApplicationSet auto-discovers this repo and creates one `Application` per
environment. Each Application:

- Points at `deploy/overlays/<env>` as its source path.
- Deploys into namespace `prax-<env>` (e.g. `prax-dev`), with
  `CreateNamespace=true` so the namespace is created automatically.
- Injects the namespace into all resources at sync time — no manifest hard-codes one.

## Per-environment overlays

Each overlay pins the image tag. Exposure is intentionally not part of the rendered base:

| Environment | Namespace |
|-------------|-----------|
| dev | `prax-dev` |
| staging | `prax-staging` |
| prod | `prax-prod` |

Overlays are currently pinned to `v0.40.0`. That tag follows this checkout's version
(`npm run release:prepare` bumps it every release), but the pipeline builds and publishes no
container image — the last one it pushed was `v0.30.0`. Build and push the image yourself (see
[Build and Publish Image](#build-and-publish-image)) and point each overlay's `images:` entry at it.

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
docker build -f deploy/Dockerfile -t ghcr.io/markjoyeuxcom/prax:<tag> .
docker push ghcr.io/markjoyeuxcom/prax:<tag>
```

Update the `newTag` in each overlay's `kustomization.yaml` to deploy a new version.

## Semantic Search

Semantic search works with the embedded SQLite engine: vectors are stored in the database and
cosine-ranked in process. The base ConfigMap keeps it off by default so a deployment never gains
an external embedding dependency or sends document text to a provider without an explicit
operator choice:

```yaml
EMBEDDING_BACKEND: "none"
```

All three environments inherit this. To enable semantic search, provide a supported backend and
its model/URL/key through deployment secrets and environment configuration; keep it at `none` for
keyword-only, fully local operation.

## Exposure: authentication is required

The rendered base creates only a `ClusterIP` Service. It deliberately does **not** include an
Ingress or `HTTPRoute`, because Prax has no built-in authentication and anyone who reaches it
has full workspace read/write access. ClusterIP is internal to Kubernetes, not local-only: any pod
allowed to reach the Service by cluster network policy reaches an unauthenticated Prax API. The base
therefore ships `networkpolicy.yaml`, which admits traffic to port 3000 only from pods in Prax's own
namespace (kubelet probes and `kubectl port-forward` are unaffected). It is enforced only by a CNI
that implements NetworkPolicy; on one that does not, apply equivalent controls. Egress is not
restricted, because an operator may enable an embedding, chat or calendar provider.

The pod also runs without a service-account token (`automountServiceAccountToken: false`; Prax
never calls the Kubernetes API) and with the runtime's default seccomp profile.

`deploy/base/httproute.yaml` is an opt-in starting point, not a rendered resource. Before adding
it to an overlay, configure your Gateway implementation's authentication mechanism (for example
an OIDC-aware proxy, forward-auth filter, or provider-specific security policy) and TLS. Verify
that an unauthenticated request is rejected before publishing DNS. Gateway API core does not
define a portable authentication filter, so the exact policy is cluster-specific.

## Cluster-side Prerequisites

These must be in place before syncing — they are the cluster operator's responsibility:

1. **Default StorageClass** (or one the cluster binds automatically) so the `prax-data`
   PVC provisions — the manifest does not name a `storageClassName`.
2. If opting into network exposure, the selected Gateway must:
   - Be admitted by an extra ingress rule on the `prax` NetworkPolicy for the Gateway's namespace,
     added in the same authenticated overlay as the route.
   - Have `allowedRoutes` configured to permit routes from `prax-*` namespaces.
   - Enforce authentication for the Prax hostname before traffic reaches the Service.
   - Terminate TLS for `*.example.com`.
3. **DNS**, when exposed, for the hostname you add to the authenticated route.

## Local Render Check

No cluster needed — render any overlay with:

```bash
kubectl kustomize deploy/overlays/dev
kubectl kustomize deploy/overlays/staging
kubectl kustomize deploy/overlays/prod
```

## Health Checks

- `/healthz` — confirms the Node process is alive (startup and liveness probes). Pending migrations
  run before the server listens, so the startup probe allows ten minutes (`periodSeconds: 5`,
  `failureThreshold: 120`) for an upgrade's first start. SIGTERM during migrations stops at the
  next migration boundary and closes the database; the rest run on the next start.
- `/readyz` — confirms the embedded database answers a query; returns `503 not-ready` otherwise
  (readiness probe).

## Data Movement

The authoritative backup is a copy of the database file — see
[backup-restore.md](backup-restore.md) for taking a validated online snapshot with the shipped
`npm run backup` command or the Library dialog’s **Full workspace backup** ZIP (or a plain file copy while stopped), the Kubernetes
`kubectl exec`/`kubectl cp` recipe, and the rehearsed restore procedure.

For portability rather than backup, the Admin panel exports tasks as a `moomora.tasks` JSON
envelope and library documents as a ZIP of `.md` files. Import accepts current Prax Console
envelopes or raw task arrays, with append, skip duplicates, and replace-context modes.
