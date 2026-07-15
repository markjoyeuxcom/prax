export const DOCUMENT_DRAFT_RECOVERY_SCHEMA_VERSION = 1;
export const DOCUMENT_DRAFT_RECOVERY_KEY_PREFIX = 'prax.documentDraftRecovery.v1.';

export function normalizeDocumentDraftTitle(value) {
  return String(value ?? '').trim() || 'Untitled';
}

function bodyOf(value) {
  return String(value ?? '');
}

function snapshotsMatch(left, right) {
  return normalizeDocumentDraftTitle(left?.title) === normalizeDocumentDraftTitle(right?.title)
    && bodyOf(left?.body) === bodyOf(right?.body);
}

export function documentDraftIsDirty(document, draft) {
  return Boolean(document) && !snapshotsMatch(document, draft);
}

function recoveryKey(documentId) {
  return `${DOCUMENT_DRAFT_RECOVERY_KEY_PREFIX}${encodeURIComponent(String(documentId || ''))}`;
}

function isRecoveryRecord(value, documentId) {
  return Boolean(value)
    && value.schemaVersion === DOCUMENT_DRAFT_RECOVERY_SCHEMA_VERSION
    && value.documentId === documentId
    && typeof value.baseTitle === 'string'
    && typeof value.baseBody === 'string'
    && typeof value.draftTitle === 'string'
    && typeof value.draftBody === 'string';
}

export function loadDocumentDraftRecovery(storage, documentId) {
  if (!storage || !documentId) return null;
  const key = recoveryKey(documentId);
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const record = JSON.parse(raw);
    if (isRecoveryRecord(record, documentId)) return record;
    storage.removeItem(key);
  } catch {
    try { storage.removeItem(key); } catch { /* storage is unavailable */ }
  }
  return null;
}

export function storeDocumentDraftRecovery(storage, { document, title, body }) {
  if (!storage || !document?.id) return false;
  const record = {
    schemaVersion: DOCUMENT_DRAFT_RECOVERY_SCHEMA_VERSION,
    documentId: document.id,
    baseTitle: String(document.title ?? ''),
    baseBody: bodyOf(document.body),
    draftTitle: String(title ?? ''),
    draftBody: bodyOf(body),
  };
  try {
    storage.setItem(recoveryKey(document.id), JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

// An acknowledged response may arrive after the user has typed more. Only
// remove the recovery record when it still represents the exact sent draft.
export function clearDocumentDraftRecovery(storage, documentId, expectedDraft = null) {
  if (!storage || !documentId) return false;
  try {
    if (expectedDraft) {
      const current = loadDocumentDraftRecovery(storage, documentId);
      if (current && (
        current.draftTitle !== String(expectedDraft.title ?? '')
        || current.draftBody !== bodyOf(expectedDraft.body)
      )) return false;
    }
    storage.removeItem(recoveryKey(documentId));
    return true;
  } catch {
    return false;
  }
}

export function resolveDocumentDraftRecovery(document, recovery) {
  const saved = {
    title: String(document?.title ?? ''),
    body: bodyOf(document?.body),
  };
  const base = {
    title: recovery?.baseTitle,
    body: recovery?.baseBody,
  };
  const draft = {
    title: recovery?.draftTitle,
    body: recovery?.draftBody,
  };

  if (!document || !isRecoveryRecord(recovery, document.id)) {
    return { kind: 'none', clear: false, ...saved, isDirty: false, status: 'Saved' };
  }
  if (snapshotsMatch(saved, draft) || snapshotsMatch(base, draft)) {
    return { kind: 'obsolete', clear: true, ...saved, isDirty: false, status: 'Saved' };
  }
  if (snapshotsMatch(saved, base)) {
    return {
      kind: 'recovered', clear: false,
      title: recovery.draftTitle, body: recovery.draftBody,
      isDirty: true, status: 'Recovered draft',
    };
  }
  return {
    kind: 'conflict', clear: false,
    title: recovery.draftTitle, body: recovery.draftBody,
    isDirty: true, status: 'Recovered draft — saved copy changed',
  };
}
