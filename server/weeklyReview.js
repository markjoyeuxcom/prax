import { ageInDays, isPendingInboxDocument, isPendingInboxTask, INBOX_LINK } from '../public/js/inboxModel.js';

// Weekly review — the deterministic compiler. Pure (data in → Markdown +
// stats out); the route feeds it from the repositories and writes the result
// into the Library as a dated, idempotent-by-week document. An EMPTY week
// compiles truthfully ("nothing shipped") — a valid review of a bad week is
// the product working, never padded, never omitted.
//
// All week boundaries are UTC dates (the stored timestamps are UTC); the doc
// footer states its own definitions so the reader always knows what the
// words mean.

const DAY_MS = 86_400_000;
const SLIP_KINDS = new Set(['deferred', 'rescheduled', 'carried']);

function utcDateString(value) {
  return new Date(value).toISOString().slice(0, 10);
}

export function addDaysUtc(dateString, days) {
  return utcDateString(new Date(`${dateString}T00:00:00.000Z`).getTime() + days * DAY_MS);
}

// Monday of the ISO week containing the given date (UTC).
export function weekStartOf(date) {
  const utc = new Date(`${utcDateString(date)}T00:00:00.000Z`);
  const day = utc.getUTCDay(); // 0 Sun .. 6 Sat
  const sinceMonday = day === 0 ? 6 : day - 1;
  return utcDateString(utc.getTime() - sinceMonday * DAY_MS);
}

