import { normalizeLabels } from './labels.js';
import { canonicalTaskCreatePayload } from './taskCreateOutcome.js';

export const TASK_CAPTURE_RECOVERY_KEY = 'prax.taskCaptureRecovery.v1';
const SCHEMA_VERSION = 1;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// One token per loaded module instance ≈ one per tab. The recovery key is
// shared across tabs, so every write stamps its owner and a default clear
// refuses to remove a draft another tab stamped — loading (for recovery
// restore after a reload) stays cross-tab on purpose.
const CAPTURE_RECOVERY_OWNER = (globalThis.crypto?.randomUUID?.() || String(Math.random()));

function captureFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
  const normalized = {};
  if (typeof fields.priority === 'string') normalized.priority = fields.priority;
  if (typeof fields.dueDate === 'string') normalized.dueDate = fields.dueDate;
  if (typeof fields.dueTime === 'string') normalized.dueTime = fields.dueTime;
  if (typeof fields.recurrence === 'string') normalized.recurrence = fields.recurrence;
  if (typeof fields.project === 'string') normalized.project = fields.project;
  if (Array.isArray(fields.labels)) normalized.labels = normalizeLabels(fields.labels);
  return normalized;
}

function droppedFields(dropped) {
  if (!Array.isArray(dropped)) return [];
  return dropped
    .filter((item) => item && typeof item.field === 'string' && typeof item.value === 'string')
    .slice(0, 25)
    .map(({ field, value }) => ({ field, value }));
}

export function captureIntentKey(draft = {}) {
  return JSON.stringify({
    query: String(draft.query ?? ''),
    projectId: draft.projectId || null,
    dueDate: draft.dueDate || null,
    status: draft.status || 'planned',
    nlFields: captureFields(draft.nlFields),
  });
}

function normalizeRequest(payload, intent) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { payload: null, intent: null };
  const canonical = canonicalTaskCreatePayload(payload);
  if (!canonical.id || !UUID_RE.test(canonical.id) || typeof intent !== 'string' || !intent) {
    return { payload: null, intent: null };
  }
  return { payload: canonical, intent };
}

function normalizeRecovery(value) {
  if (!value || value.schemaVersion !== SCHEMA_VERSION) return null;
  const query = typeof value.query === 'string' ? value.query : '';
  const request = normalizeRequest(value.requestPayload, value.requestIntent);
  if (!query.trim() && !request.payload) return null;
  return {
    query,
    projectId: typeof value.projectId === 'string' ? value.projectId : null,
    dueDate: typeof value.dueDate === 'string' ? value.dueDate : null,
    status: typeof value.status === 'string' ? value.status : 'planned',
    nlFields: captureFields(value.nlFields),
    nlDropped: droppedFields(value.nlDropped),
    nlRaw: typeof value.nlRaw === 'string' ? value.nlRaw : null,
    requestPayload: request.payload,
    requestIntent: request.intent,
    owner: typeof value.owner === 'string' ? value.owner : null,
  };
}

export function loadTaskCaptureRecovery(storage) {
  if (!storage?.getItem) return null;
  try {
    return normalizeRecovery(JSON.parse(storage.getItem(TASK_CAPTURE_RECOVERY_KEY)));
  } catch {
    return null;
  }
}

export function storeTaskCaptureRecovery(storage, draft) {
  if (!storage?.setItem) return false;
  const normalized = normalizeRecovery({ schemaVersion: SCHEMA_VERSION, ...draft });
  if (!normalized) {
    clearTaskCaptureRecovery(storage);
    return false;
  }
  try {
    storage.setItem(TASK_CAPTURE_RECOVERY_KEY, JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      ...normalized,
      // Stamp THIS tab as the writer (never the draft's stale owner field).
      owner: CAPTURE_RECOVERY_OWNER,
      savedAt: new Date().toISOString(),
    }));
    return true;
  } catch {
    return false;
  }
}

export function clearTaskCaptureRecovery(storage, { force = false } = {}) {
  if (!storage?.removeItem) return false;
  if (!force) {
    // A draft stamped by another tab is that tab's unfinished work — leave it.
    // Unreadable/legacy payloads carry no owner and stay removable.
    let stored = null;
    try {
      stored = normalizeRecovery(JSON.parse(storage.getItem?.(TASK_CAPTURE_RECOVERY_KEY)));
    } catch { /* corrupt payload protects nothing */ }
    if (stored?.owner && stored.owner !== CAPTURE_RECOVERY_OWNER) return false;
  }
  try {
    storage.removeItem(TASK_CAPTURE_RECOVERY_KEY);
    return true;
  } catch {
    return false;
  }
}
