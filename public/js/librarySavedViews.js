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

const FILTER_KEYS = ['types', 'trust', 'projects', 'query', 'sortBy', 'groupBy'];
function cleanFilters(filters) {
  if (!filters || typeof filters !== 'object') return null;
  const out = {};
  for (const key of ['types', 'trust', 'projects']) {
    const list = Array.isArray(filters[key]) ? filters[key].map((v) => String(v || '').trim()).filter(Boolean) : [];
    if (list.length) out[key] = [...new Set(list)].sort();
  }
  const query = String(filters.query || '').trim();
  if (query) out.query = query;
  for (const key of ['sortBy', 'groupBy']) if (typeof filters[key] === 'string' && filters[key]) out[key] = filters[key];
  return Object.keys(out).length ? out : null;
}

// A saved view is the WHOLE filter state the person was looking at (tags,
// types, trust, projects, query, sort, grouping), not only its tags: reopening
// "Cedar verified decisions" must show one document, not every tagged one.
export function createSavedLibraryView(label, tags = [], filters = null) {
  const normalizedLabel = String(label || '').trim();
  const normalizedTags = uniqueTags(tags);
  const normalizedFilters = cleanFilters(filters);

  if (!normalizedLabel || (!normalizedTags.length && !normalizedFilters)) return null;

  const key = [...normalizedTags, ...FILTER_KEYS.filter((k) => normalizedFilters?.[k]).map((k) => `${k}=${[].concat(normalizedFilters[k]).join('+')}`)].join('-');
  return {
    id: `${slugFromLabel(normalizedLabel)}-${slugFromLabel(key)}`,
    label: normalizedLabel,
    tags: normalizedTags,
    ...(normalizedFilters ? { filters: normalizedFilters } : {}),
  };
}

export function renameSavedLibraryView(view, label) {
  if (!view) return null;
  return createSavedLibraryView(label, view.tags, view.filters);
}

// The state patch that reopens a view exactly as it was saved.
export function savedLibraryViewPatch(view) {
  const filters = view?.filters || {};
  return {
    activeLibraryTags: [...(view?.tags || [])],
    libraryTypes: [...(filters.types || [])],
    libraryTrust: [...(filters.trust || [])],
    libraryProjects: [...(filters.projects || [])],
    libraryQuery: filters.query || '',
    ...(filters.sortBy ? { librarySortBy: filters.sortBy } : {}),
    ...(filters.groupBy ? { libraryGroupBy: filters.groupBy } : {}),
  };
}

export function sanitizeSavedLibraryViews(value) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  return value.reduce((views, item) => {
    const view = createSavedLibraryView(item?.label, item?.tags, item?.filters);
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
