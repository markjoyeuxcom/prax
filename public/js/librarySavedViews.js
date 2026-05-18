function normalizeTag(value) {
  return String(value || '').trim().toLowerCase();
}

function uniqueTags(tags = []) {
  return Array.from(new Set(tags.map(normalizeTag).filter(Boolean))).sort();
}

function slugFromLabel(label) {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'view';
}

export function createSavedLibraryView(label, tags = []) {
  const normalizedLabel = String(label || '').trim();
  const normalizedTags = uniqueTags(tags);

  if (!normalizedLabel || !normalizedTags.length) return null;

  return {
    id: `${slugFromLabel(normalizedLabel)}-${normalizedTags.join('-')}`,
    label: normalizedLabel,
    tags: normalizedTags,
  };
}

export function renameSavedLibraryView(view, label) {
  if (!view) return null;
  return createSavedLibraryView(label, view.tags);
}

export function sanitizeSavedLibraryViews(value) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  return value.reduce((views, item) => {
    const view = createSavedLibraryView(item?.label, item?.tags);
    if (!view || seen.has(view.id)) return views;
    seen.add(view.id);
    views.push(view);
    return views;
  }, []);
}

export function savedLibraryViewsFromJson(value) {
  try {
    return sanitizeSavedLibraryViews(JSON.parse(value || '[]'));
  } catch {
    return [];
  }
}

export function areSameTags(left = [], right = []) {
  const normalizedLeft = uniqueTags(left);
  const normalizedRight = uniqueTags(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((tag, index) => tag === normalizedRight[index]);
}
