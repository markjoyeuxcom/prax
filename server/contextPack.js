import { normalizeTitle } from './documentTitle.js';

const DEFAULT_LIMIT = 12;
const SNIPPET_LEN = 200;
const OVERVIEW_LEN = 600;
// Empty / whitespace-only docs are scratch or placeholder noise ("Test 3",
// "Untitled") — they carry nothing to brief or answer from, so they're kept out
// of the pack. We drop only genuinely empty bodies (no length threshold), so a
// terse-but-real note is never lost.
export const MIN_CONTENT_CHARS = 1;

export function contentLength(body) {
  return String(body || '').replace(/\s+/g, '').length;
}

// A doc is worth retrieving only if it has body content to answer or summarize
// from. Title-only / empty docs are dropped.
export function isSubstantive(doc) {
  return contentLength(doc && doc.body) >= MIN_CONTENT_CHARS;
}

function snippet(body) {
  return String(body || '').replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LEN);
}

function hasTag(doc, tag) {
  return (doc.tags || []).map((t) => String(t || '').toLowerCase()).includes(tag);
}

function toItem(doc, { full = false } = {}) {
  const body = String(doc.body || '');
  return {
    id: doc.id,
    title: normalizeTitle(doc.title),
    documentType: doc.documentType,
    verified: Boolean(doc.verified),
    verifiedAt: doc.verifiedAt || null,
    verifiedBy: doc.verifiedBy || null,
    status: doc.status || 'active',
    updatedBy: doc.updatedBy || null,
    kind: doc.kind || 'source',
    stale: Boolean(doc.stale),
    // When the current revision was written: a budgeted pack (prax context
    // --budget) fills its last tier newest first.
    updatedAt: doc.updatedAt || null,
    // Overview cards keep their (capped) formatted body; everything else gets a
    // tight single-line snippet.
    text: full ? (body.length > OVERVIEW_LEN ? `${body.slice(0, OVERVIEW_LEN)}…` : body) : snippet(body),
  };
}

// Pure: select + classify documents into a bounded, trust-aware context pack.
// Input `docs` arrive pre-ordered by the caller (similarity when a query is
// given, recency otherwise); order is preserved within each section.
// `limit` is a single pack-wide budget, spent in section order (overview →
// relevant → runbooks → unverified) so the pack can never exceed it.
export function buildContextPack(docs, {
  project = null, query = '', limit = DEFAULT_LIMIT, retrieval = null,
} = {}) {
  const active = (Array.isArray(docs) ? docs : [])
    .filter((d) => (d.status || 'active') === 'active')
    .filter(isSubstantive); // drop scratch/empty docs ("Untitled", "Test 3")
  const cards = active.filter((d) => d.verified && hasTag(d, 'project-card'));
  const runbooks = active.filter((d) => d.verified && d.documentType === 'runbook' && !cards.includes(d));
  const relevant = active.filter((d) => d.verified && !cards.includes(d) && !runbooks.includes(d));
  const unverified = active.filter((d) => !d.verified);

  let remaining = Math.max(0, limit);
  const take = (list) => {
    const out = list.slice(0, remaining);
    remaining -= out.length;
    return out;
  };

  const sections = [
    { kind: 'overview', title: 'Project overview', items: take(cards).map((d) => toItem(d, { full: true })) },
    { kind: 'relevant', title: query ? 'Relevant memory' : 'Recent memory', items: take(relevant).map((d) => toItem(d)) },
    { kind: 'runbooks', title: 'Active runbooks', items: take(runbooks).map((d) => toItem(d)) },
    { kind: 'unverified', title: '⚠ Unverified — pending human review', items: take(unverified).map((d) => toItem(d)) },
  ].filter((s) => s.items.length > 0);

  // What the budget left out, so a verified-first pack cannot silently drop
  // newer unverified corrections: a reader is told they exist.
  const included = sections.reduce((sum, s) => sum + s.items.length, 0);
  const includedUnverified = sections.find((s) => s.kind === 'unverified')?.items.length ?? 0;
  const omitted = { total: active.length - included, unverified: unverified.length - includedUnverified };

  return {
    project: project ? { id: project.id, slug: project.slug, name: project.name, status: project.status } : null,
    query: query || null,
    retrieval,
    sections,
    omitted,
  };
}

export function renderContextPackMarkdown(pack) {
  const lines = [];
  const p = pack.project;
  lines.push(`# Context: ${p ? p.name : 'Library'}${p && p.status ? ` (${p.status})` : ''}`);
  if (pack.query) lines.push(`\n_Query: ${normalizeTitle(pack.query)}_`);
  if (pack.retrieval) {
    const suffix = pack.retrieval.fallback
      ? ` fallback (${pack.retrieval.reason || 'unspecified'})`
      : '';
    lines.push(`\n_Retrieval: ${pack.retrieval.mode}${suffix}_`);
  }
  for (const section of pack.sections) {
    lines.push(`\n## ${section.title}`);
    for (const it of section.items) {
      // The title is rendered on ONE line with its trust labels, so it can
      // never open a heading of its own and sit under someone else's label.
      const labels = `${it.verified ? '' : ' — _unverified_'}${it.stale ? ' — _stale_' : ''}`;
      lines.push(`\n### ${normalizeTitle(it.title) || 'Untitled'}${labels}`);
      if (section.kind === 'runbooks') lines.push(`(runbook · ${it.id})`);
      else if (it.text) lines.push(it.text);
    }
  }
  const omitted = pack.omitted;
  if (omitted && omitted.total > 0) {
    const unverifiedNote = omitted.unverified > 0 ? ` (${omitted.unverified} unverified)` : '';
    lines.push(`\n_${omitted.total} more document${omitted.total === 1 ? '' : 's'}${unverifiedNote} left out by the document limit._`);
  }
  return `${lines.join('\n')}\n`;
}
