import { parseCaptureShorthand } from './captureShorthand.js';

// Pure core of the system-wide capture bar (desktop tray / global-shortcut
// window). The DOM glue lives in captureBar.js; everything here is
// deterministic and unit-tested: shorthand resolution against the known
// project list, exact-once payload assembly, and draft persistence.

export const CAPTURE_BAR_DRAFT_KEY = 'prax.captureBar.draft';

function matchProject(projects, token) {
  const wanted = String(token || '').toLowerCase();
  if (!wanted) return null;
  return (projects || []).find((project) => {
    if (!project) return false;
    if (String(project.slug || '').toLowerCase() === wanted) return true;
    return String(project.name || '').toLowerCase() === wanted;
  }) || null;
}

// Resolve raw capture-bar text into a create-ready shape. An unknown #project
// token is NOT silently dropped: the capture falls back to Inbox and the token
// is restored into the title, so the intent survives for later triage.
export function resolveCapture(raw, { projects = [], now = new Date() } = {}) {
  const parsed = parseCaptureShorthand(raw, now);
  let title = parsed.title;
  let project = null;
  if (parsed.project) {
    project = matchProject(projects, parsed.project);
    if (!project) title = title ? `${title} #${parsed.project}` : `#${parsed.project}`;
  }
  return {
    ok: Boolean(title),
    title,
    projectSlug: project ? project.slug : 'inbox',
    projectName: project ? project.name : 'Inbox',
    priority: parsed.priority || 'medium',
    dueDate: parsed.dueDate || null,
    labels: parsed.labels || null,
  };
}

// The payload carries a client-generated id so a retry after an ambiguous
// failure replays the SAME create (server-side idempotency) instead of
// duplicating the task.
export function buildCreatePayload(resolved, id) {
  return {
    id,
    title: resolved.title,
    project: resolved.projectSlug,
    priority: resolved.priority,
    status: 'planned',
    ...(resolved.dueDate ? { dueDate: resolved.dueDate } : {}),
    ...(resolved.labels ? { labels: resolved.labels } : {}),
  };
}

// One-line destination hint rendered under the input.
export function destinationHint(resolved) {
  if (!resolved.ok) return '';
  const parts = [`→ ${resolved.projectName}`];
  if (resolved.dueDate) parts.push(resolved.dueDate);
  if (resolved.priority !== 'medium') parts.push(resolved.priority);
  if (resolved.labels?.length) parts.push(resolved.labels.map((label) => `@${label}`).join(' '));
  return parts.join(' · ');
}

// Draft persistence uses its OWN storage key, deliberately separate from the
// in-app capture's owner-guarded recovery store: the bar and an app tab can
// never clobber each other's crash drafts because they never share a slot.
const CAPTURE_STATE_KEY = 'prax.captureBar.state.v1';

function captureState(storage) {
  const stored = storage?.getItem(CAPTURE_STATE_KEY);
  if (stored != null) {
    const parsed = JSON.parse(stored);
    if (typeof parsed?.raw !== 'string') throw new Error('Invalid capture recovery record');
    return { raw: parsed.raw, pending: parsed.pending || null };
  }
  return { raw: storage?.getItem(CAPTURE_BAR_DRAFT_KEY) || '', pending: null };
}
function writeCaptureState(storage, state) {
  if (!storage?.setItem) return false;
  // Draft and submitted identity commit in one storage operation. The legacy
  // text key is only a compatibility mirror; reads prefer this full record.
  storage.setItem(CAPTURE_STATE_KEY, JSON.stringify(state));
  try {
    if (state.raw) storage.setItem(CAPTURE_BAR_DRAFT_KEY, state.raw);
    else storage.removeItem(CAPTURE_BAR_DRAFT_KEY);
  } catch { /* the canonical record above already persisted */ }
  return true;
}
export function loadBarDraft(storage) {
  try { return captureState(storage).raw; } catch { return ''; }
}
export function loadBarPending(storage) {
  try { return captureState(storage).pending; } catch { return null; }
}
export function saveBarDraft(storage, text) {
  try { return writeCaptureState(storage, { ...captureState(storage), raw: text }); }
  catch { return false; }
}
export function saveBarPending(storage, pending) {
  try { return writeCaptureState(storage, { ...captureState(storage), pending }); }
  catch { return false; }
}
export function finishBarCapture(storage, id, clearDraft) {
  try {
    const state = captureState(storage);
    if (state.pending?.payload?.id !== id) return false;
    return writeCaptureState(storage, { raw: clearDraft ? '' : state.raw, pending: null });
  } catch { return false; }
}
export function clearBarDraft(storage) { return saveBarDraft(storage, ''); }
