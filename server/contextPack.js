const DEFAULT_LIMIT = 12;
const SNIPPET_LEN = 280;

function snippet(body) {
  return String(body || '').replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LEN);
}

function hasTag(doc, tag) {
  return (doc.tags || []).map((t) => String(t || '').toLowerCase()).includes(tag);
}

function toItem(doc, { full = false } = {}) {
  return {
    id: doc.id,
    title: doc.title,
    documentType: doc.documentType,
    verified: Boolean(doc.verified),
    text: full ? String(doc.body || '') : snippet(doc.body),
  };
}

// Pure: select + classify documents into a bounded, trust-aware context pack.
// Input `docs` arrive pre-ordered by the caller (similarity when a query is
// given, recency otherwise); order is preserved within each section.
// `limit` is a single pack-wide budget, spent in section order (overview →
// relevant → runbooks → unverified) so the pack can never exceed it.
export function buildContextPack(docs, { project = null, query = '', limit = DEFAULT_LIMIT } = {}) {
  const active = (Array.isArray(docs) ? docs : []).filter((d) => (d.status || 'active') === 'active');
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

  return {
    project: project ? { id: project.id, slug: project.slug, name: project.name, status: project.status } : null,
    query: query || null,
    sections,
  };
}

export function renderContextPackMarkdown(pack) {
  const lines = [];
  const p = pack.project;
  lines.push(`# Context: ${p ? p.name : 'Library'}${p && p.status ? ` (${p.status})` : ''}`);
  if (pack.query) lines.push(`\n_Query: ${pack.query}_`);
  for (const section of pack.sections) {
    lines.push(`\n## ${section.title}`);
    for (const it of section.items) {
      lines.push(`\n### ${it.title}${it.verified ? '' : ' — _unverified_'}`);
      if (section.kind === 'runbooks') lines.push(`(runbook · ${it.id})`);
      else if (it.text) lines.push(it.text);
    }
  }
  return `${lines.join('\n')}\n`;
}
