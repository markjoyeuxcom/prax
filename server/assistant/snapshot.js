// Grounding for chat backends that cannot call tools (claude-cli, ollama,
// llama.cpp): a bounded, honest snapshot of the live workspace injected into
// the system prompt, so the model answers data questions from truth instead
// of fabricating ("you have no tasks") to fill the vacuum. Pure — callers
// fetch tasks/projects; this only shapes them.

const LIST_CAP = 12;

// Server-local calendar date. Prax is local-first: the server runs on the
// user's machine, so server-local IS the user's "today" (the same convention
// the client applies to plannedFor/dueDate).
export function localToday(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function taskLine(task, projectNames) {
  const bits = [
    task.dueDate ? `due ${task.dueDate}${task.dueTime ? ` ${task.dueTime}` : ''}` : null,
    task.plannedFor ? `planned ${task.plannedFor}` : null,
    task.status === 'in-progress' ? 'in progress' : null,
    projectNames.get(task.projectId) || null,
  ].filter(Boolean);
  return `- ${task.title}${bits.length ? ` (${bits.join(' · ')})` : ''}`;
}

// Every section header carries the TRUE total; the list body is capped and
// says exactly how many were elided — a snapshot must never silently shrink.
function section(title, items, projectNames) {
  if (!items.length) return null;
  const shown = items.slice(0, LIST_CAP);
  const lines = [`${title} (${items.length}):`, ...shown.map((t) => taskLine(t, projectNames))];
  if (items.length > shown.length) lines.push(`- …and ${items.length - shown.length} more`);
  return lines.join('\n');
}

export function buildWorkspaceSnapshot({ tasks = [], projects = [], today = localToday() } = {}) {
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  const live = tasks.filter((t) => !t.archivedAt);
  const open = live.filter((t) => t.status !== 'completed');
  const completed = live.length - open.length;
  const snoozed = open.filter((t) => t.deferredUntil && t.deferredUntil > today).length;

  const overdue = open
    .filter((t) => t.dueDate && t.dueDate < today)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  const dueToday = open.filter((t) => t.dueDate === today);
  const plannedToday = open.filter((t) => t.plannedFor === today);
  const inProgress = open.filter((t) => t.status === 'in-progress');
  const inbox = projects.find((p) => p.slug === 'inbox');
  const inboxOpen = inbox ? open.filter((t) => t.projectId === inbox.id) : [];

  const head = [
    `Live workspace snapshot — ${today} (captured just now; this is the truth about the user's data)`,
    `Totals: ${projects.length} project${projects.length === 1 ? '' : 's'} · ${open.length} open task${open.length === 1 ? '' : 's'} · ${completed} completed${snoozed ? ` · ${snoozed} snoozed` : ''}`,
  ];

  if (!projects.length && !live.length) {
    return [...head, 'The workspace is empty: no projects and no tasks exist yet.'].join('\n');
  }

  const perProject = projects
    .map((p) => `- ${p.name}: ${open.filter((t) => t.projectId === p.id).length} open`)
    .slice(0, LIST_CAP * 2);
  const projectBlock = [`Projects (${projects.length}):`, ...perProject];
  if (projects.length > perProject.length) projectBlock.push(`- …and ${projects.length - perProject.length} more`);

  return [
    ...head,
    '',
    projectBlock.join('\n'),
    section('Overdue', overdue, projectNames),
    section('Due today', dueToday, projectNames),
    section("Planned for today (the user's plan)", plannedToday, projectNames),
    section('In progress', inProgress, projectNames),
    section('Inbox', inboxOpen, projectNames),
  ].filter(Boolean).join('\n\n');
}

// The behavioural contract that rides with the snapshot. The fabrication
// failure this guards against is real: without it, a no-tools model asked
// "what's overdue" invented an empty workspace and doubled down when pressed.
export function buildReadOnlyRules(snapshotAvailable) {
  const rules = [
    'This backend cannot call tools, so this is a READ-ONLY conversation.',
    snapshotAvailable
      ? 'Answer questions about the user\'s tasks and projects ONLY from the snapshot below — it is current and authoritative. Never contradict it and never invent items or counts.'
      : 'The workspace snapshot could not be loaded this turn, so you have NO visibility into the user\'s tasks, projects, or documents. When asked about their data, say exactly that — never guess, never claim counts, never say the workspace is empty.',
    'If the user asks about something beyond what you can see (document contents, task notes, history), say you cannot check that in this mode.',
    'You cannot create, edit, complete, or delete anything. When asked to act, say changes need a tool-capable API backend (Settings ▸ Intelligence) and spell out what the user can do by hand instead.',
  ];
  return rules.join('\n');
}
