import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';
import { taskToGoogleEvent } from '../../server/googleCalendar.js';
import { createCalendarPusher } from '../../server/googleCalendarSync.js';
import { compileWeeklyReview } from '../../server/weeklyReview.js';

async function testApp() {
  const config = loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' });
  return buildApp({ config });
}

test('C14: taskToGoogleEvent emits next-day exclusive end date for all-day events', () => {
  const task = { id: randomUUID(), title: 'All day task', dueDate: '2026-09-04' };
  const event = taskToGoogleEvent(task);
  assert.equal(event.start.date, '2026-09-04');
  assert.equal(event.end.date, '2026-09-05', 'all-day end date must be strictly after start date');
});

test('C17: OAuth callback HTML response escapes query/provider parameters', async () => {
  const app = await testApp();
  try {
    const malicious = '<h2 id="injected">Review fixture HTML</h2>';
    const response = await app.inject({
      method: 'GET',
      url: `/api/integrations/google-calendar/callback?error=${encodeURIComponent(malicious)}`,
    });
    assert.equal(response.statusCode, 200);
    assert.ok(!response.body.includes(malicious), 'raw HTML must not be reflected');
    assert.ok(response.body.includes('&lt;h2 id=&quot;injected&quot;&gt;Review fixture HTML&lt;/h2&gt;'), 'error detail must be HTML-escaped');
  } finally {
    await app.close();
  }
});

test('C12: slow push queue drains work queued during an active push', async () => {
  const pushed = [];
  let releaseFirst = null;
  const firstBlocker = new Promise((resolve) => { releaseFirst = resolve; });
  let firstStarted = null;
  const firstStartedPromise = new Promise((resolve) => { firstStarted = resolve; });

  const client = {
    ensurePraxCalendar: async () => 'cal-1',
    upsertEvent: async (calendarId, event) => {
      pushed.push(event.id);
      if (pushed.length === 1) {
        firstStarted();
        await firstBlocker;
      }
    },
    deleteEvent: async () => {},
  };

  const id1 = randomUUID();
  const id2 = randomUUID();
  const tasks = new Map([
    [id1, { id: id1, title: 'Task 1', dueDate: '2026-09-10', status: 'planned', archivedAt: null }],
    [id2, { id: id2, title: 'Task 2', dueDate: '2026-09-11', status: 'planned', archivedAt: null }],
  ]);

  const tasksRepo = {
    getTask: async (id) => tasks.get(id),
  };

  const provider = {
    client: async () => client,
    getSettings: async () => ({ calendarId: 'cal-1', syncEnabled: true }),
    putSettings: async () => {},
  };

  const pusher = createCalendarPusher({
    provider,
    tasksRepository: tasksRepo,
    debounceMs: 5,
  });

  // Start draining task 1
  pusher.notifyTaskChanged(id1);
  // Wait until task 1 has actually entered upsertEvent
  await firstStartedPromise;
  assert.equal(pushed.length, 1);

  // Queue task 2 while task 1 is still in progress
  pusher.notifyTaskChanged(id2);

  // Release task 1 so it finishes
  releaseFirst();

  // Flush pusher and verify task 2 was not stranded
  await pusher.flush();
  assert.equal(pushed.length, 2, 'both tasks must be pushed even if queued during an in-flight push');
});

test('C13: requestId import notifies calendar reconciliation on commit but not replay', async () => {
  const app = await testApp();
  try {
    let bulkCount = 0;
    app.calendarPusher.notifyBulkChange = () => { bulkCount += 1; };

    const requestId = randomUUID();
    const payload = {
      project: 'inbox',
      mode: 'append',
      requestId,
      tasks: [{ title: 'Dated task', dueDate: '2026-10-01' }],
    };

    // First import: commit -> should notify bulk
    const first = await app.inject({
      method: 'POST',
      url: '/api/tasks/import',
      payload,
    });
    assert.equal(first.statusCode, 201);
    assert.equal(bulkCount, 1, 'first committed import must trigger calendar reconciliation');

    // Replay: should return 200 replayed, but NOT increment bulkCount
    const second = await app.inject({
      method: 'POST',
      url: '/api/tasks/import',
      payload,
    });
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().replayed, true);
    assert.equal(bulkCount, 1, 'replayed import must not trigger repeat calendar reconciliation');
  } finally {
    await app.close();
  }
});

