# Kubernetes Deploy — Workload Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Kustomize `deploy/base` + `deploy/overlays/{dev,staging,prod}` structure conforming to the homelab Argo CD workloads ApplicationSet contract, so Moomora Console (app + per-env CNPG pgvector Postgres + HTTPRoute, embeddings on) deploys to three environments.

**Architecture:** A single env-agnostic `base/` (no namespace — Argo injects `moomora-console-<env>`) holds the ConfigMap, Deployment, Service, HTTPRoute, and a CloudNativePG `Cluster` on the public `ghcr.io/cloudnative-pg/pgvector` image. Each overlay pins the app image tag (`v0.15.0`) and patches the per-env hostname. The legacy flat `deploy/k8s/` manifests are removed and the docs reconciled.

**Tech Stack:** Kustomize (v5), Gateway API (`HTTPRoute`), CloudNativePG (`Cluster`), Argo CD. Verification is offline via `kubectl kustomize` (no cluster needed).

**Spec:** `docs/superpowers/specs/2026-06-04-k8s-deploy-workload-design.md`

**Branch:** `k8s-deploy-workload` (already created).

---

## File Structure

**Create:**
- `deploy/base/kustomization.yaml` — lists the five base resources.
- `deploy/base/configmap.yaml` — `moomora-console-config` (HOST/PORT/PUBLIC_DIR + EMBEDDING_*).
- `deploy/base/deployment.yaml` — the app Deployment (probes, security context, DB secret env).
- `deploy/base/service.yaml` — ClusterIP `moomora-console` on port 3000.
- `deploy/base/httproute.yaml` — Gateway API route → `external-gateway`, placeholder hostname.
- `deploy/base/cluster.yaml` — CNPG `Cluster` `moomora-console-db` on the pgvector image.
- `deploy/overlays/dev/kustomization.yaml`
- `deploy/overlays/staging/kustomization.yaml`
- `deploy/overlays/prod/kustomization.yaml`

**Delete:**
- `deploy/k8s/configmap.yaml`, `deploy/k8s/deployment.yaml`, `deploy/k8s/ingress.yaml`, `deploy/k8s/service.yaml`, `deploy/k8s/postgres-cluster.example.yaml` (the whole `deploy/k8s/` directory).

**Modify:**
- `README.md` — replace the `## Kubernetes Deployment` section.
- `docs/deployment.md` — reconcile to the base/overlays + Argo flow.

**Keep untouched:** `deploy/Dockerfile`, `deploy/postgres/Dockerfile`.

**Verification convention:** these are static manifests, so "tests" = `kubectl kustomize <path>` rendering cleanly + `grep` assertions on the output. No cluster is contacted.

---

## Task 1: `deploy/base` manifests

**Files:**
- Create: `deploy/base/configmap.yaml`, `deploy/base/deployment.yaml`, `deploy/base/service.yaml`, `deploy/base/httproute.yaml`, `deploy/base/cluster.yaml`, `deploy/base/kustomization.yaml`

- [ ] **Step 1: Create `deploy/base/configmap.yaml`**

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: moomora-console-config
  labels:
    app.kubernetes.io/name: moomora-console
data:
  HOST: "0.0.0.0"
  PORT: "3000"
  PUBLIC_DIR: "/app/public"
  EMBEDDING_BACKEND: "ollama"
  OLLAMA_URL: "http://172.16.16.10:11434"
  EMBEDDING_MODEL: "qwen3-embedding:0.6b"
