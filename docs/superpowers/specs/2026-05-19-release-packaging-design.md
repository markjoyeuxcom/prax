# Release Packaging Design

## Goal

Publish installable Moomora Console container images to GitHub Container Registry so release tags produce durable artifacts that can be used by Docker Compose and Kubernetes.

## Scope

This release packaging work covers:

- a GitHub Actions workflow for building and publishing container images
- semver tag handling for `v*.*.*` releases
- a manual workflow dispatch path for publishing an existing tag such as `v0.1.0`
- multi-architecture images for `linux/amd64` and `linux/arm64`
- README updates for running the published image
- an optional Compose override for running GHCR images instead of building from source

This work does not cover:

- rewriting or moving the existing `v0.1.0` tag
- application authentication
- database backup automation
- Kubernetes deployment hardening beyond publishing a multi-architecture container image

## Release Workflow

Add `.github/workflows/release.yml`.

The workflow runs on:

- pushed tags matching `v*.*.*`
- manual `workflow_dispatch` with an optional `version` input

The workflow builds from `deploy/Dockerfile` and pushes to:

- `ghcr.io/markjoyeuxcom/moomora-console:<semver>`
- `ghcr.io/markjoyeuxcom/moomora-console:<major>.<minor>`
- `ghcr.io/markjoyeuxcom/moomora-console:<major>`
- `ghcr.io/markjoyeuxcom/moomora-console:latest`

For pre-release versions, `latest` should not be published.

The workflow uses GitHub's `GITHUB_TOKEN` with:

- `contents: read`
- `packages: write`

It should keep the existing Node 24 JavaScript action opt-in:

- `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true`

## Image Metadata

The image should include OCI labels for:

- source repository
- image description
- license
- revision
- version

Use `docker/metadata-action` for tags and labels, and `docker/build-push-action` for the build/push step.

Publish `linux/amd64` and `linux/arm64` images so the release works on standard Kubernetes nodes and Apple Silicon local testing.

## Existing Tag Handling

The existing `v0.1.0` tag should stay where it is. It marks the local deploy baseline.

To publish an image for that existing tag after this workflow is merged, use the manual workflow dispatch path with `version` set to `v0.1.0`.

Future tags should publish automatically when pushed.

## Compose Image Override

Keep `compose.yaml` as the default source-build local development flow.

Add `compose.image.yaml` as an optional override:

```bash
docker compose -f compose.yaml -f compose.image.yaml up
```

The override replaces the `app` build with:

```text
ghcr.io/markjoyeuxcom/moomora-console:v0.1.0
```

Users can change the tag when testing a different release.

## README Updates

Update the README with:

- a published-image install option
- the GHCR image name
- the Compose override command
- a note that source-build Compose remains the recommended development path

## Verification

Local verification:

- `npm run check`
- `npm test`
- `git diff --check`

Remote verification:

- push the workflow change
- manually run the release workflow for `v0.1.0`
- confirm the package appears under GitHub Packages
- confirm the image can be pulled or used by Docker Compose
