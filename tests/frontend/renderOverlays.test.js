import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCaptureHtml } from '../../public/js/renderCapture.js';
import { renderToastHtml } from '../../public/js/renderToast.js';

// ---- Quick capture ----------------------------------------------------------

test('capture renders the overlay, input with current value and the ↵ hint', () => {
  const html = renderCaptureHtml({ captureQuery: 'Rotate certs' }, { id: 'p1', name: 'Homelab', color: '#3aa17e' });
  assert.match(html, /class="overlay-center"[^>]*data-action="close-capture"/);
  assert.match(html, /class="capture"/);
  assert.match(html, /data-capture-input[^>]*aria-label="Task title"[^>]*placeholder="What needs doing\?[^"]*"[^>]*value="Rotate certs"/);
  assert.match(html, /class="kbd">↵<\/span> add task/);
  assert.match(html, /role="dialog" aria-modal="true" aria-label="Quick capture"/);
  assert.match(html, /data-action="submit-capture"[^>]*>Add task<\/button>/);
});

test('capture footer shows the destination project (as a picker button) with its color dot', () => {
  const html = renderCaptureHtml({ captureQuery: '' }, { id: 'p1', name: 'Homelab', color: '#3aa17e' });
  assert.match(html, /class="capture__proj" data-action="toggle-capture-menu"/);
  assert.match(html, /Adding to/);
  assert.match(html, /<span class="proj-dot" style="--dot:#3aa17e"[^>]*><\/span>Homelab/);
});

test('capture project picker lists choices when open, flagging the selected one', () => {
  const projects = [
    { id: 'inbox', name: 'Inbox', color: '#888' },
    { id: 'p1', name: 'Homelab', color: '#3aa17e' },
  ];
  const html = renderCaptureHtml({ captureMenuOpen: true }, projects[0], projects);
  assert.match(html, /class="menu capture__menu"/);
  assert.match(html, /data-action="set-capture-project" data-project-id="inbox"/);
  assert.match(html, /data-action="set-capture-project" data-project-id="p1"/);
  assert.match(html, /aria-selected="true"[^>]*data-project-id="inbox"/);
  assert.match(html, /aria-selected="false"[^>]*data-project-id="p1"/);
});

test('capture picker menu is absent when closed', () => {
  const html = renderCaptureHtml({ captureMenuOpen: false }, { id: 'p1', name: 'Homelab' }, [{ id: 'p1', name: 'Homelab' }]);
  assert.doesNotMatch(html, /capture__menu/);
});

test('capture shows a due-today hint only when a due date is pre-set (from Today)', () => {
  assert.match(renderCaptureHtml({ captureDueDate: '2026-07-07' }, { id: 'p1', name: 'Homelab' }), /Due today/);
  assert.doesNotMatch(renderCaptureHtml({}, { id: 'p1', name: 'Homelab' }), /Due today/);
});

test('capture escapes the project name and the draft value', () => {
  const html = renderCaptureHtml({ captureQuery: '<script>x</script>' }, { id: 'p1', name: '<script>alert("p")</script>' });
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<script>x/);
  assert.match(html, /&lt;script&gt;alert\(&quot;p&quot;\)&lt;\/script&gt;/);
  assert.match(html, /value="&lt;script&gt;x&lt;\/script&gt;"/);
});

test('capture pending state is busy, announced, and disables every mutation control', () => {
  const html = renderCaptureHtml({
    captureQuery: 'Ship release',
    captureSubmitting: true,
    captureMenuOpen: true,
    nlCaptureFields: { labels: ['waiting'] },
  }, { id: 'p1', name: 'Work' }, [{ id: 'p1', name: 'Work' }]);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /data-capture-input[^>]* disabled>/);
  assert.match(html, /data-action="toggle-capture-menu"[^>]* disabled>/);
  assert.match(html, /data-action="set-capture-project"[^>]* disabled>/);
  assert.match(html, /data-action="drop-nl-label"[^>]* disabled>/);
  assert.match(html, /data-action="submit-capture" disabled>Adding…<\/button>/);
  assert.match(html, /role="status">Adding task…/);
});

test('capture recovery and failure notices use truthful live semantics', () => {
  const recovered = renderCaptureHtml({ captureQuery: 'Recovered', captureError: 'Recovered unfinished task.', captureRecovered: true }, null, []);
  assert.match(recovered, /capture__notice capture__notice--recovered" role="status">Recovered unfinished task/);
  const failed = renderCaptureHtml({ captureQuery: 'Retry', captureError: 'Could not confirm creation.', captureRecovered: false }, null, []);
  assert.match(failed, /class="capture__notice" role="alert">Could not confirm creation/);
});

// ---- Toast --------------------------------------------------------------------

test('toast renders the message without an undo button when undo is absent', () => {
  const html = renderToastHtml({ toast: { message: 'Task archived', undo: null } });
  assert.match(html, /class="toast"[^>]*><span>Task archived<\/span>/);
  assert.doesNotMatch(html, /toast__undo/);
});

test('toast renders the Undo action when an undo handler is present', () => {
  const html = renderToastHtml({ toast: { message: 'Task archived', undo: () => {} } });
  assert.match(html, /<button class="toast__undo" type="button" data-action="toast-undo">Undo<\/button>/);
});

test('toast can name a narrower recovery action truthfully', () => {
  const html = renderToastHtml({ toast: { message: 'Completed', undo: () => {}, undoLabel: 'Reopen' } });
  assert.match(html, /data-action="toast-undo">Reopen<\/button>/);
});

test('toast renders nothing when state.toast is null', () => {
  assert.equal(renderToastHtml({ toast: null }), '');
  assert.equal(renderToastHtml({}), '');
});

test('toast escapes the message', () => {
  const html = renderToastHtml({ toast: { message: '<script>alert("t")</script>', undo: null } });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(&quot;t&quot;\)&lt;\/script&gt;/);
});