```

- [ ] **Step 2: Create `deploy/base/deployment.yaml`**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: moomora-console
  labels:
    app.kubernetes.io/name: moomora-console
  annotations:
    argocd.argoproj.io/sync-wave: "1"
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app.kubernetes.io/name: moomora-console
  template:
    metadata:
      labels:
        app.kubernetes.io/name: moomora-console
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000
      volumes:
        - name: tmp
          emptyDir: {}
      containers:
        - name: moomora-console
          image: ghcr.io/awaybreaktoday/moomora-console:v0.15.0
          imagePullPolicy: IfNotPresent
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
          envFrom:
            - configMapRef:
                name: moomora-console-config
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: moomora-console-db-app
                  key: uri
          ports:
            - containerPort: 3000
              name: http
          startupProbe:
            httpGet:
              path: /healthz
              port: http
            periodSeconds: 2
            failureThreshold: 30
          livenessProbe:
            httpGet:
              path: /healthz
              port: http
            periodSeconds: 20
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            periodSeconds: 10
          volumeMounts:
            - name: tmp
              mountPath: /tmp
          resources:
            requests:
              cpu: 50m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
```

- [ ] **Step 3: Create `deploy/base/service.yaml`**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: moomora-console
  labels:
    app.kubernetes.io/name: moomora-console
spec:
  selector:
    app.kubernetes.io/name: moomora-console
  ports:
    - name: http
      port: 3000
      targetPort: http
```

- [ ] **Step 4: Create `deploy/base/httproute.yaml`**

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: moomora-console
  labels:
    app.kubernetes.io/name: moomora-console
spec:
  parentRefs:
    - name: external-gateway
      namespace: envoy-gateway-system
  hostnames:
    - moomora-console.invalid
  rules:
    - backendRefs:
        - name: moomora-console
          port: 3000
```

- [ ] **Step 5: Create `deploy/base/cluster.yaml`**

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: moomora-console-db
  labels:
    app.kubernetes.io/name: moomora-console
  annotations:
    argocd.argoproj.io/sync-wave: "0"
spec:
  instances: 1
  imageName: ghcr.io/cloudnative-pg/pgvector:0.8.2-18-trixie
  storage:
    size: 5Gi
  bootstrap:
    initdb:
      database: app
      owner: app
      postInitApplicationSQL:
        - CREATE EXTENSION IF NOT EXISTS vector
```

- [ ] **Step 6: Create `deploy/base/kustomization.yaml`**

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - configmap.yaml
  - cluster.yaml
  - deployment.yaml
  - service.yaml
  - httproute.yaml
```

- [ ] **Step 7: Verify the base renders**

Run: `kubectl kustomize deploy/base`
Expected: renders five documents (ConfigMap, Cluster, Deployment, Service, HTTPRoute) with no error.

- [ ] **Step 8: Verify no resource pins its own namespace**

Run: `kubectl kustomize deploy/base | grep -n "namespace:"`
Expected: exactly ONE match — `namespace: envoy-gateway-system` (the HTTPRoute `parentRefs`). No `namespace:` under any resource's `metadata`. (If any other `namespace:` appears, a manifest wrongly sets one — remove it.)

- [ ] **Step 9: Verify the key wiring is present**

Run:
```bash
kubectl kustomize deploy/base | grep -E "image: ghcr.io/awaybreaktoday/moomora-console|imageName: ghcr.io/cloudnative-pg/pgvector|name: moomora-console-db-app|key: uri|CREATE EXTENSION IF NOT EXISTS vector"
```
Expected: all five lines present (app image, pgvector image, DB secret name, `uri` key, the extension SQL).

- [ ] **Step 10: Commit**

```bash
git add deploy/base
git commit -m "feat(deploy): kustomize base (app + CNPG pgvector + HTTPRoute)"
```

---

## Task 2: `deploy/overlays/{dev,staging,prod}`

**Files:**
- Create: `deploy/overlays/dev/kustomization.yaml`, `deploy/overlays/staging/kustomization.yaml`, `deploy/overlays/prod/kustomization.yaml`

- [ ] **Step 1: Create `deploy/overlays/dev/kustomization.yaml`**

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
images:
  - name: ghcr.io/awaybreaktoday/moomora-console
    newTag: v0.15.0
patches:
  - target:
      kind: HTTPRoute
      name: moomora-console
    patch: |
      - op: replace
        path: /spec/hostnames/0
        value: moomora-console-dev.markjoyeux.uk
