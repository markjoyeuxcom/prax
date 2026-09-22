import { isOpen } from './statusMap.js';
import { dueBucket } from './dueFlags.js';
import { isoDate } from './dateHelpers.js';

// Build a copyable daily brief / on-call handoff from already-loaded state —
// overdue / due-today / due-soon tasks, who's on call with handoff notes, and
// recently-changed docs. Pure (state + now → Markdown), so it needs no server
// round-trip; an optional AI pass narrates it separately.
function snoozed(task, now) {
  return Boolean(task?.deferredUntil) && new Date(task.deferredUntil) > now;
}

function taskLines(list, projName) {
  return list.map((t) => `- ${t.title || 'Untitled'}${t.projectId ? ` _(${projName(t.projectId)})_` : ''}`).join('\n');
}

export function buildDailyBrief(state, now = new Date()) {
  const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
  const projects = Array.isArray(state?.projects) ? state.projects : [];
  const projName = (id) => projects.find((p) => p.id === id)?.name || 'Inbox';

  const open = tasks.filter((t) => isOpen(t) && !snoozed(t, now));
  const dated = open.filter((t) => t.dueDate);
  const overdue = dated.filter((t) => dueBucket(t.dueDate, { now }) === 'overdue');
  const today = dated.filter((t) => dueBucket(t.dueDate, { now }) === 'today');
  const soon = dated.filter((t) => dueBucket(t.dueDate, { now }) === 'soon');

  const onCall = projects.filter((p) => (p.onCall && p.onCall.trim()) || (p.handoffNotes && p.handoffNotes.trim()));

  const recentDocs = (Array.isArray(state?.documents) ? state.documents : [])
    .filter((d) => (d.status || 'active') === 'active' && d.updatedAt && (now - new Date(d.updatedAt)) < 3 * 86_400_000)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 8);

  // The viewer's calendar date — the same day dueBucket calls "today".
  const lines = [`# Daily brief — ${isoDate(now)}`, ''];
  lines.push(`**${overdue.length} overdue · ${today.length} due today · ${soon.length} due soon**`, '');

  if (overdue.length) lines.push('## ⚠ Overdue', '', taskLines(overdue, projName), '');
  if (today.length) lines.push('## Due today', '', taskLines(today, projName), '');
  if (soon.length) lines.push('## Due soon', '', taskLines(soon, projName), '');
  if (!overdue.length && !today.length && !soon.length) lines.push('_Nothing overdue or due — a clear runway._', '');

  if (onCall.length) {
    lines.push('## On call & handoff', '');
    for (const p of onCall) {
      lines.push(`- **${p.name}** — on call: ${p.onCall && p.onCall.trim() ? p.onCall.trim() : '—'}`);
      if (p.handoffNotes && p.handoffNotes.trim()) lines.push(`  - Handoff: ${p.handoffNotes.trim()}`);
    }
    lines.push('');
  }

  if (recentDocs.length) {
    lines.push('## Recently changed docs', '', recentDocs.map((d) => `- ${d.title || 'Untitled'}`).join('\n'), '');
  }

  return `${lines.join('\n').trim()}\n`;
}
