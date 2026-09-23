// Today plan & shutdown ritual (2026-07-18 plan) — controller.
// One queue-walking overlay, two modes. Every action is a normal PATCH; the
// server classifies planned/carried and owns carry_count. A failure keeps the
// current item on screen with a toast — skipping data loss is not an option.
//
// Dependencies are injected (inboxController.js pattern) so the walk runs in
// tests against plain fakes; main.js wires the live app.

import { updateTask as apiUpdateTask } from './taskApi.js';
import { normalizeTask as defaultNormalizeTask } from './taskModel.js';
import { dueBucket } from './dueFlags.js';
import { buildTodayGroups } from './renderToday.js';
import { isImeComposing, isInteractiveShortcutTarget } from './keyboardShortcuts.js';

export function planEligible(task, now) {
  return task && task.status !== 'completed' && !task.archivedAt
    && !(task.deferredUntil && new Date(task.deferredUntil) > now);
}

// Evening shutdown nudge (preference, default off): one gentle toast per day
// once the hour passes and planned items are still open. Delivery only — the
// decision walk lives behind the Today view's Shut down button.
const SHUTDOWN_NUDGE_KEY = 'prax.shutdownNudge.lastShown';

export function createPlanModeController({
  getState, setState, renderApp, showToast, alertError, taskById, todayISODate, inboxProjectId,
  applyTaskPatches, refreshTasksAfterWrites, partialTaskOutcome, taskCountLabel,
  updateTask = apiUpdateTask, normalizeTask = defaultNormalizeTask,
  doc = globalThis.document, storage = () => globalThis.localStorage,
}) {
  function buildPlanQueue(now = new Date()) {
    const state = getState();
    const today = todayISODate(now);
    const tasks = state.tasks || [];
    const seen = new Set();
    const queue = [];
    const push = (task, bucket) => {
      if (!task || seen.has(task.id)) return;
      seen.add(task.id);
      queue.push({ id: task.id, bucket });
    };
    const open = tasks.filter((task) => planEligible(task, now));
    // Stale plans first: yesterday's unshut-down working set demands a verdict.
    open.filter((task) => task.plannedFor && task.plannedFor < today)
      .forEach((task) => push(task, 'stale'));
    const unplanned = open.filter((task) => task.plannedFor !== today && !(task.plannedFor && task.plannedFor < today));
    const bucketOf = (task) => dueBucket(task.dueDate, { now });
    unplanned.filter((task) => bucketOf(task) === 'overdue').forEach((task) => push(task, 'overdue'));
    unplanned.filter((task) => bucketOf(task) === 'today').forEach((task) => push(task, 'today'));
    const inboxId = inboxProjectId();
    unplanned.filter((task) => task.projectId === inboxId && !task.dueDate).forEach((task) => push(task, 'inbox'));
    unplanned.filter((task) => task.dueDate && task.dueDate > today && task.dueDate <= todayISODate(new Date(now.getTime() + 7 * 86_400_000)))
      .forEach((task) => push(task, 'upcoming'));
    return queue;
  }

  function openPlanMode() {
    const queue = buildPlanQueue(new Date());
    setState({ planMode: { mode: 'plan', queue, index: 0, added: 0, carried: 0, dropped: 0, rescheduled: 0 } });
    renderApp();
  }

  function openShutdown() {
    const state = getState();
    const today = todayISODate();
    const queue = (state.tasks || [])
      .filter((task) => planEligible(task, new Date()) && task.plannedFor === today)
      .map((task) => ({ id: task.id, bucket: 'planned' }));
    const done = (state.tasks || []).filter((task) => task.plannedFor === today && task.status === 'completed' && !task.archivedAt).length;
    setState({ planMode: { mode: 'shutdown', queue, index: 0, added: 0, carried: 0, dropped: 0, rescheduled: 0, done } });
    renderApp();
  }

  function closePlanMode() {
    setState({ planMode: null });
    renderApp();
  }

  function mergePlanTask(updated) {
    const state = getState();
    setState({ tasks: state.tasks.map((task) => (task.id === updated.id ? normalizeTask(updated) : task)) });
  }

  // One decision at a time: a second activation (double click, Enter pressed
  // twice) while the first PATCH is in flight is ignored, instead of acting on
  // the same item and advancing twice past the next one unseen.
  let planModeDecisionPending = false;

  async function planModeAct(action) {
    const state = getState();
    const planMode = state.planMode;
    if (!planMode || planModeDecisionPending) return;
    const index = planMode.index;
    const entry = planMode.queue[index];
    // Advance only the walk and position this decision was made on: closing or
    // reopening the walk mid-flight keeps the newer walk as it is.
    const advance = (patch = {}) => {
      if (state.planMode !== planMode || state.planMode.index !== index) return;
      setState({ planMode: { ...planMode, ...patch, index: index + 1 } });
      renderApp();
    };
    if (!entry || action === 'skip') { advance(); return; }
    const today = todayISODate();
    let request;
    let counted;
    if (action === 'add' || action === 'today') {
      const time = doc.querySelector('[data-plan-time]')?.value || '';
      const fields = { plannedFor: today, ...(time ? { dueTime: time, ...(state.tasks.find(t => t.id === entry.id)?.dueDate ? {} : { dueDate: today }) } : {}) };
      request = () => updateTask(entry.id, fields);
      counted = { added: planMode.added + 1 };
    } else if (action === 'carry') {
      const tomorrow = todayISODate(new Date(Date.now() + 86_400_000));
      request = () => updateTask(entry.id, { plannedFor: tomorrow });
      counted = { carried: planMode.carried + 1 };
    } else if (action === 'reschedule') {
      const date = doc.querySelector('[data-shutdown-date]')?.value || '';
      if (!date) { showToast('Pick a reschedule date first'); return; }
      request = () => updateTask(entry.id, { dueDate: date, plannedFor: null });
      counted = { rescheduled: planMode.rescheduled + 1 };
    } else if (action === 'drop') {
      request = () => updateTask(entry.id, { plannedFor: null });
      counted = { dropped: planMode.dropped + 1 };
    } else {
      return;
    }
    planModeDecisionPending = true;
    let updated;
    try {
      updated = await request();
    } catch {
      showToast('Could not save that decision — Prax may be unreachable. The item stays here.');
      return;
    } finally {
      planModeDecisionPending = false;
    }
    // The write committed: its result is installed even when the walk moved on.
    mergePlanTask(updated);
    advance(counted);
  }

  function planModePrimaryAction() {
    const planMode = getState().planMode;
    const entry = planMode?.queue[planMode.index];
    if (!entry || !taskById(entry.id)) return null; // the summary: Enter closes
    if (planMode.mode !== 'plan') return 'carry';
    return entry.bucket === 'stale' ? 'today' : 'add';
  }

  // Plan mode / shutdown keys: Enter = primary decision, S = skip. The
  // keyboard dispatcher gives this layer every key first (also keys whose
  // target is <body>, where focus sits after a render), and a consumed key
  // reaches no later layer: the global Enter (open the selected task) must not
  // also act behind the overlay. A focused control keeps its own keys: Enter
  // on a button runs that button (Skip, Drop, Reschedule), and a time/date
  // field accepts typing and its Enter. Returns true when it consumed the key.
  function keydown(event) {
    if (!getState().planMode || event.defaultPrevented || isImeComposing(event) || event.metaKey || event.ctrlKey || event.altKey) return false;
    const target = event.target;
    if (target?.matches?.('input, select, textarea') || target?.isContentEditable) return false;
    const key = String(event.key || '');
    if (key === 'Enter') {
      if (event.repeat) { event.preventDefault(); event.stopPropagation(); return true; } // a held Enter must not walk the queue
      if (isInteractiveShortcutTarget(target)) return false;
      event.preventDefault();
      event.stopPropagation();
      const action = planModePrimaryAction();
      if (action) void planModeAct(action);
      else closePlanMode();
      return true;
    }
    if (key.toLowerCase() === 's') {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) void planModeAct('skip');
      return true;
    }
    return false;
  }

  // Every task due today that is not yet in the plan joins it.
  async function addDueTodayToPlan() {
    const state = getState();
    const today = todayISODate();
    const ids = (buildTodayGroups(state.tasks, state.projects, { now: new Date() }).groups
      .find((group) => group.key === 'today')?.tasks || []).map((task) => task.id);
    if (!ids.length) return;
    const { committed, failed } = await applyTaskPatches(ids, () => ({ plannedFor: today }));
    const refreshed = await refreshTasksAfterWrites();
    if (!committed.length) alertError('add those tasks to the plan');
    else {
      showToast(partialTaskOutcome(`${taskCountLabel(committed.length)} added to today's plan`, failed, refreshed, 'could not be added'),
        null, failed.length || !refreshed ? 7000 : undefined);
    }
    renderApp();
  }

  function checkShutdownNudge(now = new Date()) {
    const state = getState();
    if (!state.preferences?.shutdownNudge) return;
    if (now.getHours() < 17) return;
    const today = todayISODate(now);
    try {
      if (storage().getItem(SHUTDOWN_NUDGE_KEY) === today) return;
    } catch { return; }
    const openPlanned = (state.tasks || []).filter((task) => planEligible(task, now) && task.plannedFor === today).length;
    if (!openPlanned) return;
    try { storage().setItem(SHUTDOWN_NUDGE_KEY, today); } catch { /* no storage, no stamp */ }
    showToast(`${openPlanned} planned task${openPlanned === 1 ? '' : 's'} still open — shut down today from the Today view.`, null, 8000);
  }

  // data-action handlers (handleAction delegates here). Awaited handlers
  // return their promise, exactly as the former switch cases awaited them.
  const actions = {
    'plan-add-today': () => addDueTodayToPlan(),
    'open-plan-mode': () => { openPlanMode(); },
    'open-shutdown': () => { openShutdown(); },
    'close-plan-mode': (el, event) => {
      if (el.dataset.overlay === 'planmode' && event.target !== el) return; // backdrop only
      closePlanMode();
    },
    'plan-mode-add': () => planModeAct('add'),
    'plan-mode-today': () => planModeAct('today'),
    'plan-mode-drop': () => planModeAct('drop'),
    'plan-mode-skip': () => planModeAct('skip'),
    'shutdown-carry': () => planModeAct('carry'),
    'shutdown-reschedule': () => planModeAct('reschedule'),
    'shutdown-drop': () => planModeAct('drop'),
  };

  return {
    actions, keydown, buildPlanQueue, openPlanMode, openShutdown, closePlanMode, mergePlanTask,
    planModeAct, planModePrimaryAction, addDueTodayToPlan, checkShutdownNudge,
  };
}
