import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTaskFormHtml } from '../../public/js/renderTaskForm.js';

const TEST_PROJECTS = [
  { id: 'p1', name: 'Homelab', slug: 'homelab', status: 'active' },
  { id: 'p2', name: 'Work', slug: 'work', status: 'active' },
];

test('renderTaskFormHtml renders create defaults for active project', () => {
  const html = renderTaskFormHtml({
    projects: TEST_PROJECTS,
    values: { project: 'p2' },
  });

  assert.match(html, /data-modal="task-form"/);
  assert.match(html, /new task/);
  assert.match(html, /name="priority"[\s\S]*value="medium" selected/);
  assert.match(html, /name="status"[\s\S]*value="planned" selected/);
  assert.match(html, /name="project"[\s\S]*value="p2" selected/);
  assert.match(html, /<option value="p1"[^>]*>Homelab<\/option>/);
  assert.match(html, /<option value="p2"[^>]*>Work<\/option>/);
  assert.doesNotMatch(html, /name="context"/);
});

test('renderTaskFormHtml renders edit values and selected options', () => {
  const html = renderTaskFormHtml({
    task: {
      title: 'Patch NAS',
      description: 'Replace disk',
      priority: 'high',
      status: 'in-progress',
      dueDate: '2026-05-17',
    },
    projects: TEST_PROJECTS,
    values: { project: 'p1' },
  });

  assert.match(html, /edit task/);
  assert.match(html, /value="Patch NAS"/);
  assert.match(html, /Replace disk/);
  assert.match(html, /value="high" selected/);
  assert.match(html, /value="in-progress" selected/);
  assert.match(html, /name="project"[\s\S]*value="p1" selected/);
  assert.match(html, /value="2026-05-17"/);
});

test('renderTaskFormHtml falls back to the task project when no override is given', () => {
  const html = renderTaskFormHtml({
    task: {
      title: 'Patch NAS',
      priority: 'high',
      status: 'in-progress',
      projectId: 'p2',
    },
    projects: TEST_PROJECTS,
  });

  assert.match(html, /name="project"[\s\S]*value="p2" selected/);
});

test('renderTaskFormHtml escapes task values and shows errors', () => {
  const html = renderTaskFormHtml({
    task: {
      title: 'Fix <cluster>',
      description: 'Check "quoted" value',
      priority: 'low',
      status: 'notes',
      dueDate: '',
    },
    projects: TEST_PROJECTS,
    values: { project: 'p1' },
    error: 'Title is required',
  });

  assert.match(html, /Fix &lt;cluster&gt;/);
  assert.match(html, /Check &quot;quoted&quot; value/);
  assert.match(html, /Title is required/);
});

test('renderTaskFormHtml disables save button while saving', () => {
  const html = renderTaskFormHtml({ isSaving: true });

  assert.match(html, /\[s\] saving\.\.\./);
  assert.match(html, /disabled/);
});

test('form renders bracketed save button and quiet cancel', () => {
  const html = renderTaskFormHtml({ task: null, projects: TEST_PROJECTS, error: '', isSaving: false });
  assert.match(html, /data-action="close-task-form"[^>]*>cancel/);
  assert.match(html, /type="submit"[^>]*>\[s\] save/);
});

test('form save button disabled while saving', () => {
  const html = renderTaskFormHtml({ task: null, projects: TEST_PROJECTS, error: '', isSaving: true });
  assert.match(html, /type="submit"[^>]* disabled[^>]*>\[s\] saving\.\.\./);
});

test('task form renders both desktop and mobile modal headers', () => {
  const html = renderTaskFormHtml({ task: null, projects: TEST_PROJECTS, error: '', isSaving: false });
  assert.match(html, /class="modal-header--desktop"/);
  assert.match(html, /class="modal-header--mobile"/);
  assert.match(html, /<button[^>]*type="submit"[^>]*form="task-form"[^>]*>\[s\] save/);
});
