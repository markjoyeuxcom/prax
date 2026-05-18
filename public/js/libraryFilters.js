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
