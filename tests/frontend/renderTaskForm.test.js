import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTaskFormHtml } from '../../public/js/renderTaskForm.js';

test('renderTaskFormHtml renders create defaults for active context', () => {
  const html = renderTaskFormHtml({ activeContext: 'work' });

  assert.match(html, /data-modal="task-form"/);
  assert.match(html, /New Task/);
  assert.match(html, /name="priority"[\s\S]*value="medium" selected/);
  assert.match(html, /name="status"[\s\S]*value="planned" selected/);
  assert.match(html, /name="context"[\s\S]*value="work" selected/);
});

test('renderTaskFormHtml renders edit values and selected options', () => {
  const html = renderTaskFormHtml({
    task: {
      title: 'Patch NAS',
      description: 'Replace disk',
      priority: 'high',
      status: 'in-progress',
      context: 'homelab',
      dueDate: '2026-05-17',
    },
    activeContext: 'work',
  });

  assert.match(html, /Edit Task/);
  assert.match(html, /value="Patch NAS"/);
  assert.match(html, /Replace disk/);
  assert.match(html, /value="high" selected/);
  assert.match(html, /value="in-progress" selected/);
  assert.match(html, /value="homelab" selected/);
  assert.match(html, /value="2026-05-17"/);
});

test('renderTaskFormHtml escapes task values and shows errors', () => {
  const html = renderTaskFormHtml({
    task: {
      title: 'Fix <cluster>',
      description: 'Check "quoted" value',
      priority: 'low',
      status: 'notes',
      context: 'personal',
      dueDate: '',
    },
    error: 'Title is required',
  });

  assert.match(html, /Fix &lt;cluster&gt;/);
  assert.match(html, /Check &quot;quoted&quot; value/);
  assert.match(html, /Title is required/);
});

test('renderTaskFormHtml disables save button while saving', () => {
  const html = renderTaskFormHtml({ isSaving: true });

  assert.match(html, /Saving\.\.\./);
  assert.match(html, /disabled/);
});
