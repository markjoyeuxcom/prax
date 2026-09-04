import { normalizeDocumentDraftTitle } from './documentDraftRecovery.js';
const fields = ['title', 'body'];
function value(doc,field) { return field === 'title' ? normalizeDocumentDraftTitle(doc?.title) : String(doc?.body ?? ''); }
export function documentDraftPatch(base,draft) {
  if (!base?.revision) throw new Error('The document revision is missing. Reload before saving.');
  const patch = {ifRevision:base.revision};
  for (const field of fields) if (value(base,field) !== value(draft,field)) patch[field] = value(draft,field);
  return patch;
}
export function mergeDocumentDraft(base,draft,remote) {
  const merged = {}, conflicts = [];
  for (const field of fields) {
    const before=value(base,field),local=value(draft,field),current=value(remote,field);
    if (local===before) merged[field]=current;
    else {
      merged[field]=local;
      if (current!==before && current!==local) conflicts.push(field);
    }
  }
  return {draft:merged,conflicts};
}
