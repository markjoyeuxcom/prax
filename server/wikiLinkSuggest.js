// Auto wiki-linking (Tier-2 #5, increment 1) — deterministic link suggestions.
//
// Finds plain-text mentions of one document's exact title inside ANOTHER
// document's body that are not already a [[wiki-link]] (or inside code), so the
// Library can suggest connecting them — the cure for the orphan/wiki-rot problem
// the Health view surfaces. Pure + unit-tested; the routes are thin wrappers.

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Replace protected regions (fenced code, inline code, existing [[wiki-links]])
// with same-length runs of spaces, so a title match can't land inside them and
// indices still map 1:1 back to the original body.
function maskProtected(body) {
  const blank = (m) => ' '.repeat(m.length);
  return String(body || '')
    .replace(/```[\s\S]*?```/g, blank) // fenced code blocks
    .replace(/`[^`\n]*`/g, blank)       // inline code spans
    .replace(/\[\[[^\]\n]+\]\]/g, blank); // already-linked
}

// A word-boundary, case-insensitive matcher for a literal title.
function titleRegex(title) {
  return new RegExp(`(?<!\\w)${escapeRegex(String(title).trim())}(?!\\w)`, 'i');
}

// Does the body already contain a [[wiki-link]] to this title (any casing)?
function hasWikiLinkTo(body, title) {
  return new RegExp(`\\[\\[\\s*${escapeRegex(String(title).trim())}\\s*\\]\\]`, 'i').test(String(body || ''));
}

function snippetAround(body, index, len, ctx = 40) {
  const start = Math.max(0, index - ctx);
  const end = Math.min(body.length, index + len + ctx);
  const squash = (s) => s.replace(/\s+/g, ' ');
  return {
    pre: (start > 0 ? '…' : '') + squash(body.slice(start, index)),
    hit: body.slice(index, index + len),
    post: squash(body.slice(index + len, end)) + (end < body.length ? '…' : ''),
  };
}

// Rewrite the FIRST eligible plain-text mention of `title` in `body` to a
// [[wiki-link]], preserving the mention's original casing. Returns the new body,
// or null when there's no eligible mention (e.g. it was already linked or edited
// away since the suggestion was made).
export function applyWikiLink(body, title) {
  const t = String(title || '').trim();
  if (!t || typeof body !== 'string' || !body) return null;
  const m = titleRegex(t).exec(maskProtected(body));
  if (!m) return null;
  const i = m.index;
  const len = m[0].length;
  return `${body.slice(0, i)}[[${body.slice(i, i + len)}]]${body.slice(i + len)}`;
}

// For each active doc, the first eligible mention of every OTHER doc's title.
// Titles shorter than 3 chars are skipped (too noisy). Capped total.
export function suggestWikiLinks(docs, { cap = 50 } = {}) {
  const list = (Array.isArray(docs) ? docs : []).filter(
    (d) => d && d.id && d.title && typeof d.body === 'string' && d.body.trim(),
  );
  const out = [];
  for (const source of list) {
    const masked = maskProtected(source.body);
    for (const target of list) {
      if (target.id === source.id) continue;
      const title = String(target.title || '').trim();
      if (title.length < 3) continue;
      if (hasWikiLinkTo(source.body, title)) continue;
      const m = titleRegex(title).exec(masked);
      if (!m) continue;
      out.push({
        sourceId: source.id,
        sourceTitle: source.title,
        targetId: target.id,
        targetTitle: target.title,
        snippet: snippetAround(source.body, m.index, m[0].length),
      });
      if (out.length >= cap) return out;
    }
  }
  return out;
}
