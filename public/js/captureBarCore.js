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
export function loadBarDraft(storage) {
  try {
    const value = storage?.getItem(CAPTURE_BAR_DRAFT_KEY);
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

export function saveBarDraft(storage, text) {
  try {
    if (text) storage?.setItem(CAPTURE_BAR_DRAFT_KEY, text);
    else storage?.removeItem(CAPTURE_BAR_DRAFT_KEY);
  } catch { /* storage unavailable: the draft simply does not persist */ }
}

export function clearBarDraft(storage) {
  saveBarDraft(storage, '');
}
