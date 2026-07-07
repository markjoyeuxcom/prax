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

export function filterDocumentsByType(documents = [], type = 'all') {
  if (type !== 'runbook' && type !== 'note') return documents;
  return documents.filter(doc => (doc.documentType || 'note') === type);
}

// Predicates for each trust facet (matching the card chips).
export const TRUST_PREDICATES = {
  verified: (doc) => doc.verified === true,
  stale: (doc) => doc.stale === true,
  superseded: (doc) => doc.status === 'superseded',
};

// OR within the trust axis: a document passes if it matches ANY selected facet
// (an unselected/empty axis passes everything). AND-across-axes is composed by
// the caller (tags AND type AND trust AND query).
export function filterDocumentsByTrust(documents = [], trust = []) {
  const active = (Array.isArray(trust) ? trust : []).filter((key) => TRUST_PREDICATES[key]);
  if (!active.length) return documents;
  return documents.filter((doc) => active.some((key) => TRUST_PREDICATES[key](doc)));
}

export function sortDocuments(documents = [], sortBy = 'updated') {
  const copy = [...documents];
  const byStr = (a, b) => String(a || '').localeCompare(String(b || ''));
  if (sortBy === 'title') return copy.sort((a, b) => byStr(a.title, b.title));
  if (sortBy === 'created') return copy.sort((a, b) => byStr(b.createdAt, a.createdAt));
  if (sortBy === 'type') return copy.sort((a, b) => byStr(a.documentType, b.documentType) || byStr(a.title, b.title));
  return copy.sort((a, b) => byStr(b.updatedAt, a.updatedAt)); // 'updated' default, newest first
}

export function groupDocumentsByType(documents = []) {
  const groups = [
    { type: 'runbook', label: 'Runbooks', docs: [] },
    { type: 'note', label: 'Notes', docs: [] },
  ];
  documents.forEach(doc => {
    const t = (doc.documentType || 'note') === 'runbook' ? 'runbook' : 'note';
    groups.find(g => g.type === t).docs.push(doc);
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
