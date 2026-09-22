// Incremental Google Calendar push + reconcile sweep (Phase 2).
//
// Task routes notify the pusher AFTER a mutation commits; the push itself is
// debounced, coalesced, and fully detached from the request — a Google
// failure can never fail or slow a task operation, it only marks the
// integration status degraded (repaired by the next push or the sweep).
//
// Per queued task the decision is total: eligible (open + dated) -> upsert
// its event; anything else — completed, snoozed, archived, deleted, undated
// — -> delete its event by the derived stable id. A BURST (import, replace)
// collapses into one full reconcile instead of hammering per-task calls.
import { isCalendarEligible } from './icsFeed.js';
import { GoogleApiError, googleEventId, planCalendarSync, taskToGoogleEvent } from './googleCalendar.js';

const DEFAULT_DEBOUNCE_MS = 2000;
const DEFAULT_BURST_THRESHOLD = 25;
const DEFAULT_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

// One full reconcile: push every eligible task, remove every stale event.
// Shared by the Sync-now route, the burst path, and the periodic sweep, all
// of which run it inside the pusher's serial queue. A clean run clears any
// earlier live-push error: everything is in step again.
export async function runFullSync({ provider, tasksRepository }) {
  const client = await provider.client();
  const settings = await provider.getSettings();
  const calendarId = await client.ensurePraxCalendar(settings.calendarId || null);
  if (calendarId !== settings.calendarId) await provider.putSettings({ calendarId }, { onlyIfConnected: true });

  const now = new Date();
  const tasks = (await tasksRepository.listTasks({})).filter((task) => isCalendarEligible(task, now));
  const existing = await client.listEventIds(calendarId);
  const plan = planCalendarSync(tasks, existing);

  let pushed = 0;
  let removed = 0;
  const failures = [];
  for (const task of plan.upserts) {
    try {
      await client.upsertEvent(calendarId, taskToGoogleEvent(task));
      pushed += 1;
    } catch (err) {
      failures.push({ taskId: task.id, title: task.title, message: err.message });
    }
  }
  for (const eventId of plan.deletes) {
    try {
      await client.deleteEvent(calendarId, eventId);
      removed += 1;
    } catch (err) {
      failures.push({ eventId, message: err.message });
    }
  }

  const summary = failures.length
    ? `${pushed} pushed, ${removed} removed, ${failures.length} FAILED`
    : `${pushed} pushed, ${removed} removed`;
  await provider.putSettings({
    lastSyncAt: new Date().toISOString(),
    lastSyncSummary: summary,
    ...(failures.length ? {} : { lastPushError: null }),
  }, { onlyIfConnected: true });
  return { pushed, removed, failed: failures.length, failures, summary };
}