// ISO-8601 week id ('2026-W29') for the week containing the given date (UTC).
export function isoWeekId(date) {
  const monday = new Date(`${weekStartOf(date)}T00:00:00.000Z`);
  const thursday = new Date(monday.getTime() + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1Monday = new Date(`${weekStartOf(jan4)}T00:00:00.000Z`);
  const week = Math.round((monday - week1Monday) / (7 * DAY_MS)) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function weeklyReviewTitle(weekId) {
  return `Weekly review — ${weekId}`;
}

function inRange(iso, start, endExclusive) {
  if (!iso) return false;
  const date = utcDateString(iso);
  return date >= start && date < endExclusive;
}

function taskLine(task, projectName, extra = '') {
  return `- ${task.title || 'Untitled task'}${projectName ? ` _(${projectName})_` : ''}${extra}`;
}

export function compileWeeklyReview({
  tasks = [], activity = [], projects = [], documents = [], weekStart, now = new Date(),
} = {}) {
  const start = weekStart;
  const end = addDaysUtc(start, 7);
  const weekId = isoWeekId(new Date(`${start}T00:00:00.000Z`));
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const projectName = (id) => projectById.get(id)?.name || 'No project';
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const inbox = projects.find((project) => project.slug === 'inbox') || null;

  const weekActivity = activity.filter((event) => inRange(event.createdAt, start, end));
  const activeTaskIds = new Set(weekActivity.map((event) => event.taskId));

  function isCompletionActivity(event) {
    if (!event) return false;
    if (event.eventType === 'completed') return true;
    if (event.eventType === 'status') {
      const msg = String(event.message || '').toLowerCase();
      return msg.includes('completed');
    }
    return false;
  }

  const completedThisWeekTaskIds = new Set(
    weekActivity
      .filter(isCompletionActivity)
      .map((event) => event.taskId)
  );

  // Shipped: completed during the week. Uses actual completion events and
  // explicit completion timestamps so editing an old task does not falsely
  // ship it again, and reopening a task later does not erase historical work.
  // Legacy completed tasks with no recorded completion events are omitted
  // from shipped rather than guessing from createdAt.
  const shippedTaskMap = new Map();
  const legacyUnknown = [];

  for (const task of tasks) {
    if (completedThisWeekTaskIds.has(task.id)) {
      shippedTaskMap.set(task.id, task);
    } else {
      const completedTimestamp = task.completedAt || task.completed_at;
      if (completedTimestamp) {
        if (inRange(completedTimestamp, start, end)) {
          shippedTaskMap.set(task.id, task);
        }
      } else if (task.status === 'completed') {
        if ((task.createdAt && inRange(task.createdAt, start, end))
          || (task.updatedAt && inRange(task.updatedAt, start, end))) {
          legacyUnknown.push(task);
        }
      }
    }
  }

  for (const event of weekActivity.filter(isCompletionActivity)) {
    if (!shippedTaskMap.has(event.taskId)) {
      const task = taskById.get(event.taskId);
      if (task) shippedTaskMap.set(event.taskId, task);
      else shippedTaskMap.set(event.taskId, { id: event.taskId, title: '(a task no longer present)', projectId: null });
    }
  }

  const shipped = [...shippedTaskMap.values()];

  // Stalled: in progress, no chronicle events all week, untouched since
  // before the week began.
  const stalled = tasks.filter((task) => task.status === 'in-progress' && !task.archivedAt
    && !activeTaskIds.has(task.id)
    && task.updatedAt && utcDateString(task.updatedAt) < start);

  // Most-slipped: deferred/rescheduled/carried events during the week.
  const slipCounts = new Map();
  for (const event of weekActivity) {
    if (SLIP_KINDS.has(event.eventType)) {
      slipCounts.set(event.taskId, (slipCounts.get(event.taskId) || 0) + 1);
    }
  }
  const mostSlipped = [...slipCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([taskId, count]) => ({ task: taskById.get(taskId) || null, count }));

  // Inbox aging: open inbox items older than 7 days.
  const inboxAging = inbox
    ? [...tasks.filter(isPendingInboxTask), ...documents.filter(isPendingInboxDocument)]
      .filter(item => item.projectId === inbox.id && item.createdAt && ageInDays(item.createdAt, now) >= 7)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    : [];

  // Silent projects: no task movement (updatedAt) and no doc movement all
  // week. The Inbox is a triage bucket, not a project — excluded.
  const silentProjects = projects.filter((project) => {
    if (inbox && project.id === inbox.id) return false;
    const taskMoved = tasks.some((task) => task.projectId === project.id && inRange(task.updatedAt, start, end));
    const docMoved = documents.some((doc) => doc.projectId === project.id && inRange(doc.updatedAt, start, end));
    return !taskMoved && !docMoved;
  });

  // Next week: due or planned in the seven days after this week.
  const nextEnd = addDaysUtc(end, 7);
  const nextWeekTasks = tasks.filter((task) => task.status !== 'completed' && !task.archivedAt
    && ((task.dueDate && task.dueDate >= end && task.dueDate < nextEnd)
      || (task.plannedFor && task.plannedFor >= end && task.plannedFor < nextEnd)));

  // Docs touched this week — wiki-linked so the review joins the graph.
  const docsTouched = documents
    .filter((doc) => !doc.archivedAt && inRange(doc.updatedAt, start, end))
    .slice(0, 10);

  const lines = [];
  lines.push(`Week ${weekId} (${start} → ${addDaysUtc(start, 6)}).`);
  lines.push('');

  lines.push('## Shipped');
  lines.push('');
  if (shipped.length) {
    for (const task of shipped) lines.push(taskLine(task, projectName(task.projectId)));
  } else {
    lines.push('Nothing shipped this week.');
  }
  if (legacyUnknown.length) {
    lines.push('');
    lines.push(`_${legacyUnknown.length} completed task${legacyUnknown.length === 1 ? '' : 's'} with unrecorded completion date omitted from shipped count._`);
  }
  lines.push('');

  lines.push('## Stalled');
  lines.push('');
  if (stalled.length) {
    for (const task of stalled) lines.push(taskLine(task, projectName(task.projectId), ` — untouched since ${utcDateString(task.updatedAt)}`));
  } else {
    lines.push('Nothing in progress went silent.');
  }
  lines.push('');

  lines.push('## Most slipped');
  lines.push('');
  if (mostSlipped.length) {
    for (const { task, count } of mostSlipped) {
      lines.push(task
        ? taskLine(task, projectName(task.projectId), ` — pushed ${count}× this week`)
        : `- (a task no longer present) — pushed ${count}× this week`);
    }
  } else {
    lines.push('No snoozes, reschedules, or carries recorded this week.');
  }
  lines.push('');

  lines.push('## Inbox aging');
  lines.push('');
  if (inboxAging.length) {
    lines.push(`${inboxAging.length} inbox item${inboxAging.length === 1 ? '' : 's'} older than a week. Oldest:`);
    for (const task of inboxAging.slice(0, 3)) lines.push(taskLine(task, null, ` — captured ${utcDateString(task.createdAt)}`));
  } else {
    lines.push('No inbox items older than a week.');
  }
  lines.push('', `[Process Inbox](${INBOX_LINK}) — file pending tasks and notes; saved weekly reviews stay separate.`);
  lines.push('');

  lines.push('## Silent projects');
  lines.push('');
  if (silentProjects.length) {
    for (const project of silentProjects) lines.push(`- ${project.name}`);
  } else {
    lines.push('Every project saw movement this week.');
  }
  lines.push('');

  lines.push('## Next week');
  lines.push('');
  if (nextWeekTasks.length) {
    for (let i = 0; i < 7; i += 1) {
      const day = addDaysUtc(end, i);
      const count = nextWeekTasks.filter((task) => task.dueDate === day || task.plannedFor === day).length;
      if (count) lines.push(`- ${day}: ${count} task${count === 1 ? '' : 's'}`);
    }
    lines.push(`${nextWeekTasks.length} total due or planned.`);
  } else {
    lines.push('Nothing due or planned yet.');
  }
  lines.push('');

  if (docsTouched.length) {
    lines.push('## Documents touched');
    lines.push('');
    for (const doc of docsTouched) lines.push(`- [[${doc.title}]]`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('*Definitions: weeks are UTC Monday–Sunday. Shipped = completed during the week '
    + '(exact completion events or timestamps only; legacy tasks with unknown completion dates are omitted). '
    + 'Stalled = in progress with no chronicle events all week. Slips = deferred / rescheduled / '
    + 'carried events. Silent = no task or document movement. Generated by Prax; regenerate any '
    + 'time — the same week updates this document in place.*');

  return {
    weekId,
    markdown: lines.join('\n'),
    stats: {
      shipped: shipped.length,
      stalled: stalled.length,
      slipped: mostSlipped.length,
      inboxAging: inboxAging.length,
      silentProjects: silentProjects.length,
      nextWeek: nextWeekTasks.length,
    },
  };
}
