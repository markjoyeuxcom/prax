import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../server/index.js';

const TASK = '11111111-1111-4111-8111-111111111111';
function fakeChecklistRepo() {
  let items = [];
  return {
    async listChecklist() { return items; },
    async addChecklistItem(taskId, label) { const it = { id: randomUUID(), taskId, label, completed: false, sortOrder: items.length }; items.push(it); return it; },
    async addChecklistItemIdempotent(taskId, label, id) {
      const existing = items.find(item => item.id === id);
      if (existing) return { item: existing, created: false };
      const item = { id, taskId, label, completed: false, sortOrder: items.length };
      items.push(item);
      return { item, created: true };
    },
    async setChecklistItemCompleted(taskId, id, completed) { const it = items.find(x => x.id === id && x.taskId === taskId); if (!it) return null; it.completed = completed; return it; },
    async deleteChecklistItem(taskId, id) { const i = items.findIndex(x => x.id === id && x.taskId === taskId); if (i < 0) return null; return items.splice(i, 1)[0]; },
    _items: () => items,
  };
}
async function appWith(repo, tasksRepository = { async getTask(id) { return { id, archivedAt: null }; } }) { return buildApp({ skipDb: true, checklistRepository: repo, tasksRepository, libraryRepository: {}, projectsRepository: {} }); }

test('POST /api/tasks/:id/checklist rejects a blank label', async () => {
  const app = await appWith(fakeChecklistRepo());
  const res = await app.inject({ method: 'POST', url: `/api/tasks/${TASK}/checklist`, payload: { label: '  ' } });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test('POST /api/tasks/:id/checklist returns 404 when the task is missing', async () => {
  const app = await appWith(fakeChecklistRepo(), { async getTask() { return null; } });
  const res = await app.inject({ method: 'POST', url: `/api/tasks/${TASK}/checklist`, payload: { label: 'Step 1' } });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().message, 'task not found');
  await app.close();
});

test('checklist add/list/toggle/delete round-trip', async () => {
  const app = await appWith(fakeChecklistRepo());
  const add = await app.inject({ method: 'POST', url: `/api/tasks/${TASK}/checklist`, payload: { label: 'Step 1' } });
  assert.equal(add.statusCode, 201);
  const itemId = add.json().id;
  const list = await app.inject({ method: 'GET', url: `/api/tasks/${TASK}/checklist` });
  assert.equal(list.json().length, 1);
  const patch = await app.inject({ method: 'PATCH', url: `/api/tasks/${TASK}/checklist/${itemId}`, payload: { completed: true } });
  assert.equal(patch.json().completed, true);
  const del = await app.inject({ method: 'DELETE', url: `/api/tasks/${TASK}/checklist/${itemId}` });
  assert.equal(del.statusCode, 204);
  const listAfter = await app.inject({ method: 'GET', url: `/api/tasks/${TASK}/checklist` });
  assert.equal(listAfter.json().length, 0);
  await app.close();
});

test('checklist creation replays one caller id and rejects conflicting reuse', async () => {
  const app = await appWith(fakeChecklistRepo());
  const itemId = randomUUID();
  const first = await app.inject({ method: 'POST', url: `/api/tasks/${TASK}/checklist`, payload: { id: itemId, label: 'Step 1' } });
  assert.equal(first.statusCode, 201);
  const replay = await app.inject({ method: 'POST', url: `/api/tasks/${TASK}/checklist`, payload: { id: itemId, label: 'Step 1' } });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().id, itemId);
  const conflict = await app.inject({ method: 'POST', url: `/api/tasks/${TASK}/checklist`, payload: { id: itemId, label: 'Different' } });
  assert.equal(conflict.statusCode, 409);
  await app.close();
});

test('GET /api/tasks/:id/checklist rejects an invalid task id', async () => {
  const app = await appWith(fakeChecklistRepo());
  const res = await app.inject({ method: 'GET', url: '/api/tasks/not-a-uuid/checklist' });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test('PATCH returns 404 for an unknown checklist item', async () => {
  const app = await appWith(fakeChecklistRepo());
  const res = await app.inject({ method: 'PATCH', url: `/api/tasks/${TASK}/checklist/${randomUUID()}`, payload: { completed: true } });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test('DELETE is idempotent for an unknown item on an existing task', async () => {
  const app = await appWith(fakeChecklistRepo());
  const res = await app.inject({ method: 'DELETE', url: `/api/tasks/${TASK}/checklist/${randomUUID()}` });
  assert.equal(res.statusCode, 204);
  await app.close();
});

test('PATCH rejects a different-task item while DELETE enforces desired absence', async () => {
  const OTHER_TASK = '22222222-2222-4222-8222-222222222222';
  const app = await appWith(fakeChecklistRepo());
  const add = await app.inject({ method: 'POST', url: `/api/tasks/${TASK}/checklist`, payload: { label: 'Step 1' } });
  const itemId = add.json().id;

  const patch = await app.inject({ method: 'PATCH', url: `/api/tasks/${OTHER_TASK}/checklist/${itemId}`, payload: { completed: true } });
  assert.equal(patch.statusCode, 404);

  const del = await app.inject({ method: 'DELETE', url: `/api/tasks/${OTHER_TASK}/checklist/${itemId}` });
  assert.equal(del.statusCode, 204);

  // The item is untouched under its real task.
  const list = await app.inject({ method: 'GET', url: `/api/tasks/${TASK}/checklist` });
  assert.equal(list.json().length, 1);
  assert.equal(list.json()[0].completed, false);
  await app.close();
});

test('GET and idempotent DELETE still return 404 for a missing owner task', async () => {
  const app = await appWith(fakeChecklistRepo(), { async getTask() { return null; } });
  assert.equal((await app.inject({ method: 'GET', url: `/api/tasks/${TASK}/checklist` })).statusCode, 404);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/tasks/${TASK}/checklist/${randomUUID()}` })).statusCode, 404);
  await app.close();
});
