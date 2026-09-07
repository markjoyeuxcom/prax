# Security Policy

## Supported Versions

Prax is maintained by a single author. Only the latest release receives security
fixes; please upgrade to the newest version before reporting an issue.

| Version | Supported |
|---------|-----------|
| Latest release | ✅ |
| Older releases | ❌ |

## Reporting a Vulnerability

Please report security vulnerabilities **privately** as a
[confidential issue](https://gitlab.com/markjoyeuxcom/apps/prax/-/issues/new?issue%5Bconfidential%5D=true)
on the project (tick **This issue is confidential**), or by email to the maintainer if you have
no GitLab access. Do **not** open a public issue for a security problem.

Expect a best-effort response from a single maintainer. Reporters are credited in the resulting
advisory unless they ask to remain anonymous.

## Security Model & Scope

Understand the trust boundary before exposing Prax to a network:

- **No built-in authentication or authorization, by design.** Prax is built for
  single-user, trusted-network, or localhost operation. Anyone who can reach the HTTP port has
  full read/write access to every project, task, and document.
- **Network-exposed deployments must add their own auth.** Put authentication and TLS at the
  ingress / reverse-proxy layer. The Kubernetes base intentionally creates no `HTTPRoute`;
  [docs/deployment.md](docs/deployment.md) describes the required authenticated opt-in.
- **Accidental network binds fail closed.** Prax listens on `127.0.0.1` by default. Any
  non-loopback `HOST` also requires the exact operator acknowledgement
  `PRAX_ALLOW_UNAUTHENTICATED_NETWORK=true`. This flag adds no authentication; it only records that
  container, pod, or trusted-network reachability was deliberate.
- **No multi-tenant isolation.** The database holds a single logical workspace; there are no
  per-user boundaries.
- **Secrets come from the environment or the local settings database.** The SQLite path
  (`PRAX_DB_FILE`) and environment-provided provider keys are never committed. Provider keys
  configured in the local UI are stored in the single-user SQLite database, so protect backups
  and the database file as secrets.
- **Dependency scanning runs in CI.** Every merge request, push to `main` and release tag runs
  `npm audit --audit-level=high` in the GitLab pipeline; a high-severity advisory fails the
  pipeline and blocks a release.
- **Desktop Library export is user-bounded.** The localhost webview can request a Library ZIP save,
  but cannot supply a destination path. The Rust shell always opens the operating system Save dialog
  and writes only the path the user confirms; no general filesystem-write permission is exposed.
- **Settings access includes host process execution.** The Claude CLI backend runs the selected
  executable as the Prax process user. Provider URLs and credentials are also operator-controlled.
  Protect the entire HTTP surface, including Settings, with the same trusted-operator boundary;
  workspace access must not be granted to less-trusted automation or network clients.
- **Desktop localhost is process-bound, not broadly trusted.** The Node child binds its own
  loopback port and announces it over its parent-owned stdout. Its first OS-selected port is saved
  under the app-data directory and reused on relaunch so browser drafts/preferences keep their
  origin. An occupied saved port refuses startup; the shell never opens the occupying server. Rust permits navigation only to that
  exact origin (plus the bundled recovery page); a different localhost port cannot inherit the
  window's native capability. Served scripts are self-only under CSP, framing is denied, and the
  recovery-only restart command is unavailable to the localhost application origin.
