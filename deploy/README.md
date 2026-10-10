# deploy/ — example Kubernetes manifests

**Sanitized examples for self-hosters, not a turnkey config.** A Kustomize **base + overlays**
(dev / staging / prod) that deploys Prax with its embedded SQLite database on a
PersistentVolumeClaim (`base/pvc.yaml`, mounted at `/data`, `PRAX_DB_FILE=/data/prax.db`;
`Recreate` strategy + single replica because SQLite is single-writer). An unaffiliated Gateway
API `HTTPRoute` is retained as an opt-in example but is deliberately not rendered. The
maintainer's live deployment config is kept in a separate private GitOps
repo — this tree is here as a reference starting point.

## Adapt the placeholders before use

- `base/configmap.yaml` → keep `EMBEDDING_BACKEND` at `none` until an operator deliberately chooses
  an embedding provider. `PRAX_ALLOW_UNAUTHENTICATED_NETWORK=true` acknowledges the pod-network
  listener; it does not claim the Service is authenticated.
- `overlays/<env>/kustomization.yaml` → the image name and `newTag`. **No image is published for
  you.** The pipeline builds desktop packages only, and the last container image published was
  `v0.30.0`, to the GitLab registry before the move back to GitHub. The `ghcr.io/markjoyeuxcom/prax:v<version>` references in these
  manifests follow this checkout's version (the release script bumps them) and name the image you
  build from `deploy/Dockerfile` and push to a registry you control; point `images:` at it.
- `base/networkpolicy.yaml` admits traffic to Prax only from pods in its own namespace. An
  overlay that adds a route must also admit its gateway's namespace.
- To expose Prax, copy/adapt `base/httproute.yaml` into an authenticated overlay and ensure the
  Gateway or provider-specific policy enforces authentication before forwarding to the Service.

## Render locally (no cluster needed)

```bash
kubectl kustomize deploy/overlays/dev
```

See [../docs/deployment.md](../docs/deployment.md) for the full notes and the cluster-side
prerequisites (a default StorageClass for the PVC, Gateway `allowedRoutes`/TLS, DNS).

> `deploy/Dockerfile` is the application image build (used by `compose.yaml` and for images you
> build and push yourself; the release pipeline builds no image) — it is not part of the
> Kubernetes manifests.