test('C11: large task import payload (> 1MB) does not fail with HTTP 413', async () => {
  const app = await testApp();
  try {
    // Generate tasks totaling > 1.2MB
    const bigDescription = 'D'.repeat(250);
    const tasks = Array.from({ length: 5000 }, (_, i) => ({
      title: `Task ${i}`,
      description: bigDescription,
    }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks/import',
      payload: { project: 'inbox', tasks, mode: 'append' },
    });
    assert.notEqual(res.statusCode, 413, 'payload > 1MB must not fail with HTTP 413 Payload Too Large');
    assert.equal(res.statusCode, 201);
  } finally {
    await app.close();
  }
});

test('C11: staged chunked import sessions (>5000 tasks across chunks, atomic commit, replay verification, hash manifest)', async () => {
  const app = await testApp();
  try {
    const requestId = randomUUID();
    const chunk0Tasks = Array.from({ length: 3000 }, (_, i) => ({
      title: `Chunk 0 Task ${i}`,
      description: 'Desc '.repeat(20),
    }));
    const chunk1Tasks = Array.from({ length: 3000 }, (_, i) => ({
      title: `Chunk 1 Task ${i}`,
      description: 'Desc '.repeat(20),
    }));

    // 1. Create session
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/tasks/import-sessions',
      payload: { requestId, project: 'inbox', mode: 'append' },
    });
    assert.equal(createRes.statusCode, 201);
    assert.equal(createRes.json().status, 'open');

    // 2. Put chunk 0
    const put0 = await app.inject({
      method: 'PUT',
      url: `/api/tasks/import-sessions/${requestId}/chunks/0`,
      payload: { tasks: chunk0Tasks },
    });
    assert.equal(put0.statusCode, 201);
    assert.equal(put0.json().taskCount, 3000);

    // 3. Put chunk 1
    const put1 = await app.inject({
      method: 'PUT',
      url: `/api/tasks/import-sessions/${requestId}/chunks/1`,
      payload: { tasks: chunk1Tasks },
    });
    assert.equal(put1.statusCode, 201);
    assert.equal(put1.json().taskCount, 3000);

    // 4. Verify session state inspectable
    const inspect = await app.inject({
      method: 'GET',
      url: `/api/tasks/import-sessions/${requestId}`,
    });
    assert.equal(inspect.statusCode, 200);
    assert.equal(inspect.json().chunks.length, 2);

    // 5. Commit session with expected chunk count
    const commitRes = await app.inject({
      method: 'POST',
      url: `/api/tasks/import-sessions/${requestId}/commit`,
      payload: { chunkCount: 2 },
    });
    assert.equal(commitRes.statusCode, 201);
    assert.equal(commitRes.json().imported, 6000);
    assert.equal(commitRes.json().replayed, false);

    // 6. Replay chunks against committed session with identical payloads -> 200 replayed: true
    const replay0 = await app.inject({
      method: 'PUT',
      url: `/api/tasks/import-sessions/${requestId}/chunks/0`,
      payload: { tasks: chunk0Tasks },
    });
    assert.equal(replay0.statusCode, 200);
    assert.equal(replay0.json().replayed, true);

    const replay1 = await app.inject({
      method: 'PUT',
      url: `/api/tasks/import-sessions/${requestId}/chunks/1`,
      payload: { tasks: chunk1Tasks },
    });
    assert.equal(replay1.statusCode, 200);
    assert.equal(replay1.json().replayed, true);

    // 7. Replay with modified chunk against committed session -> 409 Conflict
    const conflictChunk = await app.inject({
      method: 'PUT',
      url: `/api/tasks/import-sessions/${requestId}/chunks/0`,
      payload: { tasks: [{ title: 'Different task' }] },
    });
    assert.equal(conflictChunk.statusCode, 409);

    // 8. PUT new chunk index on committed session -> 409 Conflict
    const conflictNewChunk = await app.inject({
      method: 'PUT',
      url: `/api/tasks/import-sessions/${requestId}/chunks/2`,
      payload: { tasks: [{ title: 'Extra chunk' }] },
    });
    assert.equal(conflictNewChunk.statusCode, 409);

    // 9. Replay commit with same chunkCount -> 200 replayed: true
    const replayCommit = await app.inject({
      method: 'POST',
      url: `/api/tasks/import-sessions/${requestId}/commit`,
      payload: { chunkCount: 2 },
    });
    assert.equal(replayCommit.statusCode, 200);
    assert.equal(replayCommit.json().replayed, true);
    assert.equal(replayCommit.json().imported, 6000);

    // 10. Commit with mismatched chunkCount on committed session -> 409 Conflict
    const mismatchCommit = await app.inject({
      method: 'POST',
      url: `/api/tasks/import-sessions/${requestId}/commit`,
      payload: { chunkCount: 3 },
    });
    assert.equal(mismatchCommit.statusCode, 409);

    // 11. Attempt to delete/cancel committed session -> 409 Conflict, receipts preserved
    const cancelCommitted = await app.inject({
      method: 'DELETE',
      url: `/api/tasks/import-sessions/${requestId}`,
    });
    assert.equal(cancelCommitted.statusCode, 409);

    // Verify session still committed and receipt still retrievable
    const inspectAfterCancel = await app.inject({
      method: 'GET',
      url: `/api/tasks/import-sessions/${requestId}`,
    });
    assert.equal(inspectAfterCancel.statusCode, 200);
    assert.equal(inspectAfterCancel.json().status, 'committed');

    // 12. Total imported tasks in inbox equals 6000
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/tasks?project=inbox',
    });
    assert.equal(listRes.statusCode, 200);
    assert.equal(listRes.json().length, 6000);

    // 13. Lost-commit full retry scenario: client retries from POST session through all chunks to commit
    const retrySessionRes = await app.inject({
      method: 'POST',
      url: '/api/tasks/import-sessions',
      payload: { requestId, project: 'inbox', mode: 'append' },
    });
    assert.equal(retrySessionRes.statusCode, 200);
    assert.equal(retrySessionRes.json().replayed, true);
    assert.equal(retrySessionRes.json().status, 'committed');

    // Mismatched project on committed session retry -> 409 Conflict
    const badProjectRetry = await app.inject({
      method: 'POST',
      url: '/api/tasks/import-sessions',
      payload: { requestId, project: 'work', mode: 'append' },
    });
    assert.equal(badProjectRetry.statusCode, 409);

    // Replay chunk 0 and 1
    const replayChunk0 = await app.inject({
      method: 'PUT',
      url: `/api/tasks/import-sessions/${requestId}/chunks/0`,
      payload: { tasks: chunk0Tasks },
    });
    assert.equal(replayChunk0.statusCode, 200);
    assert.equal(replayChunk0.json().replayed, true);

    const replayChunk1 = await app.inject({
      method: 'PUT',
      url: `/api/tasks/import-sessions/${requestId}/chunks/1`,
      payload: { tasks: chunk1Tasks },
    });
    assert.equal(replayChunk1.statusCode, 200);
    assert.equal(replayChunk1.json().replayed, true);

    // Replay commit
    const lostCommitRetry = await app.inject({
      method: 'POST',
      url: `/api/tasks/import-sessions/${requestId}/commit`,
      payload: { chunkCount: 2 },
    });
    assert.equal(lostCommitRetry.statusCode, 200);
    assert.equal(lostCommitRetry.json().replayed, true);
    assert.equal(lostCommitRetry.json().imported, 6000);

    // Verify inbox still has exactly 6000 tasks (no duplication)
    const listAfterRetry = await app.inject({
      method: 'GET',
      url: '/api/tasks?project=inbox',
    });
    assert.equal(listAfterRetry.json().length, 6000);

    // 14. Export roundtrip: export 6000 tasks and re-import via chunked session with 200-task chunks
    const exportRes = await app.inject({
      method: 'GET',
      url: '/api/tasks/export?project=inbox',
    });
    assert.equal(exportRes.statusCode, 200);
    const exportedPayload = exportRes.json();
    assert.equal(exportedPayload.format, 'moomora.tasks');
    assert.equal(exportedPayload.version, 1);
    assert.equal(exportedPayload.tasks.length, 6000);

    const roundtripRequestId = randomUUID();
    const roundtripSessionRes = await app.inject({
      method: 'POST',
      url: '/api/tasks/import-sessions',
      payload: {
        requestId: roundtripRequestId,
        project: 'inbox',
        mode: 'replace',
        format: exportedPayload.format,
        version: exportedPayload.version,
      },
    });
    assert.equal(roundtripSessionRes.statusCode, 201);

    // Chunk exported tasks into 30 chunks of 200 tasks
    const chunkSize = 200;
    const totalChunks = exportedPayload.tasks.length / chunkSize;
    for (let c = 0; c < totalChunks; c += 1) {
      const chunkTasks = exportedPayload.tasks.slice(c * chunkSize, (c + 1) * chunkSize);
      const putChunk = await app.inject({
        method: 'PUT',
        url: `/api/tasks/import-sessions/${roundtripRequestId}/chunks/${c}`,
        payload: {
          tasks: chunkTasks,
          format: exportedPayload.format,
          version: exportedPayload.version,
        },
      });
      assert.equal(putChunk.statusCode, 201);
      assert.equal(putChunk.json().taskCount, 200);
    }

    const roundtripCommit = await app.inject({
      method: 'POST',
      url: `/api/tasks/import-sessions/${roundtripRequestId}/commit`,
      payload: {
        chunkCount: totalChunks,
        format: exportedPayload.format,
        version: exportedPayload.version,
      },
    });
    assert.equal(roundtripCommit.statusCode, 201);
    assert.equal(roundtripCommit.json().imported, 6000);

    const roundtripVerify = await app.inject({
      method: 'GET',
      url: '/api/tasks?project=inbox',
    });
    assert.equal(roundtripVerify.json().length, 6000);
  } finally {
    await app.close();
  }
});

