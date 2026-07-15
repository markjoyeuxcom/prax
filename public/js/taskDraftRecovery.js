export const TASK_DRAFT_RECOVERY_SCHEMA_VERSION = 1;
export const TASK_DRAFT_RECOVERY_KEY_PREFIX = 'prax.taskDraftRecovery.v1.';

export function normalizeTaskDraftTitle(value) {
  return String(value ?? '').trim();
}

function text(value) {
  return String(value ?? '');
}

function snapshot(value) {
  return {
    title: normalizeTaskDraftTitle(value?.title),
    description: text(value?.description),
    notes: text(value?.notes),
  };
}

function snapshotsMatch(left, right) {
  const a = snapshot(left);
  const b = snapshot(right);
  return a.title === b.title && a.description === b.description && a.notes === b.notes;
}

export function taskDraftIsDirty(task, draft) {
  return Boolean(task) && !snapshotsMatch(task, draft);
}

function recoveryKey(taskId) {
  return `${TASK_DRAFT_RECOVERY_KEY_PREFIX}${encodeURIComponent(String(taskId || ''))}`;
}

function isRecoveryRecord(value, taskId) {
  return Boolean(value)
    && value.schemaVersion === TASK_DRAFT_RECOVERY_SCHEMA_VERSION
    && value.taskId === taskId
    && typeof value.baseTitle === 'string'
    && typeof value.baseDescription === 'string'
    && typeof value.baseNotes === 'string'
    && typeof value.draftTitle === 'string'
    && typeof value.draftDescription === 'string'
    && typeof value.draftNotes === 'string';
}

export function loadTaskDraftRecovery(storage, taskId) {
  if (!storage || !taskId) return null;
  const key = recoveryKey(taskId);
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const record = JSON.parse(raw);
    if (isRecoveryRecord(record, taskId)) return record;
    storage.removeItem(key);
  } catch {
    try { storage.removeItem(key); } catch { /* storage is unavailable */ }
  }
  return null;
}

export function storeTaskDraftRecovery(storage, { task, title, description, notes }) {
  if (!storage || !task?.id) return false;
  const record = {
    schemaVersion: TASK_DRAFT_RECOVERY_SCHEMA_VERSION,
    taskId: task.id,
    baseTitle: text(task.title),
    baseDescription: text(task.description),
    baseNotes: text(task.notes),
    draftTitle: text(title),
    draftDescription: text(description),
    draftNotes: text(notes),
  };
  try {
    storage.setItem(recoveryKey(task.id), JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function clearTaskDraftRecovery(storage, taskId, expectedDraft = null) {
  if (!storage || !taskId) return false;
  try {
    if (expectedDraft) {
      const current = loadTaskDraftRecovery(storage, taskId);
      if (current && !snapshotsMatch({
        title: current.draftTitle,
        description: current.draftDescription,
        notes: current.draftNotes,
      }, expectedDraft)) return false;
    }
    storage.removeItem(recoveryKey(taskId));
    return true;
  } catch {
    return false;
  }
}

export function resolveTaskDraftRecovery(task, recovery) {
  const saved = snapshot(task);
  if (!task || !isRecoveryRecord(recovery, task.id)) {
    return { kind: 'none', clear: false, ...saved, isDirty: false, status: 'Saved' };
  }

  const base = {
    title: recovery.baseTitle,
    description: recovery.baseDescription,
    notes: recovery.baseNotes,
  };
  const draft = {
    title: recovery.draftTitle,
    description: recovery.draftDescription,
    notes: recovery.draftNotes,
  };
  if (snapshotsMatch(saved, draft) || snapshotsMatch(base, draft)) {
    return { kind: 'obsolete', clear: true, ...saved, isDirty: false, status: 'Saved' };
  }
  if (snapshotsMatch(saved, base)) {
    return { kind: 'recovered', clear: false, ...draft, isDirty: true, status: 'Recovered draft' };
  }
  return {
    kind: 'conflict', clear: false, ...draft, isDirty: true,
    status: 'Recovered draft — saved copy changed',
  };
}
