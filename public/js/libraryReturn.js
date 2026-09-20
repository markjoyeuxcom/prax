// A return visit restores the view that opened the document, including its
// loaded result window. This stays in memory; no document bodies go to storage.
const FIELDS = [
  'libraryQuery', 'librarySemantic', 'activeLibraryTags', 'libraryTypes',
  'libraryTrust', 'libraryProjects', 'librarySortBy', 'libraryView', 'libraryLayout',
  'libraryTagsExpanded', 'libraryGroupBy', 'libraryTagFilter', 'semanticResults', 'semanticPage',
  'semanticIndex', 'semanticError', 'semanticMoreError',
];

export function libraryViewKey(state) {
  return JSON.stringify(FIELDS.slice(0, 12).map(key => state[key]));
}

export function captureLibraryReturn(state, { scrollTop = 0, documentId } = {}) {
  const patch = Object.fromEntries(FIELDS.filter(key => key in state).map(key => [key, structuredClone(state[key])]));
  return { kind: 'library', patch, scrollTop: Math.max(0, Number(scrollTop) || 0), documentId,
    pendingSearch: Boolean(state.semanticLoading), key: libraryViewKey(state) };
}

export function libraryReturnPatch(snapshot) {
  if (snapshot?.kind !== 'library') return {};
  return { ...structuredClone(snapshot.patch), librarySelectedDocIds: [],
    semanticLoading: false, semanticLoadingMore: false };
}
