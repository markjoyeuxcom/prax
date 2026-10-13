// The Library's address: the filters, view and search as a URL hash, so a
// reload (or a shared link inside the app) lands on the same view instead of
// the Inbox with the query lost. Pure: state → hash, hash → state patch.
//
//   #library                       the browse view, no filters
//   #library?view=review&types=runbook&types=note&trust=agent&tag=postgres&q=failover&sort=title&group=project&layout=table
//   #doc/<id>                      opens a document (read only: never written)
//
// Keys are only ever the Library's own filter fields; unknown keys are dropped.
// Lists are written one parameter per value. Reading also accepts what 0.44.0
// wrote, a comma list (`types=runbook,note`, `tags=ops,postgres`): a bookmark
// from then must keep its meaning. Type, trust and project values never hold a
// comma, so a comma always separates them; a tag can, so tags moved to a new
// key (`tag`, literal) and the old `tags` key stays a comma list.

const LIST_KEYS = { types: 'libraryTypes', trust: 'libraryTrust', projects: 'libraryProjects', tag: 'activeLibraryTags' };
const LEGACY_TAGS_KEY = 'tags';
const splitList = (values) => values.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean);
const VIEWS = new Set(['active', 'archive', 'review', 'tags']);
const SORTS = new Set(['updated', 'title', 'recalled']);
const GROUPS = new Set(['type', 'project', 'trust', 'none']);
const LAYOUTS = new Set(['cards', 'table']);

export function libraryHashFromState(state) {
  // Only the Library writes an address. An open document does not: a reload
  // must not land back inside an editor whose failed or conflicting draft
  // vetoes navigation (that recovery flow starts from the Library). #doc/<id>
  // is still read, as a link you can type or paste.
  if (state.navType !== 'library') return '';
  const params = new URLSearchParams();
  const view = state.libraryView || 'active';
  if (view !== 'active') params.set('view', view);
  // One parameter per value (tag=a&tag=b): a tag may itself hold a comma.
  for (const [key, field] of Object.entries(LIST_KEYS)) {
    const values = Array.isArray(state[field]) ? state[field].filter(Boolean) : [];
    for (const value of values) params.append(key, value);
  }
  const query = String(state.libraryQuery || '').trim();
  if (query) params.set('q', query);
  if (state.librarySemantic) params.set('mode', 'semantic');
  if (state.librarySortBy && state.librarySortBy !== 'updated') params.set('sort', state.librarySortBy);
  if (state.libraryGroupBy && state.libraryGroupBy !== 'type') params.set('group', state.libraryGroupBy);
  if (state.libraryLayout && state.libraryLayout !== 'cards') params.set('layout', state.libraryLayout);
  const qs = params.toString();
  return `#library${qs ? `?${qs}` : ''}`;
}

// { kind: 'library', patch } | { kind: 'doc', id } | null.
export function locationFromHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw) return null;
  const doc = /^doc\/(.+)$/.exec(raw);
  if (doc) {
    let id = doc[1];
    try { id = decodeURIComponent(id); } catch { /* keep as is */ }
    return /^[0-9a-f-]{36}$/i.test(id) ? { kind: 'doc', id } : null;
  }
  if (!/^library(\?|$)/.test(raw)) return null;
  const params = new URLSearchParams(raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '');
  const patch = { libraryView: 'active', libraryTypes: [], libraryTrust: [], libraryProjects: [], activeLibraryTags: [], libraryQuery: '', librarySemantic: false };
  const view = params.get('view');
  if (view && VIEWS.has(view)) patch.libraryView = view;
  for (const [key, field] of Object.entries(LIST_KEYS)) {
    const values = params.getAll(key);
    patch[field] = key === 'tag' ? values.map((v) => v.trim()).filter(Boolean) : splitList(values);
  }
  patch.activeLibraryTags = [...new Set([...patch.activeLibraryTags, ...splitList(params.getAll(LEGACY_TAGS_KEY))])];
  patch.libraryQuery = String(params.get('q') || '').trim();
  patch.librarySemantic = params.get('mode') === 'semantic';
  const sort = params.get('sort');
  if (sort && SORTS.has(sort)) patch.librarySortBy = sort;
  const group = params.get('group');
  if (group && GROUPS.has(group)) patch.libraryGroupBy = group;
  const layout = params.get('layout');
  if (layout && LAYOUTS.has(layout)) patch.libraryLayout = layout;
  return { kind: 'library', patch };
}