test('C11: staged import error cases (gap rejection, open conflict, open cancellation)', async () => {
  const app = await testApp();
  try {
    // Gap rejection: upload chunk 0 and chunk 2, commit expecting 3 chunks
    const gapId = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/api/tasks/import-sessions',
      payload: { requestId: gapId, project: 'inbox', mode: 'append' },
    });
    await app.inject({
      method: 'PUT',
      url: `/api/tasks/import-sessions/${gapId}/chunks/0`,
      payload: { tasks: [{ title: 'Task 0' }] },
    });
    // Missing chunk 1, uploading chunk 2
    await app.inject({
      method: 'PUT',
      url: `/api/tasks/import-sessions/${gapId}/chunks/2`,
      payload: { tasks: [{ title: 'Task 2' }] },
    });
    const gapCommit = await app.inject({
      method: 'POST',
      url: `/api/tasks/import-sessions/${gapId}/commit`,
      payload: { chunkCount: 3 },
    });
    assert.equal(gapCommit.statusCode, 400);
    assert.match(gapCommit.json().message, /expected 3 chunks but received 2|missing chunk index/);

    // Open session changed chunk conflict
    const openConflictId = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/api/tasks/import-sessions',
      payload: { requestId: openConflictId, project: 'inbox', mode: 'append' },
    });
    await app.inject({
      method: 'PUT',
      url: `/api/tasks/import-sessions/${openConflictId}/chunks/0`,
      payload: { tasks: [{ title: 'Original Task' }] },
    });
    const changeRetry = await app.inject({
      method: 'PUT',
      url: `/api/tasks/import-sessions/${openConflictId}/chunks/0`,
      payload: { tasks: [{ title: 'Modified Task' }] },
    });
    assert.equal(changeRetry.statusCode, 409);

    // Open session cancellation
    const cancelId = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/api/tasks/import-sessions',
      payload: { requestId: cancelId, project: 'inbox', mode: 'append' },
    });
    await app.inject({
      method: 'PUT',
      url: `/api/tasks/import-sessions/${cancelId}/chunks/0`,
      payload: { tasks: [{ title: 'Task to cancel' }] },
    });
    const cancelRes = await app.inject({
      method: 'DELETE',
      url: `/api/tasks/import-sessions/${cancelId}`,
    });
    assert.equal(cancelRes.statusCode, 200);

    // Subsequent chunk PUT on cancelled session -> 409
    const postCancelPut = await app.inject({
      method: 'PUT',
      url: `/api/tasks/import-sessions/${cancelId}/chunks/0`,
      payload: { tasks: [{ title: 'After cancel' }] },
    });
    assert.equal(postCancelPut.statusCode, 409);
  } finally {
    await app.close();
  }
});

