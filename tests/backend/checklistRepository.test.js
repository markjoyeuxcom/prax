import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeChecklistRow,
  buildListChecklist,
  buildAddChecklistItem,
  buildSetChecklistItemCompleted,
  buildDeleteChecklistItem,
} from '../../server/checklistRepository.js';

const TASK = '11111111-1111-4111-8111-111111111111';

test('normalizeChecklistRow maps db columns to API shape', () => {
  assert.deepEqual(
    normalizeChecklistRow({ id: 'a', task_id: TASK, label: 'Step 1', completed: false, sort_order: 0, created_at: 'c', updated_at: 'u' }),
    { id: 'a', taskId: TASK, label: 'Step 1', completed: false, sortOrder: 0, createdAt: 'c', updatedAt: 'u' },
  );
});

test('buildListChecklist orders by sort_order', () => {
  const q = buildListChecklist(TASK);
  assert.match(q.text, /from task_checklist_items/);
  assert.match(q.text, /where task_id = \$1/);
  assert.match(q.text, /order by sort_order/);
  assert.deepEqual(q.values, [TASK]);
});

test('buildAddChecklistItem appends with max\+1 sort_order', () => {
  const q = buildAddChecklistItem(TASK, 'New step');
  assert.match(q.text, /insert into task_checklist_items/);
  assert.match(q.text, /coalesce\(max\(sort_order\), -1\) \+ 1/);
  assert.deepEqual(q.values, [TASK, 'New step']);
});

test('buildSetChecklistItemCompleted scopes the update to task and item', () => {
  const q = buildSetChecklistItemCompleted(TASK, 'item1', true);
  assert.match(q.text, /update task_checklist_items/);
  assert.match(q.text, /set completed = \$3, updated_at = now\(\)/);
  assert.match(q.text, /where id = \$2 and task_id = \$1/);
  assert.deepEqual(q.values, [TASK, 'item1', true]);
});

test('buildDeleteChecklistItem scopes the delete to task and item', () => {
  const q = buildDeleteChecklistItem(TASK, 'item1');
  assert.match(q.text, /delete from task_checklist_items/);
  assert.match(q.text, /where id = \$2 and task_id = \$1/);
  assert.deepEqual(q.values, [TASK, 'item1']);
});
