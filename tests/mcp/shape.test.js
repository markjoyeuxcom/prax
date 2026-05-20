import test from 'node:test';
import assert from 'node:assert/strict';
import { snippet, toDocumentRef, toTaskRef, capResults } from '../../mcp/shape.js';

test('snippet collapses whitespace and truncates to max length', () => {
  const body = 'line one\n\n   line two   with   spaces';
  assert.equal(snippet(body, 12), 'line one lin');
  assert.equal(snippet('', 200), '');
  assert.equal(snippet(undefined, 200), '');
});

test('toDocumentRef drops the body and adds a snippet', () => {
  const doc = {
    id: 'd1', title: 'Runbook', body: 'full body text here',
    documentType: 'runbook', context: 'homelab', tags: ['k8s'], extra: 'ignored',
  };
  const ref = toDocumentRef(doc);
  assert.deepEqual(ref, {
    id: 'd1', title: 'Runbook', documentType: 'runbook',
    context: 'homelab', tags: ['k8s'], snippet: 'full body text here',
  });
  assert.equal('body' in ref, false);
});

test('toTaskRef keeps summary fields only', () => {
  const task = {
    id: 't1', title: 'Backup', description: 'long', status: 'planned',
    priority: 'high', context: 'homelab', dueDate: '2026-05-12', sortOrder: 3,
  };
  assert.deepEqual(toTaskRef(task), {
    id: 't1', title: 'Backup', status: 'planned',
    priority: 'high', context: 'homelab', dueDate: '2026-05-12',
  });
});

test('capResults limits array length', () => {
  const arr = Array.from({ length: 30 }, (_, i) => i);
  assert.equal(capResults(arr).length, 20);
  assert.equal(capResults(arr, 5).length, 5);
  assert.deepEqual(capResults([1, 2], 20), [1, 2]);
});
