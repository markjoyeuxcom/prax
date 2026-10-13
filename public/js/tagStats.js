// Tags at scale (Console redesign, 2026-10). A library grows tags faster than
// anyone prunes them — mostly agents inventing near-synonyms — so two pure
// derivations carry the UI:
//
// - narrowingTags: the tags present in the CURRENT result set, with how many
//   results carry each. Filtering by #backup turns a 100-tag list into the
//   handful that can still narrow it.
// - tagStats / tagMergeSuggestions: per-tag usage for the Tags page, and
//   groups of tags that look like one subject spelt several ways.
//
// Pure: no DOM, no state module; documents in, plain data out.

import { TRUST_PREDICATES } from './libraryFilters.js';

export function normalizeTagKey(value) {
  return String(value ?? '').trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-').replace(/-{2,}/g, '-');
}

function docTags(doc) {
  return [...new Set((Array.isArray(doc?.tags) ? doc.tags : []).map(normalizeTagKey).filter(Boolean))];
}

// Tags in `documents` other than the active ones, most results first.
export function narrowingTags(documents = [], activeTags = []) {
  const active = new Set((activeTags || []).map(normalizeTagKey));
  const counts = new Map();
  for (const doc of documents || []) {
    for (const tag of docTags(doc)) {
      if (!active.has(tag)) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

// One row per tag: documents carrying it, when it was last touched, whether
// people, agents or both used it, and the two tags it most often travels with.
export function tagStats(documents = []) {
  const rows = new Map();
  for (const doc of documents || []) {
    if (!doc || doc.archivedAt) continue;
    const tags = docTags(doc);
    const byAgent = TRUST_PREDICATES.agent(doc);
    for (const tag of tags) {
      const row = rows.get(tag) || { tag, count: 0, lastUsed: '', agentDocs: 0, humanDocs: 0, with: new Map(), docIds: [] };
      row.count += 1;
      if (doc.id) row.docIds.push(doc.id);
      if (String(doc.updatedAt || '') > row.lastUsed) row.lastUsed = String(doc.updatedAt || '');
      if (byAgent) row.agentDocs += 1; else row.humanDocs += 1;
      for (const other of tags) if (other !== tag) row.with.set(other, (row.with.get(other) || 0) + 1);
      rows.set(tag, row);
    }
  }
  return [...rows.values()].map((row) => ({
    tag: row.tag,
    count: row.count,
    lastUsed: row.lastUsed,
    addedBy: row.agentDocs && row.humanDocs ? 'both' : (row.agentDocs ? 'agents' : 'people'),
    docIds: row.docIds,
    oftenWith: [...row.with.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([tag]) => tag),
  })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

// Spellings of one subject. Deliberately conservative: punctuation and a
// plural "s" only when the singular is ALSO a tag (so "postgres" and "dns"
// never lose their s), plus a short list of aliases engineers actually mix.
const ALIASES = Object.freeze({
  kubernetes: 'k8s',
  postgresql: 'postgres',
  pg: 'postgres',
  javascript: 'js',
  typescript: 'ts',
  golang: 'go',
});

export function tagMergeSuggestions(stats = []) {
  const byTag = new Map(stats.map((row) => [row.tag, row]));
  const key = (tag) => {
    let k = ALIASES[tag] || tag.replace(/[-_.]/g, '');
    if (ALIASES[k]) k = ALIASES[k];
    if (k.length > 3 && k.endsWith('s') && [...byTag.keys()].some((t) => t.replace(/[-_.]/g, '') === k.slice(0, -1))) k = k.slice(0, -1);
    return k;
  };
  const groups = new Map();
  for (const row of stats) {
    const k = key(row.tag);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(row);
  }
  return [...groups.values()]
    .filter((rows) => rows.length > 1)
    .map((rows) => {
      const sorted = [...rows].sort((a, b) => b.count - a.count || a.tag.length - b.tag.length);
      const [into, ...from] = sorted;
      return {
        into: into.tag,
        from: from.map((row) => row.tag),
        // Distinct documents: one carrying two of the spellings moves once.
        documents: from.every((row) => Array.isArray(row.docIds))
          ? new Set(from.flatMap((row) => row.docIds)).size
          : from.reduce((sum, row) => sum + row.count, 0),
        agentOnly: from.every((row) => row.addedBy === 'agents'),
      };
    })
    .sort((a, b) => b.documents - a.documents || a.into.localeCompare(b.into));
}

// Which tags each Tags-page filter keeps.
export const TAG_FILTERS = Object.freeze([
  ['all', 'All'],
  ['duplicates', 'Possible duplicates'],
  ['once', 'Used once'],
  ['agents', 'Agent-only'],
]);

export function filterTagStats(stats = [], filter = 'all', suggestions = []) {
  if (filter === 'once') return stats.filter((row) => row.count === 1);
  if (filter === 'agents') return stats.filter((row) => row.addedBy === 'agents');
  if (filter === 'duplicates') {
    const involved = new Set(suggestions.flatMap((s) => [s.into, ...s.from]));
    return stats.filter((row) => involved.has(row.tag));
  }
  return stats;
}
