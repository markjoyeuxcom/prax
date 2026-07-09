// Due-date buckets for the Prax UI — the single source of truth for how a task's
// due date is labelled and toned everywhere (list rows, board cards, Today view,
// drawer chip). Ported from the design prototype's fmtDue.
//
// Buckets: 'overdue' (< today) · 'today' · 'soon' (≤ SOON_DAYS ahead) · 'later'.
// A completed task always renders muted regardless of date ('done').

const SOON_DAYS = 3;

// `now` is injectable so tests are deterministic; production callers omit it.
// `dueTime` ('HH:MM', optional) is appended to the label so a timed task reads
// "Today 12:00" / "Jul 9 12:00 · overdue"; the bucket stays date-only.
export function dueFlag(dueDate, { done = false, now = new Date(), dueTime = null } = {}) {
  if (!dueDate) return null;
  const due = new Date(`${dueDate}T12:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  const diffDays = Math.round((due - today) / 86_400_000);
  const date = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const t = dueTime ? ` ${dueTime}` : '';

  if (done) return { label: `${date}${t}`, bucket: 'done' };
  if (diffDays < 0) return { label: `${date}${t} · overdue`, bucket: 'overdue' };
  if (diffDays === 0) return { label: `Today${t}`, bucket: 'today' };
  if (diffDays <= SOON_DAYS) return { label: `${date}${t}`, bucket: 'soon' };
  return { label: `${date}${t}`, bucket: 'later' };
}

// Bucket a task for the Today view / sidebar badge without formatting a label.
export function dueBucket(dueDate, { now = new Date() } = {}) {
  const flag = dueFlag(dueDate, { now });
  return flag ? flag.bucket : 'none';
}
