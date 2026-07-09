import test from 'node:test';
import assert from 'node:assert/strict';
import { renderGenerateRunbookHtml } from '../../public/js/renderGenerateRunbook.js';

const projects = [{ id: 'p1', name: 'Homelab' }, { id: 'p2', name: 'Work' }];

test('idle panel shows the description field, project options, and hint', () => {
  const html = renderGenerateRunbookHtml({ genRbOpen: true, genRbProject: 'p2' }, { projects });
  assert.match(html, /data-overlay="genrb"/);
  assert.match(html, /data-genrb-input/);
  assert.match(html, /data-genrb-project/);
  assert.match(html, /<option value="p1">Homelab<\/option>/);
  assert.match(html, /<option value="p2" selected>Work<\/option>/);   // default selection
  assert.match(html, /checkbox steps and a rollback/);
  assert.match(html, />Generate runbook</);
});

test('loading and error states', () => {
  assert.match(renderGenerateRunbookHtml({ genRbOpen: true, genRbLoading: true }, { projects }), /Drafting a runbook/);
  assert.match(renderGenerateRunbookHtml({ genRbOpen: true, genRbLoading: true }, { projects }), /Generating…/);
  assert.match(renderGenerateRunbookHtml({ genRbOpen: true, genRbError: 'no AI model is configured' }, { projects }), /no AI model is configured/);
});

test('preserves the typed description across re-renders (escaped)', () => {
  const html = renderGenerateRunbookHtml({ genRbOpen: true, genRbDescription: 'Postgres <primary> down' }, { projects });
  assert.match(html, /Postgres &lt;primary&gt; down<\/textarea>/);
});

test('handles no projects gracefully', () => {
  assert.match(renderGenerateRunbookHtml({ genRbOpen: true }, { projects: [] }), /No project available/);
});
