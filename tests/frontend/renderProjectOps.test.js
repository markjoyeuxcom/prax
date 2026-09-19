import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPS_FIELDS,
  opsSectionKey,
  revealKey,
  opsFieldAttr,
  setOpsFields,
  renderOpsToggleHtml,
  renderProjectOpsHtml,
} from '../../public/js/renderProjectOps.js';

const FULL = {
  id: 'p1', name: 'Homelab', onCall: 'Mark', handoffNotes: 'Talos window Wed 20:00',
  repoUrl: 'git@gitlab.com:markjoyeuxcom/homelab.git', area: 'Labs',
};
const EMPTY = { id: 'p2', name: 'Personal' };

test('setOpsFields counts only fields with a non-blank value', () => {
  assert.deepEqual(setOpsFields(FULL), ['onCall', 'handoffNotes', 'repoUrl', 'area']);
  assert.deepEqual(setOpsFields(EMPTY), []);
  assert.deepEqual(setOpsFields({ id: 'p3', onCall: '   ', area: 'Work' }), ['area']);
  assert.deepEqual(setOpsFields(null), []);
});

test('the header toggle reuses the collapsed-sections action and reports the set count', () => {
  const open = renderOpsToggleHtml(FULL);
  assert.match(open, /data-action="toggle-section"/);
  assert.match(open, /data-section-key="ops:p1"/);
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /aria-controls="proj-ops-p1"/);
  assert.match(open, /page-head__ops-count">4</);
  assert.match(open, /class="page-head__ops-toggle is-open"/);

  const closed = renderOpsToggleHtml(EMPTY, { collapsed: true });
  assert.match(closed, /aria-expanded="false"/);
  assert.doesNotMatch(closed, /page-head__ops-count/, 'no badge when nothing is set');
  assert.doesNotMatch(closed, /is-open/);
  assert.equal(opsSectionKey('p2'), 'ops:p2');
});

test('set fields render the same inputs main.js listens to, unset fields render add buttons', () => {
  const html = renderProjectOpsHtml({ id: 'p1', onCall: 'Mark', area: 'Labs' });
  assert.match(html, /id="proj-ops-p1"/);
  assert.match(html, /<input class="proj-ops__input" type="text" data-project-oncall data-project-id="p1" value="Mark"/);
  assert.match(html, /data-project-area data-project-id="p1" value="Labs"[^>]*maxlength="60"/);
  assert.match(html, /aria-label="On-call owner"/);
  assert.match(html, /aria-label="Area"/);
  // Unset: no empty inputs, one add button each, so nothing renders a placeholder.
  assert.doesNotMatch(html, /data-project-handoff/);
  assert.doesNotMatch(html, /data-project-repourl/);
  assert.match(html, /data-action="reveal-ops-field" data-project-id="p1" data-field="handoffNotes" aria-label="Add handoff"/);
  assert.match(html, /data-action="reveal-ops-field" data-project-id="p1" data-field="repoUrl" aria-label="Add repo"/);
  assert.equal((html.match(/proj-ops__add/g) || []).length, 2);
});

test('an empty project renders four add buttons and no inputs', () => {
  const html = renderProjectOpsHtml(EMPTY);
  assert.equal((html.match(/proj-ops__add/g) || []).length, OPS_FIELDS.length);
  assert.doesNotMatch(html, /<input/);
});

test('a revealed unset field renders its input so the user can type into it', () => {
  const html = renderProjectOpsHtml(EMPTY, { revealed: [revealKey('p2', 'repoUrl')] });
  assert.match(html, /data-project-repourl data-project-id="p2" value=""/);
  assert.match(html, /class="proj-ops__field proj-ops__field--repo"/);
  assert.equal((html.match(/proj-ops__add/g) || []).length, 3);
  // A reveal for another project does not leak.
  const other = renderProjectOpsHtml(EMPTY, { revealed: [revealKey('p1', 'repoUrl')] });
  assert.doesNotMatch(other, /data-project-repourl/);
});

test('collapsed renders nothing and a missing project renders nothing', () => {
  assert.equal(renderProjectOpsHtml(FULL, { collapsed: true }), '');
  assert.equal(renderProjectOpsHtml(null), '');
});

test('values and ids are HTML-escaped', () => {
  const html = renderProjectOpsHtml({ id: 'p"1', onCall: '<b>x</b>' });
  assert.match(html, /data-project-id="p&quot;1"/);
  assert.match(html, /value="&lt;b&gt;x&lt;\/b&gt;"/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
});

test('opsFieldAttr maps a field key to the input attribute main.js focuses', () => {
  assert.equal(opsFieldAttr('repoUrl'), 'data-project-repourl');
  assert.equal(opsFieldAttr('onCall'), 'data-project-oncall');
  assert.equal(opsFieldAttr('nope'), null);
});
