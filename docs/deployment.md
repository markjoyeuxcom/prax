# Moomora Console Kubernetes Deployment

Moomora Console runs as one Node container that serves the frontend and API. It expects a CloudNativePG application secret and uses the secret's `uri` key as `DATABASE_URL`.

## Requirements

- Kubernetes cluster
- Ingress controller
- CloudNativePG Postgres cluster
- CloudNativePG app secret named `moomora-console-db-app` in the same namespace
- Container image available to the cluster as `moomora-console:latest`, or an edited image name in `deploy/k8s/deployment.yaml`

CloudNativePG app secrets include connection fields such as `username`, `password`, `host`, `port`, `dbname`, and `uri`. The manifests use `uri` directly to avoid constructing a connection string in Kubernetes YAML.

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

## Health Checks

- `/healthz` checks that the Node process is alive.
- `/readyz` checks database connectivity through `DATABASE_URL`.

## Ingress

The default host is `console.example.internal`. Change it in `deploy/k8s/ingress.yaml` to match your cluster's DNS and put authentication at the ingress layer.

## Data Movement

Moomora Console exports backups with the `moomora.tasks` format. Import accepts current Moomora Console envelopes or raw task arrays, with append, skip duplicates, and replace-context modes available from the Admin panel.
