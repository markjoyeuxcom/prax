# Moomora Console Kubernetes Deployment

Moomora Console runs as one Node container that serves the frontend and API. It expects a CloudNativePG application secret and uses the secret's `uri` key as `DATABASE_URL`.

## Requirements

- Kubernetes cluster
- Ingress controller
- CloudNativePG Postgres cluster
- CloudNativePG app secret named `moomora-console-db-app` in the same namespace
- Container image available to the cluster as `moomora-console:latest`, or an edited image name in `deploy/k8s/deployment.yaml`

CloudNativePG app secrets include connection fields such as `username`, `password`, `host`, `port`, `dbname`, and `uri`. The manifests use `uri` directly to avoid constructing a connection string in Kubernetes YAML.

## Postgres cluster (pgvector for semantic search)

The repo's `deploy/k8s/` manifests deploy the **app**, not the database — you provision a CloudNativePG `Cluster` that produces the `moomora-console-db-app` secret. The core schema works on any PostgreSQL 16+ cluster, but the **optional semantic search** feature requires the `pgvector` extension (migration `0005` runs `CREATE EXTENSION vector`), and the stock CloudNativePG images do **not** ship pgvector.

To enable it:

1. **Build a pgvector image** from the bundled Dockerfile (it adds the `postgresql-18-pgvector` package to the official CloudNativePG base, keeping the operator entrypoint and the postgres UID 26 intact). Pin the base tag to a current published tag from `ghcr.io/cloudnative-pg/postgresql`:

   ```bash
   docker build -t <your-registry>/moomora-pgvector:18 deploy/postgres
   docker push   <your-registry>/moomora-pgvector:18
   ```

2. **Provision the cluster** from the example (adapt instances/storage/registry):

   ```bash
   kubectl apply -f deploy/k8s/postgres-cluster.example.yaml
   ```

   The example sets `imageName` to your pgvector image and **pre-creates the extension** at bootstrap via `postInitApplicationSQL: ["CREATE EXTENSION IF NOT EXISTS vector"]`. This matters because pgvector is **not** a "trusted" extension, so the non-superuser application role the app runs migrations as cannot `CREATE EXTENSION` it — it must be created by a superuser at bootstrap. Migration `0005`'s `CREATE EXTENSION IF NOT EXISTS vector` then becomes a harmless no-op.

If you don't use semantic search, any PostgreSQL cluster that produces the `moomora-console-db-app` secret works — no pgvector image needed.

## Database Schema

The app applies database migrations automatically on startup, so deploying the container is sufficient to initialise or upgrade the schema. To apply migrations explicitly — for example from a pre-deploy Job — run the bundled script against the database:

```bash
DATABASE_URL=$(kubectl get secret moomora-console-db-app -o jsonpath='{.data.uri}' | base64 -d)
DATABASE_URL="$DATABASE_URL" npm run migrate
```

Migrations are forward-only and tracked in a `schema_migrations` table; re-running is safe (already-applied migrations are skipped).

## Build Image

```bash
docker build -f deploy/Dockerfile -t moomora-console:latest .
```

For a multi-node cluster, push the image to a registry your nodes can pull from and update `image` in `deploy/k8s/deployment.yaml`.

## Apply Manifests

```bash
kubectl apply -f deploy/k8s/configmap.yaml
kubectl apply -f deploy/k8s/deployment.yaml
kubectl apply -f deploy/k8s/service.yaml
kubectl apply -f deploy/k8s/ingress.yaml
```

## Semantic search (optional)

Semantic search is off by default (`EMBEDDING_BACKEND=none`). To enable it in-cluster, set the embedding env vars on the app — non-secret values in the ConfigMap, the API key (if any) in a Secret:

1. Add non-secret config to `deploy/k8s/configmap.yaml`, e.g. for an OpenAI-compatible endpoint:

   ```yaml
   EMBEDDING_BACKEND: "openai"
   EMBEDDING_MODEL: "text-embedding-3-small"
   OPENAI_BASE_URL: "https://api.openai.com/v1"
   # EMBEDDING_QUERY_PREFIX: "search_query: "   # for instruct-tuned models
   ```

   (For Ollama: `EMBEDDING_BACKEND: "ollama"`, `OLLAMA_URL: "http://<ollama-host>:11434"`, `EMBEDDING_MODEL: "qwen3-embedding:0.6b"`.) The app already loads the ConfigMap via `envFrom`.

2. Put the API key in a Secret and reference it in `deploy/k8s/deployment.yaml`'s `env:` — never in the ConfigMap:

   ```bash
   kubectl create secret generic moomora-embedding --from-literal=OPENAI_API_KEY=sk-...
   ```

   ```yaml
   env:
     - name: OPENAI_API_KEY
       valueFrom:
         secretKeyRef:
           name: moomora-embedding
           key: OPENAI_API_KEY
   ```

The Postgres cluster must be pgvector-capable (see "Postgres cluster" above). All embedding config is env-only and never exposed through the no-auth web UI — it shows only a read-only status and an on/off toggle.

## Health Checks

- `/healthz` checks that the Node process is alive.
- `/readyz` checks database connectivity through `DATABASE_URL`.

## Ingress

The default host is `moomora-console.home.arpa`. Change it in `deploy/k8s/ingress.yaml` to match your cluster's DNS and put authentication at the ingress layer.

## Data Movement

Moomora Console exports backups with the `moomora.tasks` format. Import accepts current Moomora Console envelopes or raw task arrays, with append, skip duplicates, and replace-context modes available from the Admin panel.
