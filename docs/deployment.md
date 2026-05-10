# TaskBoard Homelab Deployment

TaskBoard runs as one Node container that serves the frontend and API. It expects a CloudNativePG application secret and uses the secret's `uri` key as `DATABASE_URL`.

## Requirements

- Kubernetes cluster
- Ingress controller
- CloudNativePG Postgres cluster
- CloudNativePG app secret named `taskboard-db-app` in the same namespace
- Container image available to the cluster as `taskboard:latest`, or an edited image name in `deploy/k8s/deployment.yaml`

CloudNativePG app secrets include connection fields such as `username`, `password`, `host`, `port`, `dbname`, and `uri`. The manifests use `uri` directly to avoid constructing a connection string in Kubernetes YAML.

## Database Schema

Apply the schema before starting the app against a new database:

```bash
DATABASE_URL=$(kubectl get secret taskboard-db-app -o jsonpath='{.data.uri}' | base64 -d)
psql "$DATABASE_URL" -f server/schema.sql
```

If you prefer not to expose the URI in your shell, run `psql` from a temporary pod in the same namespace and mount/read the `taskboard-db-app` secret there.

## Build Image

```bash
docker build -f deploy/Dockerfile -t taskboard:latest .
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

The default host is `taskboard.example.internal`. Change it in `deploy/k8s/ingress.yaml` to match your homelab DNS and put authentication at the ingress layer.

## Migration

The current backend exposes task CRUD endpoints. Import/export buttons are present in the UI shell for the next workflow layer, but JSON import is not wired yet.
