# deploy/ — example Kubernetes manifests

**Sanitized examples for self-hosters, not a turnkey config.** A Kustomize **base + overlays**
(dev / staging / prod) that deploys Prax with its embedded SQLite database on a
PersistentVolumeClaim (`base/pvc.yaml`, mounted at `/data`, `PRAX_DB_FILE=/data/prax.db`;
`Recreate` strategy + single replica because SQLite is single-writer) and a Gateway API
`HTTPRoute`. The maintainer's live deployment config is kept in a separate private GitOps
repo — this tree is here as a reference starting point.

## Adapt the placeholders before use

- `base/configmap.yaml` → `EMBEDDING_BACKEND` stays `none` until the sqlite-vec follow-up
  restores semantic search.
- `base/httproute.yaml` → `parentRefs` (the example points at an `external-gateway` in
  `gateway-system`).
- `overlays/<env>/kustomization.yaml` → the `*.example.com` hostnames and the image `newTag`.

## Render locally (no cluster needed)

```bash
kubectl kustomize deploy/overlays/dev
```

See [../docs/deployment.md](../docs/deployment.md) for the full notes and the cluster-side
prerequisites (a default StorageClass for the PVC, Gateway `allowedRoutes`/TLS, DNS).

> `deploy/Dockerfile` is the application image build (used by `compose.yaml` and the release
> workflow) — it is not part of the Kubernetes manifests.
