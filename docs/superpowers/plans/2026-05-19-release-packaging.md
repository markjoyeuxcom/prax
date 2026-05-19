# Release Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish Moomora Console Docker images to GitHub Container Registry from semver tags and provide a documented image-based local run path.

**Architecture:** Add a release workflow that resolves a semver version from either a pushed tag or manual dispatch input, checks out that ref, builds `deploy/Dockerfile`, and pushes multi-architecture GHCR image tags. Keep source-build Compose as the development default, and add a small Compose override for users who want to run the published image.

**Tech Stack:** GitHub Actions, Docker Buildx, QEMU, GitHub Container Registry, Docker Compose, Node.js 24.

---

### Task 1: Add Release Workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [x] **Step 1: Create the workflow**

Add `.github/workflows/release.yml` with:

```yaml
name: Release

on:
  push:
    tags:
      - "v*.*.*"
  workflow_dispatch:
    inputs:
      version:
        description: "Release tag to publish, for example v0.1.0"
        required: true
        type: string

permissions:
  contents: read
  packages: write

env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true
  REGISTRY: ghcr.io
  IMAGE_NAME: markjoyeuxcom/moomora-console

jobs:
  publish:
    name: Publish container image
    runs-on: ubuntu-latest

    steps:
      - name: Resolve release version
        id: release
        shell: bash
        env:
          VERSION_INPUT: ${{ github.event.inputs.version }}
        run: |
          version="${VERSION_INPUT}"
          if [ -z "$version" ]; then
            version="${GITHUB_REF_NAME}"
          fi

          if [[ ! "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
            echo "Release version must match vMAJOR.MINOR.PATCH, optionally with a prerelease suffix." >&2
            exit 1
          fi

          prerelease=false
          if [[ "$version" == *-* ]]; then
            prerelease=true
          fi

          echo "version=$version" >> "$GITHUB_OUTPUT"
          echo "prerelease=$prerelease" >> "$GITHUB_OUTPUT"

      - name: Checkout release ref
        uses: actions/checkout@v6
        with:
          ref: ${{ steps.release.outputs.version }}

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v4

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v4
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Generate image metadata
        id: meta
        uses: docker/metadata-action@v6
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=raw,value=${{ steps.release.outputs.version }}
            type=semver,pattern={{major}}.{{minor}},value=${{ steps.release.outputs.version }}
            type=semver,pattern={{major}},value=${{ steps.release.outputs.version }}
            type=raw,value=latest,enable=${{ steps.release.outputs.prerelease == 'false' }}
          labels: |
            org.opencontainers.image.title=Moomora Console
            org.opencontainers.image.description=Local-first homelab operations console for tasks, runbooks, and Markdown workflows.
            org.opencontainers.image.licenses=MIT

      - name: Build and push image
        uses: docker/build-push-action@v7
        with:
          context: .
          file: deploy/Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [x] **Step 2: Validate workflow syntax by inspection**

Run:

```bash
sed -n '1,240p' .github/workflows/release.yml
```

Expected: Workflow contains tag and manual dispatch triggers, `packages: write`, current Docker action majors, and Node 24 opt-in.

### Task 2: Add Compose Image Override

**Files:**
- Create: `compose.image.yaml`

- [x] **Step 1: Create the override**

Add `compose.image.yaml` with:

```yaml
services:
  app:
    image: ghcr.io/markjoyeuxcom/moomora-console:v0.1.0
    build: !reset null
```

- [x] **Step 2: Validate merged Compose config**

Run:

```bash
docker compose -f compose.yaml -f compose.image.yaml config
```

Expected: The rendered `app` service uses the GHCR image and does not include a `build` block.

### Task 3: Document Published Image Usage

**Files:**
- Modify: `README.md`

- [x] **Step 1: Add the published-image section**

Add a section after `Local Persistent Install`:

```markdown
## Run The Published Image

For release-style local testing, use the GitHub Container Registry image instead of building from source:

```bash
docker compose -f compose.yaml -f compose.image.yaml up
```

The image override uses:

```text
ghcr.io/markjoyeuxcom/moomora-console:v0.1.0
```

Use source-build Compose for development, and use the published image path when you want to test the same artifact Kubernetes will run.
```

- [x] **Step 2: Update script/release context if needed**

Review the README around Docker Compose and Homelab Deployment for contradictions.

Expected: The README clearly distinguishes source-build local development from published-image release testing.

### Task 4: Verify, Commit, Push, And Publish Existing Tag

**Files:**
- Verify: `.github/workflows/release.yml`
- Verify: `compose.image.yaml`
- Verify: `README.md`

- [x] **Step 1: Run local verification**

Run:

```bash
npm run check
npm test
git diff --check
```

Expected: All commands exit 0.

- [x] **Step 2: Commit implementation**

Run:

```bash
git add .github/workflows/release.yml compose.image.yaml README.md docs/superpowers/plans/2026-05-19-release-packaging.md
git commit -m "ci: publish release images"
```

Expected: Commit succeeds.

- [x] **Step 3: Push main**

Run:

```bash
git push
```

Expected: `main` pushes to `origin/main`.

- [x] **Step 4: Run the release workflow for existing tag**

Run:

```bash
gh workflow run release.yml --repo markjoyeuxcom/moomora-console --ref main -f version=v0.1.0
```

Expected: GitHub accepts the manual workflow dispatch.

- [x] **Step 5: Watch the release workflow**

Run:

```bash
gh run list --repo markjoyeuxcom/moomora-console --workflow Release --limit 1 --json databaseId --jq '.[0].databaseId'
gh run list --repo markjoyeuxcom/moomora-console --workflow Release --limit 1 --json databaseId --jq '.[0].databaseId' | xargs -I{} gh run watch {} --repo markjoyeuxcom/moomora-console --exit-status
```

Expected: The first command prints the latest release workflow run id. The second command watches that run and exits 0 when the release workflow completes successfully.

- [x] **Step 6: Verify package image is usable**

Run:

```bash
docker pull ghcr.io/markjoyeuxcom/moomora-console:v0.1.0
docker compose -f compose.yaml -f compose.image.yaml config
```

Expected: Docker can pull the image, and Compose points the app service at the published image.

Note: The `v0.1.0` image has been verified with authenticated GHCR access and runs through the Compose image override. The GHCR package visibility is still private and must be changed once in the GitHub package settings before anonymous public pulls work.