```

- [ ] **Step 2: Create `deploy/overlays/staging/kustomization.yaml`**

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
images:
  - name: ghcr.io/awaybreaktoday/moomora-console
    newTag: v0.15.0
patches:
  - target:
      kind: HTTPRoute
      name: moomora-console
    patch: |
      - op: replace
        path: /spec/hostnames/0
        value: moomora-console-staging.markjoyeux.uk
```

- [ ] **Step 3: Create `deploy/overlays/prod/kustomization.yaml`**

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
images:
  - name: ghcr.io/awaybreaktoday/moomora-console
    newTag: v0.15.0
patches:
  - target:
      kind: HTTPRoute
      name: moomora-console
    patch: |
      - op: replace
        path: /spec/hostnames/0
        value: moomora-console.markjoyeux.uk
```

- [ ] **Step 4: Verify each overlay renders with the right host + image**

Run:
```bash
for env in dev staging prod; do
  echo "== $env =="
  kubectl kustomize deploy/overlays/$env | grep -E "image: ghcr.io/awaybreaktoday/moomora-console:v0.15.0|- moomora-console.*markjoyeux.uk"
done
```
Expected:
- dev → `- moomora-console-dev.markjoyeux.uk`
- staging → `- moomora-console-staging.markjoyeux.uk`
- prod → `- moomora-console.markjoyeux.uk`
- every env shows `image: ghcr.io/awaybreaktoday/moomora-console:v0.15.0`.

- [ ] **Step 5: Verify the placeholder host is gone and no own-namespace leaked**

Run:
```bash
for env in dev staging prod; do
  echo "== $env =="
  kubectl kustomize deploy/overlays/$env | grep -c "moomora-console.invalid"   # expect 0
  kubectl kustomize deploy/overlays/$env | grep "namespace:"                    # expect only envoy-gateway-system
done
```
Expected: `moomora-console.invalid` count is `0` for every env; the only `namespace:` line is `namespace: envoy-gateway-system`.

If `moomora-console.invalid` still appears, the JSON6902 patch didn't apply — confirm `path: /spec/hostnames/0` matches the single placeholder entry in `base/httproute.yaml`.

- [ ] **Step 6: Commit**

```bash
git add deploy/overlays
git commit -m "feat(deploy): dev/staging/prod overlays (pinned v0.15.0 + per-env host)"
```

---

## Task 3: Remove legacy `deploy/k8s` + reconcile docs

**Files:**
- Delete: `deploy/k8s/` (all five manifests)
- Modify: `README.md`, `docs/deployment.md`

- [ ] **Step 1: Remove the legacy flat manifests**

```bash
git rm deploy/k8s/configmap.yaml deploy/k8s/deployment.yaml deploy/k8s/ingress.yaml deploy/k8s/service.yaml deploy/k8s/postgres-cluster.example.yaml
```
Confirm `deploy/k8s/` is now empty/removed: `ls deploy/k8s 2>&1` should report no such directory.

- [ ] **Step 2: Replace the README Kubernetes section**

In `README.md`, replace the entire `## Kubernetes Deployment` section (which currently points at `deploy/k8s` and `deploy/k8s/postgres-cluster.example.yaml`) with:

