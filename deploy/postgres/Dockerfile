# pgvector-enabled PostgreSQL image for CloudNativePG.
#
# Moomora Console's semantic search requires the `vector` extension (migration
# 0005 runs `CREATE EXTENSION vector`). The stock CloudNativePG PostgreSQL images
# do NOT ship pgvector, so build this image and point your CNPG Cluster's
# `imageName` at it (see deploy/k8s/postgres-cluster.example.yaml).
#
# Build & push (pin the base tag to a CURRENT published tag from
# ghcr.io/cloudnative-pg/postgresql — do not use a moving tag in production):
#
#   docker build -t <your-registry>/moomora-pgvector:18 deploy/postgres
#   docker push   <your-registry>/moomora-pgvector:18
#
# The base is the official CloudNativePG PostgreSQL image; we only add the
# pgvector apt package, keeping the operator's entrypoint and the postgres user
# (UID 26) intact — both are required for CloudNativePG to manage the cluster.

ARG CNPG_POSTGRES_TAG=18-bookworm
FROM ghcr.io/cloudnative-pg/postgresql:${CNPG_POSTGRES_TAG}

USER root

# PGDG ships pgvector as `postgresql-<major>-pgvector`. The major version must
# match the base image (18 here); bump both together when you change the base.
RUN set -xe; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-18-pgvector; \
    rm -fr /tmp/*; \
    rm -rf /var/lib/apt/lists/*

# IMPORTANT: switch back to the postgres user (UID 26) that CloudNativePG expects.
USER 26
