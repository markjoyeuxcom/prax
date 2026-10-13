import { DOCUMENT_TYPES, isDocumentType } from './documentTypes.js';
function normalizedTag(value) {
  return String(value || '').trim().toLowerCase();
}

export function tagsForDocuments(documents = []) {
  const tagCounts = new Map();

  documents.forEach((document) => {
    const documentTags = new Set((document.tags || [])
      .map(normalizedTag)
      .filter(Boolean));

    documentTags.forEach((tag) => {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    });
  });

  return Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag));
}

export function filterDocumentsByTags(documents = [], activeTags = []) {
  const requiredTags = activeTags.map(normalizedTag).filter(Boolean);
  if (!requiredTags.length) return documents;

  return documents.filter((document) => {
    const documentTags = new Set((document.tags || []).map(normalizedTag));
    return requiredTags.every(tag => documentTags.has(tag));
  });
}

// A document's effective type key: any registry value passes through; unknown
// or legacy values group with notes (display sites may still show the raw
// string — this key is for filtering/grouping only).
export function docTypeKey(doc) {
  const t = doc?.documentType;
  return isDocumentType(t) ? t : 'note';
}

export function filterDocumentsByType(documents = [], type = 'all') {
  if (!isDocumentType(type)) return documents;
  return documents.filter(doc => docTypeKey(doc) === type);
}

// OR within the type axis (mirrors filterDocumentsByTrust): a document passes
// if its type is ANY of the selected facets; empty selection passes everything.
export function filterDocumentsByTypes(documents = [], types = []) {
  const active = (Array.isArray(types) ? types : []).filter(isDocumentType);
  if (!active.length) return documents;
  const set = new Set(active);
  return documents.filter((doc) => set.has(docTypeKey(doc)));
}

// Predicates for each trust facet (matching the card chips).
export const TRUST_PREDICATES = {
  verified: (doc) => doc.verified === true,
  stale: (doc) => doc.stale === true,
  superseded: (doc) => doc.status === 'superseded',
  // Agent-written: synthesized derivations or documents last edited by an agent
  // — the curation set to review and verify.
  agent: (doc) => doc.kind === 'synthesized' || doc.updatedBy === 'agent',
};

// The review queue (year-one shell spec, item 7): agent-written documents
// nobody has verified yet. Recall labels unverified memory as unverified;
// reviewing this queue adds a human trust signal. Superseded
// and archived documents are out — they have been dealt with. Shared by the
// Library review queue and `prax triage` (cli/lib/triage.js), so the terminal
// and the UI never disagree about what is waiting.
export function isReviewQueueDoc(doc) {
  return Boolean(doc) && TRUST_PREDICATES.agent(doc) && doc.verified !== true
    && doc.status !== 'superseded' && !doc.archivedAt;
}

// OR within the trust axis: a document passes if it matches ANY selected facet
// (an unselected/empty axis passes everything). AND-across-axes is composed by
// the caller (tags AND type AND trust AND query).
export function filterDocumentsByTrust(documents = [], trust = []) {
  const active = (Array.isArray(trust) ? trust : []).filter((key) => TRUST_PREDICATES[key]);
  if (!active.length) return documents;
  return documents.filter((doc) => active.some((key) => TRUST_PREDICATES[key](doc)));
}

// `recallCounts` ({ id: { hits, uses } }) feeds the opt-in 'recalled' order:
// most recalled first, then most used, then newest. Missing counts are 0.
export function sortDocuments(documents = [], sortBy = 'updated', { recallCounts = null } = {}) {
  const copy = [...documents];
  const byStr = (a, b) => String(a || '').localeCompare(String(b || ''));
  if (sortBy === 'title') return copy.sort((a, b) => byStr(a.title, b.title));
  if (sortBy === 'recalled') {
    const hits = (doc) => Number(recallCounts?.[doc.id]?.hits) || 0;
    const uses = (doc) => Number(recallCounts?.[doc.id]?.uses) || 0;
    return copy.sort((a, b) => hits(b) - hits(a) || uses(b) - uses(a) || byStr(b.updatedAt, a.updatedAt));
  }
  if (sortBy === 'created') return copy.sort((a, b) => byStr(b.createdAt, a.createdAt));
  if (sortBy === 'type') return copy.sort((a, b) => byStr(a.documentType, b.documentType) || byStr(a.title, b.title));
  return copy.sort((a, b) => byStr(b.updatedAt, a.updatedAt)); // 'updated' default, newest first
}