test('C18: weekly review shipped ignores notes-edit timestamp of old completed tasks', () => {
  const weekStart = '2026-08-31';
  const now = new Date('2026-09-04T12:00:00Z');

  // Task completed last year, notes edited this week
  const oldCompletedTask = {
    id: 'old-completed',
    title: 'Old task completed last year',
    status: 'completed',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2026-09-02T10:00:00Z',
  };

  // Task completed this week
  const newCompletedTask = {
    id: 'new-completed',
    title: 'New task completed this week',
    status: 'completed',
    createdAt: '2026-08-20T00:00:00Z',
    updatedAt: '2026-09-02T10:00:00Z',
  };

  const activity = [
    { taskId: 'new-completed', eventType: 'status', message: 'Status → completed', createdAt: '2026-09-02T10:00:00Z' },
  ];

  const review = compileWeeklyReview({
    weekStart,
    now,
    tasks: [oldCompletedTask, newCompletedTask],
    activity,
  });

  assert.equal(review.stats.shipped, 1, 'only the task with a completion event this week should be counted as shipped');
  assert.ok(!review.markdown.includes('Old task completed last year'));
  assert.ok(review.markdown.includes('New task completed this week'));
});

test('C18 follow-up: reopened task does not erase historical shipped work', () => {
  const weekStart = '2026-08-31';
  const now = new Date('2026-09-04T12:00:00Z');

  // Task that was completed on Sep 2, but subsequently reopened (currently status: 'planned')
  const reopenedTask = {
    id: 'reopened-task',
    title: 'Completed on Sep 2 then reopened',
    status: 'planned',
    createdAt: '2026-08-20T00:00:00Z',
    updatedAt: '2026-09-03T10:00:00Z',
  };

  const activity = [
    { taskId: 'reopened-task', eventType: 'status', message: 'Status changed to completed', createdAt: '2026-09-02T10:00:00Z' },
  ];

  const review = compileWeeklyReview({
    weekStart,
    now,
    tasks: [reopenedTask],
    activity,
  });

  assert.equal(review.stats.shipped, 1, 'reopening a task must not erase historical shipped work');
  assert.ok(review.markdown.includes('Completed on Sep 2 then reopened'));
});

