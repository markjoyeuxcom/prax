import test from 'node:test';
import assert from 'node:assert/strict';

import { renderConfirmHtml } from '../../public/js/renderConfirm.js';

test('confirm dialog renders message, cancel, and a confirmed OK re-dispatch', () => {
  const html = renderConfirmHtml({
    message: 'Permanently delete "x"?',
    okLabel: 'Delete',
    danger: true,
    action: 'delete-archived-task',
    data: { 'task-id': 't1' },
  });
  assert.match(html, /Permanently delete &quot;x&quot;\?/);
  assert.match(html, /data-action="confirm-cancel"/);
  assert.match(html, /data-confirm-ok data-action="delete-archived-task" data-confirmed="1" data-task-id="t1"/);
  assert.match(html, /confirm__ok--danger/);
  assert.match(html, />Delete</);
  assert.equal(html.includes('data-confirm-input'), false);
});

test('confirm dialog escapes message and payload values', () => {
  const html = renderConfirmHtml({
    message: '<img src=x onerror=1>',
    action: 'noop',
    data: { 'doc-id': '"><script>' },
  });
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;img src=x onerror=1&gt;/);
});

test('optional input renders with value/placeholder and OK defaults to Confirm', () => {
  const html = renderConfirmHtml({
    message: 'Name this view',
    action: 'save-library-view',
    input: { value: 'ops + infra', placeholder: 'View name' },
  });
  assert.match(html, /data-confirm-input value="ops \+ infra" placeholder="View name"/);
  assert.match(html, />Confirm</);
  assert.equal(html.includes('confirm__ok--danger'), false);
});

test('scrim carries data-overlay so inner clicks cannot dismiss through the guard', () => {
  const html = renderConfirmHtml({ message: 'm', action: 'a' });
  assert.match(html, /data-overlay="confirm" data-action="confirm-cancel"/);
});
