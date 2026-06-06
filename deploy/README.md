# deploy/ — example Kubernetes manifests

**Sanitized examples for self-hosters, not a turnkey config.** A Kustomize **base + overlays**
(dev / staging / prod) that deploys Moomora Console with a CloudNativePG `pgvector` database (mounted
as an ImageVolume extension) and a Gateway API `HTTPRoute`. The maintainer's live deployment config
is kept in a separate private GitOps repo — this tree is here as a reference starting point.

## Adapt the placeholders before use

- `base/configmap.yaml` → `OLLAMA_URL` (currently `http://ollama.internal:11434`) and
  `EMBEDDING_MODEL`.
- `base/httproute.yaml` → `parentRefs` (the example points at an `external-gateway` in
  `gateway-system`).
- `overlays/<env>/kustomization.yaml` → the `*.example.com` hostnames and the image `newTag`.

## Render locally (no cluster needed)

```bash
kubectl kustomize deploy/overlays/dev
```

See [../docs/deployment.md](../docs/deployment.md) for the full notes and the cluster-side
prerequisites (CNPG operator, Gateway `allowedRoutes`/TLS, DNS, Ollama reachability).

> `deploy/Dockerfile` is the application image build (used by `compose.yaml` and the release
> workflow) — it is not part of the Kubernetes manifests.
