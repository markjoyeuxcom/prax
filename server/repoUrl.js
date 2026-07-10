// Git remote URL normalization (repo-URL project detection) — ONE pure
// canonicalizer shared by the server (matching stored project repo URLs) and
// the prax CLI (matching the local `origin` remote), so both sides agree by
// construction. Stored URLs stay AS ENTERED (display); normalization happens
// only at match time — an odd URL is never rejected, it just never matches.
//
// Canonical form: lowercase `host/path` — scheme, userinfo (PATs!), port, one
// trailing `.git`, and trailing slashes stripped. All of these describe the
// same repository:
//   git@github.com:Org/Repo.git            → github.com/org/repo
//   https://github.com/org/repo.git        → github.com/org/repo
//   https://user:token@github.com/org/repo → github.com/org/repo
//   ssh://git@github.com:2222/org/repo/    → github.com/org/repo
//   https://gitlab.com/group/sub/repo.git  → gitlab.com/group/sub/repo

const SCHEME = /^(?:https?|ssh|git|git\+ssh):\/\//i;
// scp-like syntax: `user@host:path` — no scheme, an @ before the first colon,
// and the part before the @/: contains no slash. Requiring the `@` keeps
// Windows-ish `C:\...` paths and `host:1234` (port-only) strings out.
const SCP_LIKE = /^([^/@]+)@([^/:]+):(.+)$/;

export function normalizeRepoUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  let host = null;
  let path = null;

  if (SCHEME.test(s)) {
    try {
      const url = new URL(s);
      host = url.hostname; // drops userinfo + port
      path = url.pathname; // drops ?query and #fragment
      try {
        // new URL() percent-encodes spaces/unicode; the scp-like branch keeps
        // them raw — decode so both spellings of the same repo converge.
        path = decodeURIComponent(path);
      } catch {
        // malformed % sequence — keep the encoded form
      }
    } catch {
      return null;
    }
  } else {
    const scp = s.match(SCP_LIKE);
    if (!scp) return null;
    host = scp[2];
    path = scp[3];
  }

  path = String(path).replace(/\/+$/, '').replace(/^\/+/, '');
  path = path.replace(/\.git$/i, ''); // ONE trailing .git — `user.github.io` survives
  if (!host || !path) return null;
  return `${host}/${path}`.toLowerCase();
}

// Match a raw/local repo URL against a projects list (API payloads carrying
// `repoUrl`). Both sides are normalized here, so it works no matter how the
// URL was typed on either end. Detection targets projects you can still work
// in: archived/completed projects never capture a match (an archived
// predecessor must not steal new memories from its active successor — and its
// older sortOrder would otherwise win the tie-break). Deterministic on
// duplicates: first by sortOrder then name, mirroring the sidebar order.
export function matchProjectByRepoUrl(projects, rawUrl) {
  const wanted = normalizeRepoUrl(rawUrl);
  if (!wanted) return null;
  const matches = (Array.isArray(projects) ? projects : [])
    .filter((p) => p && p.status !== 'archived' && p.status !== 'completed' && normalizeRepoUrl(p.repoUrl) === wanted)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name).localeCompare(String(b.name)));
  return matches[0] || null;
}