test('C18 follow-up: completed task with week-createdAt and no events yields 0 shipped with unrecorded date disclosed', () => {
  const weekStart = '2026-08-31';
  const now = new Date('2026-09-04T12:00:00Z');

  // Completed task created this week, but with NO completion events in activity and no completedAt
  const taskNoEvents = {
    id: 'no-events-task',
    title: 'Completed with no event evidence',
    status: 'completed',
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-01T10:00:00Z',
  };

  const review = compileWeeklyReview({
    weekStart,
    now,
    tasks: [taskNoEvents],
    activity: [],
  });

  assert.equal(review.stats.shipped, 0, 'completed task without event evidence must not guess completion from createdAt');
  assert.match(review.markdown, /Nothing shipped this week\./);
  assert.match(review.markdown, /unrecorded completion date omitted/);
});

test('L1: task search treats % and _ as literal characters', async () => {
  const app = await testApp();
  try {
    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { title: 'Target 100% complete', project: 'inbox', priority: 'medium', status: 'planned' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { title: 'Target 1000 complete', project: 'inbox', priority: 'medium', status: 'planned' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { title: 'Task_1 special', project: 'inbox', priority: 'medium', status: 'planned' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { title: 'Task-1 other', project: 'inbox', priority: 'medium', status: 'planned' },
    });

    // Search for literal '100%'
    const resPercent = await app.inject({
      method: 'GET',
      url: '/api/tasks?q=100%25',
    });
    assert.equal(resPercent.statusCode, 200);
    const titlesPercent = resPercent.json().map((t) => t.title);
    assert.deepEqual(titlesPercent, ['Target 100% complete'], '% must match literally, not as wildcard');

    // Search for literal 'Task_1'
    const resUnderscore = await app.inject({
      method: 'GET',
      url: '/api/tasks?q=Task_1',
    });
    assert.equal(resUnderscore.statusCode, 200);
    const titlesUnderscore = resUnderscore.json().map((t) => t.title);
    assert.deepEqual(titlesUnderscore, ['Task_1 special'], '_ must match literally, not as single-char wildcard');
  } finally {
    await app.close();
  }
});

test('L2: strict and normalized timestamp contract', async () => {
  const app = await testApp();
  try {
    // Loose non-ISO timestamps in import must be rejected with 400
    const resBadArchived = await app.inject({
      method: 'POST',
      url: '/api/tasks/import',
      payload: { project: 'inbox', tasks: [{ title: 'Task A', archivedAt: '1' }] },
    });
    assert.equal(resBadArchived.statusCode, 400);
    assert.match(resBadArchived.json().message, /archivedAt is invalid/);

    const resBadDeferred = await app.inject({
      method: 'POST',
      url: '/api/tasks/import',
      payload: { project: 'inbox', tasks: [{ title: 'Task B', deferredUntil: '2024' }] },
    });
    assert.equal(resBadDeferred.statusCode, 400);
    assert.match(resBadDeferred.json().message, /deferredUntil is invalid/);

    // Loose non-ISO timestamp in PATCH must be rejected with 400
    const created = (await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { title: 'Task C', project: 'inbox', priority: 'medium', status: 'planned' },
    })).json();

    const patchBad = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${created.id}`,
      payload: { deferredUntil: '2024' },
    });
    assert.equal(patchBad.statusCode, 400);
    assert.match(patchBad.json().message, /deferredUntil is invalid/);

    // Valid ISO timestamps must be accepted and normalized
    const validIso = '2026-07-20T09:00:00Z';
    const patchGood = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${created.id}`,
      payload: { deferredUntil: validIso },
    });
    assert.equal(patchGood.statusCode, 200);
    assert.equal(patchGood.json().deferredUntil, '2026-07-20T09:00:00.000Z');
  } finally {
    await app.close();
  }
});