export function createCalendarPusher({
  provider,
  tasksRepository,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  burstThreshold = DEFAULT_BURST_THRESHOLD,
  sweepIntervalMs = DEFAULT_SWEEP_INTERVAL_MS,
} = {}) {
  const pending = new Set();
  let bulkRequested = false;
  let timer = null;
  let sweepTimer = null;
  let draining = null;
  let stopped = false;
  // Every Google write batch (incremental drain, burst/sweep reconcile, and
  // the manual Sync now) runs through this queue, one at a time.
  let queue = Promise.resolve();
  function exclusive(work) {
    const run = queue.then(work);
    queue = run.catch(() => {});
    return run;
  }

  async function connectedOrNull() {
    try {
      return await provider.client();
    } catch (err) {
      // Not configured / not connected is normal — drop the queue silently.
      // Anything else (bad token) is worth surfacing as push status.
      if (err instanceof GoogleApiError && ['not-configured', 'not-connected'].includes(err.reason)) return null;
      await provider.putSettings({ lastPushError: err.message }, { onlyIfConnected: true }).catch(() => {});
      return null;
    }
  }

  async function drainNow() {
    const ids = [...pending];
    const bulk = bulkRequested || ids.length > burstThreshold;
    pending.clear();
    bulkRequested = false;
    if (!ids.length && !bulk) return { pushed: 0, removed: 0, failed: 0 };

    const client = await connectedOrNull();
    if (!client) return { pushed: 0, removed: 0, failed: 0, skipped: true };

    try {
      if (bulk) {
        const result = await runFullSync({ provider, tasksRepository });
        await provider.putSettings({
          lastPushAt: new Date().toISOString(),
          lastPushError: result.failed ? result.summary : null,
        }, { onlyIfConnected: true });
        return result;
      }

      const settings = await provider.getSettings();
      const calendarId = await client.ensurePraxCalendar(settings.calendarId || null);
      if (calendarId !== settings.calendarId) await provider.putSettings({ calendarId }, { onlyIfConnected: true });

      const now = new Date();
      let pushed = 0;
      let removed = 0;
      const failures = [];
      for (const id of ids) {
        try {
          const task = tasksRepository.getTask ? await tasksRepository.getTask(id) : null;
          if (task && !task.archivedAt && isCalendarEligible(task, now)) {
            await client.upsertEvent(calendarId, taskToGoogleEvent(task));
            pushed += 1;
          } else {
            await client.deleteEvent(calendarId, googleEventId(id));
            removed += 1;
          }
        } catch (err) {
          failures.push({ taskId: id, message: err.message });
        }
      }
      await provider.putSettings({
        lastPushAt: new Date().toISOString(),
        lastPushError: failures.length ? `${failures.length} push${failures.length === 1 ? '' : 'es'} failed: ${failures[0].message}` : null,
      }, { onlyIfConnected: true });
      return { pushed, removed, failed: failures.length, failures };
    } catch (err) {
      // Queue-level failure (calendar lookup, settings write): record and let
      // the sweep repair; the mutation that queued us already succeeded.
      await provider.putSettings({ lastPushError: err.message }, { onlyIfConnected: true }).catch(() => {});
      return { pushed: 0, removed: 0, failed: 1, failures: [{ message: err.message }] };
    }
  }

  function drain() {
    if (draining) return draining;
    draining = (async () => {
      let cumulative = { pushed: 0, removed: 0, failed: 0, failures: [] };
      let executed = false;
      while (pending.size > 0 || bulkRequested) {
        executed = true;
        const res = await exclusive(drainNow);
        if (res) {
          cumulative.pushed += res.pushed || 0;
          cumulative.removed += res.removed || 0;
          cumulative.failed += res.failed || 0;
          if (Array.isArray(res.failures)) cumulative.failures.push(...res.failures);
          if (res.skipped) cumulative.skipped = true;
        }
      }
      if (!executed) {
        return exclusive(drainNow);
      }
      return cumulative;
    })().finally(() => {
      draining = null;
    });
    return draining;
  }

  return {
    // Fire-and-forget from the task routes: never throws, never blocks.
    notifyTaskChanged(taskIds) {
      if (stopped) return;
      for (const id of Array.isArray(taskIds) ? taskIds : [taskIds]) {
        if (id) pending.add(String(id));
      }
      clearTimeout(timer);
      timer = setTimeout(() => { drain().catch(() => {}); }, debounceMs);
      timer.unref?.();
    },
    // Imports/replaces touch too many rows for per-task calls — one reconcile.
    notifyBulkChange() {
      if (stopped) return;
      bulkRequested = true;
      clearTimeout(timer);
      timer = setTimeout(() => { drain().catch(() => {}); }, debounceMs);
      timer.unref?.();
    },
    // Manual Sync now: one full reconcile in the serial queue. Changes queued
    // meanwhile drain after it, so they win over the reconcile's snapshot.
    // Errors propagate so the route can report a degraded reason.
    syncNow() {
      return exclusive(() => runFullSync({ provider, tasksRepository }));
    },
    // Deterministic drain for tests.
    async flush() {
      clearTimeout(timer);
      let lastResult = null;
      if (draining) lastResult = await draining;
      while (pending.size > 0 || bulkRequested) {
        lastResult = await drain();
      }
      return lastResult || drain();
    },
    startSweep() {
      if (stopped || sweepTimer) return;
      sweepTimer = setInterval(() => {
        bulkRequested = true;
        drain().catch(() => {});
      }, sweepIntervalMs);
      sweepTimer.unref?.();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      clearInterval(sweepTimer);
      sweepTimer = null;
    },
  };
}
