import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCaptureHtml } from '../../public/js/renderCapture.js';
import { renderToastHtml } from '../../public/js/renderToast.js';

// ---- Quick capture ----------------------------------------------------------

test('capture renders the overlay, input with current value and the ↵ hint', () => {
  const html = renderCaptureHtml({ captureQuery: 'Rotate certs' }, { id: 'p1', name: 'Homelab', color: '#3aa17e' });
  assert.match(html, /class="overlay-center"[^>]*data-action="close-capture"/);
  assert.match(html, /class="capture"/);
  assert.match(html, /data-capture-input[^>]*placeholder="What needs doing\?"[^>]*value="Rotate certs"/);
  assert.match(html, /class="kbd">↵<\/span> add task/);
});

test('capture footer shows the destination project with its color dot', () => {
  const html = renderCaptureHtml({ captureQuery: '' }, { id: 'p1', name: 'Homelab', color: '#3aa17e' });
  assert.match(html, /class="capture__proj">Adding to <span class="proj-dot" style="--dot:#3aa17e"[^>]*><\/span>Homelab</);
});

test('capture escapes the project name and the draft value', () => {
  const html = renderCaptureHtml({ captureQuery: '<script>x</script>' }, { id: 'p1', name: '<script>alert("p")</script>' });
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<script>x/);
  assert.match(html, /&lt;script&gt;alert\(&quot;p&quot;\)&lt;\/script&gt;/);
  assert.match(html, /value="&lt;script&gt;x&lt;\/script&gt;"/);
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

test('toast renders nothing when state.toast is null', () => {
  assert.equal(renderToastHtml({ toast: null }), '');
  assert.equal(renderToastHtml({}), '');
});

test('toast escapes the message', () => {
  const html = renderToastHtml({ toast: { message: '<script>alert("t")</script>', undo: null } });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(&quot;t&quot;\)&lt;\/script&gt;/);
});
