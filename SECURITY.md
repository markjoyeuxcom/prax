# Security Policy

## Supported Versions

Prax is maintained by a single author. Only the latest release receives security
fixes; please upgrade to the newest version before reporting an issue.

| Version | Supported |
|---------|-----------|
| Latest release | ✅ |
| Older releases | ❌ |

## Reporting a Vulnerability

Please report security vulnerabilities **privately** through GitHub's
[private vulnerability reporting](https://github.com/awaybreaktoday/prax/security/advisories/new)
("Report a vulnerability" under the repository's **Security** tab). Do **not** open a public
issue for a security problem.

Expect a best-effort response from a single maintainer. Reporters are credited in the resulting
advisory unless they ask to remain anonymous.

## Security Model & Scope

Understand the trust boundary before exposing Prax to a network:

- **No built-in authentication or authorization, by design.** Prax is built for
  single-user, trusted-network, or localhost operation. Anyone who can reach the HTTP port has
  full read/write access to every project, task, and document.
- **Network-exposed deployments must add their own auth.** Put authentication and TLS at the
  ingress / reverse-proxy layer. See [docs/deployment.md](docs/deployment.md), which covers
  ingress-layer authentication for Kubernetes.
- **No multi-tenant isolation.** The database holds a single logical workspace; there are no
  per-user boundaries.
- **Secrets come from the environment.** The database connection string (`DATABASE_URL`, or the
  CloudNativePG app secret in Kubernetes) is read from the environment and never committed to
  the repository.
- **Dependency scanning runs in CI.** Every push and pull request runs `npm audit
  --audit-level=high`, and pull requests additionally run GitHub's dependency-review action.