```markdown
## Kubernetes Deployment

Deployment manifests use a Kustomize **base + overlays** layout under `deploy/`, designed for GitOps
with Argo CD:

```text
deploy/base/                          # env-agnostic manifests (no namespace)
deploy/overlays/{dev,staging,prod}/   # per-env image tag + hostname
```

A homelab Argo CD ApplicationSet auto-discovers this repo and creates one Application per
environment, deploying `deploy/overlays/<env>` into namespace `moomora-console-<env>` (the namespace
is injected by Argo — no manifest sets one).

Each environment provisions its own CloudNativePG `Cluster` (`moomora-console-db`) on the public
pgvector image `ghcr.io/cloudnative-pg/pgvector`, which generates the `moomora-console-db-app`
secret; the app reads its `uri` key as `DATABASE_URL`. Semantic search is enabled through the
ConfigMap (`EMBEDDING_BACKEND=ollama`, `OLLAMA_URL`, `EMBEDDING_MODEL`), and the app is exposed via a
Gateway API `HTTPRoute` attached to the cluster's external gateway.

Render any environment locally (no cluster needed):

```bash
kubectl kustomize deploy/overlays/dev
```

See [docs/deployment.md](docs/deployment.md) for the full notes, including the cluster-side
prerequisites (Gateway `allowedRoutes`/TLS, DNS, Ollama reachability).
```

- [ ] **Step 3: Reconcile `docs/deployment.md`**

Read `docs/deployment.md`, then update it so it accurately describes the new layout. It MUST:
- Replace every reference to `deploy/k8s/...` with the `deploy/base` + `deploy/overlays/<env>` layout and the Argo CD ApplicationSet flow (one Application per env, namespace `moomora-console-<env>`, `CreateNamespace=true`, no `namespace:` in manifests).
- State that the CNPG `Cluster` now uses the **public** image `ghcr.io/cloudnative-pg/pgvector:0.8.2-18-trixie` (building from `deploy/postgres/Dockerfile` is no longer required; keep it only as an alternative for custom builds).
- Document that semantic search is enabled via the ConfigMap env (`EMBEDDING_BACKEND=ollama`, `OLLAMA_URL=http://172.16.16.10:11434`, `EMBEDDING_MODEL=qwen3-embedding:0.6b`).
- List the cluster-side prerequisites: CNPG operator installed; `external-gateway` (in `envoy-gateway-system`) must `allowedRoutes` from `moomora-console-*` namespaces and terminate TLS for `*.markjoyeux.uk`; DNS for the three hosts; pod → `172.16.16.10:11434` reachability.
- Document the per-env hostnames (dev/staging/prod) and that overlays are pinned to `v0.15.0` (CI-driven `newTag` bumping is a future addition).
- Show the local render check: `kubectl kustomize deploy/overlays/<env>`.

- [ ] **Step 4: Confirm no stale references remain**

Run: `grep -rn "deploy/k8s" README.md docs/ ; echo "exit: $?"`
Expected: no matches (grep exit status `1`). If any line still references `deploy/k8s`, fix it.

- [ ] **Step 5: Final render check (all three overlays still build after the deletion)**

Run:
```bash
for env in dev staging prod; do kubectl kustomize deploy/overlays/$env >/dev/null && echo "$env OK"; done
```
Expected: `dev OK`, `staging OK`, `prod OK`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(deploy): remove legacy deploy/k8s; reconcile README + deployment docs"
```

---

## Self-Review Checklist (run before opening the PR)

- **Spec coverage:** base manifests (T1), overlays with per-env host + pinned image (T2), legacy removal + doc reconcile (T3), `kubectl kustomize` verification (every task). ✓
- **No `namespace:` contract:** asserted in T1 Step 8 and T2 Step 5 — the only `namespace:` is the HTTPRoute `parentRefs` to `envoy-gateway-system`. ✓
- **Name consistency:** `moomora-console` (Deployment/Service/HTTPRoute/ConfigMap base name), `moomora-console-config`, `moomora-console-db` (Cluster), `moomora-console-db-app` (secret), image `ghcr.io/awaybreaktoday/moomora-console:v0.15.0`, pgvector `ghcr.io/cloudnative-pg/pgvector:0.8.2-18-trixie`, port `3000`/`http` — used identically across all tasks. ✓
- **Secret/DB wiring:** `DATABASE_URL` ← `moomora-console-db-app` key `uri`; the Cluster name `moomora-console-db` is what generates that secret. ✓
- **Deferred scope honored:** no CI workflow, no prod HA, no backups — all noted as future work in the spec/README. ✓
