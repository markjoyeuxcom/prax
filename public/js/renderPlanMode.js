import { escapeHtml, chip } from './renderHelpers.js';
import { icon } from './icons.js';
import { projectChipHtml } from './renderToday.js';

// The planning pass and the shutdown ritual — one overlay, two modes, pure
// state → HTML. state.planMode = { mode: 'plan'|'shutdown', queue: [{ id,
// bucket }], index, added, carried, dropped, rescheduled } (queue entries
// resolve against state.tasks at render time; a task deleted mid-pass simply
// renders as skipped by the advance logic in main.js).
//
// Every action is a plain data-action button: plan-mode-add / plan-mode-today
// / plan-mode-drop / plan-mode-skip / shutdown-carry / shutdown-reschedule /
// shutdown-drop / close-plan-mode. Keyboard (Enter primary, S skip, Esc
// close) is bound in main.js.

const BUCKET_LABELS = {
  stale: 'Planned earlier — never shut down',
  overdue: 'Overdue',
  today: 'Due today',
  inbox: 'Inbox (undated)',
  upcoming: 'Due this week',
  planned: 'Planned today',
};

function taskCard(state, task) {
  const due = task.dueDate ? `${task.dueDate}${task.dueTime ? ` ${task.dueTime}` : ''}` : 'no due date';
  const plannedNote = task.plannedFor ? ` · planned ${escapeHtml(task.plannedFor)}` : '';
  const carryNote = task.carryCount > 0 ? chip(`carried ${task.carryCount}×`, 'slip-deferred') : '';
  const project = (state.projects || []).find((entry) => entry.id === task.projectId);
  return `<div class="planmode__card">
    <div class="planmode__title">${escapeHtml(task.title || 'Untitled task')}</div>
    <div class="planmode__meta">${projectChipHtml({ projName: project?.name || 'No project', projColor: project?.color })}
      <span class="planmode__due">${escapeHtml(due)}${plannedNote}</span>${carryNote}</div>
  </div>`;
}

function summaryLine(planMode) {
  if (planMode.mode === 'plan') {
    return `${planMode.added} pulled into today`;
  }
  const parts = [`${planMode.done ?? 0} done today`, `${planMode.carried} carried`, `${planMode.rescheduled} rescheduled`, `${planMode.dropped} dropped`];
  return parts.join(' · ');
}

export function renderPlanModeHtml(state) {
  const planMode = state.planMode;
  if (!planMode) return '';
  const isPlan = planMode.mode === 'plan';
  const title = isPlan ? 'Plan today' : 'Shut down today';
  const entry = planMode.queue[planMode.index];
  const task = entry ? (state.tasks || []).find((candidate) => candidate.id === entry.id) : null;

  let body;
  if (!entry || !task) {
    // End of the queue (or the current task vanished): the honest summary.
    body = `<div class="planmode__doneword">${isPlan ? 'Plan set.' : 'Day closed.'}</div>
      <div class="planmode__summary">${escapeHtml(summaryLine(planMode))}</div>
      <div class="planmode__actions"><button class="btn-primary" type="button" data-action="close-plan-mode">Done</button></div>`;
  } else {
    const bucket = BUCKET_LABELS[entry.bucket] || '';
    const progress = `${planMode.index + 1} of ${planMode.queue.length}`;
    let actions;
    if (isPlan && entry.bucket === 'stale') {
      actions = `<button class="btn-primary" type="button" data-action="plan-mode-today">Move to today</button>
        <button class="btn-outline" type="button" data-action="plan-mode-drop">Drop from plan</button>
        <button class="btn-ghost" type="button" data-action="plan-mode-skip">Skip</button>`;
    } else if (isPlan) {
      actions = `<input class="time-input" type="time" data-plan-time title="Optional time — timeboxes the task (flows to your calendar)" aria-label="Optional time">
        <button class="btn-primary" type="button" data-action="plan-mode-add">Add to today</button>
        <button class="btn-ghost" type="button" data-action="plan-mode-skip">Skip</button>`;
    } else {
      actions = `<button class="btn-primary" type="button" data-action="shutdown-carry">Carry to tomorrow</button>
        <input class="date-input" type="date" data-shutdown-date aria-label="Reschedule date">
        <button class="btn-outline" type="button" data-action="shutdown-reschedule">Reschedule</button>
        <button class="btn-ghost" type="button" data-action="shutdown-drop">Drop from plan</button>`;
    }
    body = `<div class="planmode__bucket">${escapeHtml(bucket)} <span class="planmode__progress">${escapeHtml(progress)}</span></div>
      ${taskCard(state, task)}
      <div class="planmode__actions">${actions}</div>`;
  }

  return `
    <div class="overlay-center" data-overlay="planmode" data-action="close-plan-mode">
      <div class="planmode" role="dialog" aria-label="${escapeHtml(title)}">
        <div class="planmode__head">${icon('check')}<span class="planmode__head-title">${escapeHtml(title)}</span></div>
        ${body}
        <div class="planmode__foot">
          <span class="brief__hint-k"><span class="kbd">Enter</span> ${isPlan ? 'add' : 'carry'} · <span class="kbd">S</span> skip · <span class="kbd">Esc</span> close</span>
        </div>
      </div>
    </div>`;
}
