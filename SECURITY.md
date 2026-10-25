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
[private vulnerability reporting](https://github.com/markjoyeuxcom/prax/security/advisories/new)
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
  ingress / reverse-proxy layer. The Kubernetes base intentionally creates no `HTTPRoute`;
  [docs/deployment.md](docs/deployment.md) describes the required authenticated opt-in.
- **Accidental network binds fail closed.** Prax listens on `127.0.0.1` by default. Any
  non-loopback `HOST` also requires the exact operator acknowledgement
  `PRAX_ALLOW_UNAUTHENTICATED_NETWORK=true`. This flag adds no authentication; it only records that
  container, pod, or trusted-network reachability was deliberate.
- **No multi-tenant isolation.** The database holds a single logical workspace; there are no
  per-user boundaries.
- **Every account on the machine is trusted.** The loopback API has no credential, so any process
  on the same computer, including one run by another user account, can use it: read the whole
  workspace (a workspace backup includes stored provider keys and the Google refresh token),
  change Settings, and choose the local CLI that Prax runs. Run Prax only on a computer whose
  accounts you trust with that access. Loopback binding protects against other machines, not
  other users of this one. This is a deliberate decision (2026-09-22) for a single-user desktop;
  a per-launch token for the desktop app remains an option if that assumption changes.
- **Secrets come from the environment or the local settings database.** The SQLite path
  (`PRAX_DB_FILE`) and environment-provided provider keys are never committed. Provider keys
  configured in the local UI are stored in the single-user SQLite database, so protect backups
  and the database file as secrets. A git backup repository holds that database, so it must be
  private; the repository token itself is kept in an owner-only file beside the database and is
  never written into a backup.
- **Dependency scanning runs in CI.** Every pull request, push to `main` and release tag runs
  `npm audit --audit-level=high` on the project's self-hosted runners; a high-severity advisory
  fails the workflow and blocks a release. Dependabot opens weekly grouped update pull requests
  for npm and for the workflows' actions.
- **Desktop Library export is user-bounded.** The localhost webview can request a Library ZIP save,
  but cannot supply a destination path. The Rust shell always opens the operating system Save dialog
  and writes only the path the user confirms; no general filesystem-write permission is exposed.
- **A loopback bind refuses foreign `Host` names (DNS rebinding).** A web page on
  `attacker.example` whose DNS name resolves to `127.0.0.1` is same-origin with itself, so a
  browser would happily send its requests to the unauthenticated local API. When Prax is bound to
  loopback it answers `403` to any request whose `Host` header is not a loopback name
  (`127.0.0.0/8`, `localhost`, `::1`). The check is lifted by `PRAX_ALLOW_UNAUTHENTICATED_NETWORK=true`,
  which a loopback bind behind a local reverse proxy must set anyway to acknowledge that the
  proxy is the exposure boundary. `PRAX_ALLOWED_HOSTS` keeps the check on for any bind and lists
  the extra names to accept (loopback names and IP literals are always accepted; `*` disables
  it). The container image sets it to `localhost`, so a Compose install that listens on
  `0.0.0.0` behind a loopback-only port keeps this defence. `tests/backend/hostHeader.test.js`
  pins this.
- **Other sites cannot change data (cross-site requests).** The `Host` check cannot stop a page
  on `evil.example` from sending a `POST` to `http://127.0.0.1:<port>`: that `Host` is honest.
  The page cannot read the answer, but a route that acts without a body (disconnecting Google
  Calendar, a weekly review, a paid re-embed or AI review) would still run. Every request other
  than `GET`/`HEAD` is therefore refused with `403` before routing when the browser marks it
  `Sec-Fetch-Site: cross-site` or `same-site` (another port on localhost is another
  application), or, for browsers that send no `Sec-Fetch-Site`, when its `Origin` is not this
  server's own origin (the `Host` header, or a name in `PRAX_ALLOWED_HOSTS` for a proxy that
  rewrites `Host`). `Sec-Fetch-Site: same-origin` is trusted: a page cannot forge it. The CLI,
  the MCP server and other non-browser clients send neither header and are unaffected. The gate
  applies to every bind and is not lifted by `PRAX_ALLOWED_HOSTS=*` or
  `PRAX_ALLOW_UNAUTHENTICATED_NETWORK`. Pending Google OAuth consents are capped, so repeated
  Connect requests cannot grow server memory. `tests/backend/crossSiteRequests.test.js` pins this.
- **Settings access includes host process execution.** The Claude and Copilot CLI backends run
  the selected executable as the Prax process user, in a fresh private scratch directory
  (`mkdtemp`, mode `0700`) per provider instance — never a fixed path under the shared temp
  directory, because those CLIs read project settings and hooks from their working directory
  and a predictable path on a multi-user host would let another local user plant one. Provider
  URLs and credentials are also operator-controlled. The Claude CLI runs with every built-in
  tool disabled (`--tools ""`), no settings files loaded (`--setting-sources ""`, so the user's
  own default mode, allow rules and hooks do not apply) and the `dontAsk` permission mode. Both
  CLIs receive the prompt, system instructions and any workspace snapshot over stdin, never in
  argv where other local users could read them through `ps`. Protect the entire HTTP surface, including
  Settings, with the same trusted-operator boundary; workspace access must not be granted to
  less-trusted automation or network clients.
- **Model output never loads remote content on render.** Library documents and tasks are often
  written by agents, so text that reaches a model can carry prompt injection. Assistant answers,
  Ask Prax, AI narratives and writing previews render remote Markdown images as inert
  "not loaded" labels, never as `<img>`: a browser fetches an image with no click, so an
  injected answer could otherwise put workspace data into an image URL. Only the editor preview
  of a document loads its remote images, and the CSP still allows `https:` images for that.
- **Desktop localhost is process-bound, not broadly trusted.** The Node child binds its own
  loopback port and announces it over its parent-owned stdout. Its first OS-selected port is saved
  under the app-data directory and reused on relaunch so browser drafts/preferences keep their
  origin. An occupied saved port refuses startup; the shell never opens the occupying server. Rust permits navigation only to that
  exact origin (plus the bundled recovery page); a different localhost port cannot inherit the
  window's native capability. Served scripts are self-only under CSP, framing is denied, and the
  recovery-only restart command is unavailable to the localhost application origin.