test('C11/requestId collision: createImportSession rejects direct import requestId with 409 and direct import rejects staged session requestId (open, cancelled, committed)', async () => {
  const app = await testApp();
  try {
    // 1. Direct import requestId must not be accepted by createImportSession
    const directId = randomUUID();
    const directRes = await app.inject({
      method: 'POST',
      url: '/api/tasks/import',
      payload: { requestId: directId, project: 'inbox', tasks: [{ title: 'Direct import task' }] },
    });
    assert.equal(directRes.statusCode, 201);

    const stagedCollisionRes = await app.inject({
      method: 'POST',
      url: '/api/tasks/import-sessions',
      payload: { requestId: directId, project: 'inbox', mode: 'append' },
    });
    assert.equal(stagedCollisionRes.statusCode, 409, 'createImportSession must return 409 rather than claiming direct receipt committed');
    assert.match(stagedCollisionRes.json().message, /already used for a direct task import/);

    // 2. Open staged session requestId must be rejected by direct import
    const openSessionId = randomUUID();
    const openSessionRes = await app.inject({
      method: 'POST',
      url: '/api/tasks/import-sessions',
      payload: { requestId: openSessionId, project: 'inbox', mode: 'append' },
    });
    assert.equal(openSessionRes.statusCode, 201);

    const directOnOpenRes = await app.inject({
      method: 'POST',
      url: '/api/tasks/import-sessions',
      payload: { requestId: openSessionId, project: 'inbox', mode: 'append' },
    });
    // Replay on open session is 200 exists: true
    assert.equal(directOnOpenRes.statusCode, 200);

    const directAttemptOnOpen = await app.inject({
      method: 'POST',
      url: '/api/tasks/import',
      payload: { requestId: openSessionId, project: 'inbox', tasks: [{ title: 'Colliding direct task' }] },
    });
    assert.equal(directAttemptOnOpen.statusCode, 409, 'direct import must reject requestId reserved by open staged session');
    assert.match(directAttemptOnOpen.json().message, /reserved by a staged import session/);

    // Staged session can upload chunks and commit without hitting a late receipt failure
    const chunkRes = await app.inject({
      method: 'PUT',
      url: `/api/tasks/import-sessions/${openSessionId}/chunks/0`,
      payload: { tasks: [{ title: 'Staged task 1' }] },
    });
    assert.equal(chunkRes.statusCode, 201);

    const commitRes = await app.inject({
      method: 'POST',
      url: `/api/tasks/import-sessions/${openSessionId}/commit`,
      payload: { chunkCount: 1 },
    });
    assert.equal(commitRes.statusCode, 201, 'staged session commits cleanly after direct collision rejected');

    // 3. Cancelled staged session requestId must be rejected by direct import
    const cancelledSessionId = randomUUID();
    const createCancelledSession = await app.inject({
      method: 'POST',
      url: '/api/tasks/import-sessions',
      payload: { requestId: cancelledSessionId, project: 'inbox', mode: 'append' },
    });
    assert.equal(createCancelledSession.statusCode, 201);

    const cancelRes = await app.inject({
      method: 'DELETE',
      url: `/api/tasks/import-sessions/${cancelledSessionId}`,
    });
    assert.equal(cancelRes.statusCode, 200);

    const directAttemptOnCancelled = await app.inject({
      method: 'POST',
      url: '/api/tasks/import',
      payload: { requestId: cancelledSessionId, project: 'inbox', tasks: [{ title: 'Direct task on cancelled' }] },
    });
    assert.equal(directAttemptOnCancelled.statusCode, 409, 'direct import must reject requestId reserved by cancelled staged session');
    assert.match(directAttemptOnCancelled.json().message, /reserved by a staged import session/);

    // 4. Committed staged session requestId must also be rejected by direct import
    const directAttemptOnCommitted = await app.inject({
      method: 'POST',
      url: '/api/tasks/import',
      payload: { requestId: openSessionId, project: 'inbox', tasks: [{ title: 'Direct task on committed' }] },
    });
    assert.equal(directAttemptOnCommitted.statusCode, 409, 'direct import must reject requestId reserved by committed staged session');
    assert.match(directAttemptOnCommitted.json().message, /reserved by a staged import session/);
  } finally {
    await app.close();
  }
});
