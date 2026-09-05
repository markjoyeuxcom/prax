// The Document-info form as an EXPLICIT draft (root-review finding 5).
//
// The form used to read its values straight out of the DOM at save time and
// re-seed every input from the document on each rerender, so a failed save
// (or any rerender while the form was open) threw typed metadata away and
// left nothing to retry. This module owns the model instead: what the form
// was opened from (the baseline — field values plus the document revision),
// what the person typed (fields), and how the two reconcile with the record
// the server holds now. Pure; main.js does the I/O.
import { refsToLines } from './externalRefKind.js';

const FIELDS = ['title', 'documentType', 'projectId', 'tags', 'sourceFilename'];

function tagsOf(value) {
  if (Array.isArray(value)) return value.map((tag) => String(tag ?? '').trim()).filter(Boolean);
  return String(value ?? '').split(',').map((tag) => tag.trim()).filter(Boolean);
}

function sameTags(a, b) {
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

function sameField(field, a, b) {
  return field === 'tags' ? sameTags(a, b) : a === b;
}

// The comparable shape of a record's metadata (what the form edits).
export function infoFieldsOf(doc) {
  return {
    title: String(doc?.title ?? '').trim(),
    documentType: String(doc?.documentType ?? 'note'),
    projectId: String(doc?.projectId ?? ''),
    tags: tagsOf(doc?.tags),
    sourceFilename: String(doc?.sourceFilename ?? '').trim() || null,
  };
}

// Raw input values → the comparable shape. Dedupes tags in order of first use.
export function normalizeInfoFields(fields) {
  const seen = new Set();
  const tags = tagsOf(fields?.tags).filter((tag) => (seen.has(tag) ? false : (seen.add(tag), true)));
  return {
    title: String(fields?.title ?? '').trim(),
    documentType: String(fields?.documentType ?? 'note'),
    projectId: String(fields?.projectId ?? ''),
    tags,
    sourceFilename: String(fields?.sourceFilename ?? '').trim() || null,
  };
}

// Editable input values for a record (tags as the comma list the input shows).
function inputFieldsOf(doc, refsText) {
  const info = infoFieldsOf(doc);
  return {
    title: info.title,
    documentType: info.documentType,
    projectId: info.projectId,
    tags: info.tags.join(', '),
    sourceFilename: info.sourceFilename ?? '',
    refsText: String(refsText ?? ''),
  };
}

export function openDocumentInfoDraft(doc, { refs = null } = {}) {
  if (!doc?.id) throw new Error('The document is missing. Reload before editing its info.');
  if (typeof doc.revision !== 'string' || !doc.revision) throw new Error('The document revision is missing. Reload before editing its info.');
  return {
    documentId: doc.id,
    baseline: { revision: doc.revision, ...infoFieldsOf(doc) },
    fields: inputFieldsOf(doc, refsToLines(refs)),
    pending: false,
    conflict: null,
  };
}

// Only the fields that differ from the baseline, guarded by its revision.
// `projectId` travels as the API's `project` (slug-or-id) field.
export function documentInfoPatch(baseline, fields) {
  const patch = { ifRevision: baseline.revision };
  for (const field of FIELDS) {
    if (sameField(field, baseline[field], fields[field])) continue;
    if (field === 'projectId') patch.project = fields.projectId;
    else patch[field] = fields[field];
  }
  return patch;
}

// Three-way merge against the record the server holds now: a field I did not
// change follows the remote; a field I changed keeps my value, and is a
// conflict only when the remote changed it too (to something else).
export function mergeDocumentInfo(baseline, mine, remote) {
  const current = infoFieldsOf(remote);
  const merged = {};
  const conflicts = [];
  for (const field of FIELDS) {
    const before = baseline[field];
    const local = mine[field];
    if (sameField(field, local, before)) {
      merged[field] = current[field];
    } else {
      merged[field] = local;
      if (!sameField(field, current[field], before) && !sameField(field, current[field], local)) conflicts.push(field);
    }
  }
  return { fields: merged, conflicts, remote: current };
}

// A lost response committed iff every field the patch carried is now stored.
export function documentInfoCommitted(remote, patch) {
  if (!remote) return false;
  const current = infoFieldsOf(remote);
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'ifRevision') continue;
    const field = key === 'project' ? 'projectId' : key;
    if (!sameField(field, current[field], field === 'tags' ? tagsOf(value) : value)) return false;
  }
  return true;
}

// Resolve a conflict: the baseline becomes the remote record (so the next save
// is guarded by ITS revision), untouched fields follow the remote, and each
// contested field takes the remote value (`theirs`) or keeps mine (`mine`).
// Keeping mine is an explicit overwrite of exactly the contested fields.
export function rebaseDocumentInfoDraft(draft, remote, { keep, conflicts = [] } = {}) {
  const mine = normalizeInfoFields(draft.fields);
  const merged = mergeDocumentInfo(draft.baseline, mine, remote).fields;
  const resolved = { ...merged };
  for (const field of conflicts) resolved[field] = keep === 'theirs' ? infoFieldsOf(remote)[field] : mine[field];
  return {
    ...draft,
    baseline: { revision: remote.revision, ...infoFieldsOf(remote) },
    fields: {
      ...inputFieldsOf({ ...remote, ...resolved }, draft.fields.refsText),
      refsText: draft.fields.refsText,
    },
    conflict: null,
    pending: false,
  };
}

export const DOCUMENT_INFO_FIELD_LABELS = Object.freeze({
  title: 'Title',
  documentType: 'Type',
  projectId: 'Project',
  tags: 'Tags',
  sourceFilename: 'Source file',
});
