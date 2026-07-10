// Derive a display "kind" for an external reference from its URL — used for a
// small icon/label in the UI. Purely presentational and computed at render
// time (never stored), so adding a host mapping is a one-line change here that
// the server, MCP, and frontend all pick up. DOM-free so any layer can import.
export function externalRefKind(url) {
  let host = '';
  try {
    host = new URL(String(url)).hostname.toLowerCase();
  } catch {
    // scp-like or bare — no scheme; take the token before the first / or :
    const m = String(url ?? '').trim().match(/^(?:[^@]+@)?([^/:]+)/);
    host = (m ? m[1] : '').toLowerCase();
  }
  if (/(^|\.)github\.com$/.test(host)) return 'github';
  if (/(^|\.)gitlab\./.test(host)) return 'gitlab';
  return 'link';
}

export const EXTERNAL_REF_KIND_LABELS = { github: 'GitHub', gitlab: 'GitLab', link: 'Link' };

// A ref is only turned into a clickable <a href> when its scheme is safe to
// navigate to — http/https/mailto. Anything else (javascript:, data:, a bare
// scp-like git@host:path, or garbage) is shown as non-clickable text, so a
// stored "javascript:…" URL can never execute from the sidebar. escapeHtml
// alone would NOT catch this (the scheme has no HTML metacharacters).
export function isSafeHttpUrl(url) {
  return /^(https?:|mailto:)/i.test(String(url ?? '').trim());
}

// The Document-info textarea holds one ref per line: `url` or `url | label`.
// The separator is a pipe PRECEDED BY WHITESPACE — URLs cannot contain raw
// whitespace, so a bare `|` inside a URL (e.g. Grafana template-variable
// query strings like ?var-node=a|b) is part of the URL, never a label
// delimiter. Splitting on the first bare `|` would silently truncate such a
// URL on every save. refsToLines emits ` | `, matching this rule, so stored
// refs round-trip unchanged.
export function refsToLines(refs) {
  if (!Array.isArray(refs)) return '';
  return refs.map((ref) => (ref.label ? `${ref.url} | ${ref.label}` : ref.url)).join('\n');
}

export function parseExternalRefLines(text) {
  return String(text ?? '').split('\n').map((line) => {
    const t = line.trim();
    if (!t) return null;
    const sep = t.search(/\s\|/);
    return sep === -1
      ? { url: t, label: null }
      : { url: t.slice(0, sep).trim(), label: t.slice(sep).replace(/^\s*\|\s*/, '').trim() || null };
  }).filter((r) => r && r.url);
}