export function groupDocumentsByType(documents = []) {
  const groups = DOCUMENT_TYPES.map((t) => ({ type: t.value, label: t.plural, docs: [] }));
  const byType = new Map(groups.map((g) => [g.type, g]));
  documents.forEach(doc => {
    byType.get(docTypeKey(doc)).docs.push(doc); // unknown types group with notes
  });
  return groups.filter(g => g.docs.length);
}

export function visibleTagsForFilter(
  availableTags = [],
  activeTags = [],
  query = '',
  { limit = 12, isExpanded = false } = {},
) {
  const activeTagSet = new Set(activeTags.map(normalizedTag).filter(Boolean));
  const normalizedQuery = normalizedTag(query);
  const tags = availableTags.map(({ tag, count }) => ({
    tag: normalizedTag(tag),
    count: Number(count) || 0,
  })).filter(({ tag }) => tag);

  const pinnedTags = tags
    .filter(({ tag }) => activeTagSet.has(tag))
    .map(tag => ({ ...tag, isPinned: true }));

  const regularTags = tags
    .filter(({ tag }) => !activeTagSet.has(tag))
    .filter(({ tag }) => !normalizedQuery || tag.includes(normalizedQuery))
    .map(tag => ({ ...tag, isPinned: false }));

  if (normalizedQuery || isExpanded) {
    return {
      visibleTags: [...pinnedTags, ...regularTags],
      hiddenCount: 0,
    };
  }

  const visibleTags = [...pinnedTags, ...regularTags].slice(0, limit);

  return {
    visibleTags,
    hiddenCount: Math.max(0, tags.length - visibleTags.length),
  };
}

// The Group cycler: Type → Project → Trust → None. Project answers "what does
// Klyx hold", Trust answers "what is still unverified" — the two overviews a
// reviewer wants that the facets (which filter) cannot give.
export const LIBRARY_GROUPINGS = Object.freeze(['type', 'project', 'trust', 'none']);
export function nextLibraryGroup(by) {
  const index = LIBRARY_GROUPINGS.indexOf(by);
  return LIBRARY_GROUPINGS[(index < 0 ? 0 : index + 1) % LIBRARY_GROUPINGS.length];
}
export function libraryGroupLabel(by) {
  return by === 'project' ? 'Project' : (by === 'trust' ? 'Trust' : (by === 'none' ? 'None' : 'Type'));
}

function trustGroupKey(doc) {
  if (doc?.status === 'superseded') return 'superseded';
  if (doc?.verified === true) return 'verified';
  return TRUST_PREDICATES.agent(doc) ? 'agent' : 'unverified';
}
const TRUST_GROUPS = [['verified', 'Verified'], ['agent', 'Unverified · agent-written'], ['unverified', 'Unverified · written by people'], ['superseded', 'Superseded']];

// Documents grouped for the Library: { type, label, docs }[] in a fixed order,
// empty groups dropped. `projects` names the project groups.
export function groupDocuments(documents = [], by = 'type', { projects = [] } = {}) {
  if (by === 'project') {
    const names = new Map((projects || []).filter((p) => p?.id).map((p) => [p.id, p.name]));
    const groups = new Map();
    for (const doc of documents) {
      const key = doc?.projectId || 'none';
      if (!groups.has(key)) groups.set(key, { type: `project:${key}`, label: names.get(key) || 'Project unavailable', docs: [] });
      groups.get(key).docs.push(doc);
    }
    return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  }
  if (by === 'trust') {
    const groups = TRUST_GROUPS.map(([key, label]) => ({ type: `trust:${key}`, label, docs: [] }));
    const byKey = new Map(groups.map((g) => [g.type.slice(6), g]));
    for (const doc of documents) byKey.get(trustGroupKey(doc)).docs.push(doc);
    return groups.filter((g) => g.docs.length);
  }
  return groupDocumentsByType(documents);
}
