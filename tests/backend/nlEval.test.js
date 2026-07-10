import test from 'node:test';
import assert from 'node:assert/strict';
import { compareCaptureFields, compareFilterResult, runNlEval } from '../../tests/eval/nlEval.js';
import { GROUNDING } from '../../tests/eval/nlFixtures.js';

// ---- compareCaptureFields ----

test('compareCaptureFields passes an exact match (title case-insensitive)', () => {
  const problems = compareCaptureFields(
    { title: 'Rotate The Certs', priority: 'high', dueDate: '2026-07-17' },
    { title: 'rotate the certs', priority: 'high', dueDate: '2026-07-17' },
  );
  assert.deepEqual(problems, []);
});

test('compareCaptureFields fails on wrong values and reports each', () => {
  const problems = compareCaptureFields(
    { title: 'Pay rent', dueDate: '2026-07-17' },
    { title: 'pay rent', dueDate: '2026-07-10' },
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /dueDate/);
});

test('compareCaptureFields catches over-inference: unexpected fields fail', () => {
  const problems = compareCaptureFields(
    { title: 'Buy milk', project: 'personal', priority: 'high' },
    { title: 'buy milk' },
  );
  assert.equal(problems.length, 2);
  assert.match(problems[0], /unexpected priority/);
  assert.match(problems[1], /unexpected project/);
});

test('compareCaptureFields: unexpected labels fail unless a subset is allowed', () => {
  const strict = compareCaptureFields({ title: 'T', labels: ['cert'] }, { title: 't' });
  assert.match(strict[0], /unexpected labels/);
  const subset = compareCaptureFields({ title: 'T', labels: ['cert'] }, { title: 't', labelsSubsetOf: ['cert', 'tls-rotation'] });
  assert.deepEqual(subset, []);
  const outside = compareCaptureFields({ title: 'T', labels: ['ops'] }, { title: 't', labelsSubsetOf: ['cert'] });
  assert.match(outside[0], /outside allowed subset/);
});

test('compareCaptureFields: titleIncludes is a lowercased substring match', () => {
  assert.deepEqual(compareCaptureFields({ title: 'Fix the NGINX Ingress now' }, { titleIncludes: 'nginx ingress' }), []);
  assert.match(compareCaptureFields({ title: 'Fix it' }, { titleIncludes: 'nginx' })[0], /missing "nginx"/);
});

// ---- compareFilterResult ----

test('compareFilterResult passes exact expr + audit expectations', () => {
  const problems = compareFilterResult(
    { expr: 'p1 & overdue', audit: { ok: true, parseError: null, warnings: [] } },
    { expr: 'p1 & overdue', valid: true, warnings: 0 },
  );
  assert.deepEqual(problems, []);
});

test('compareFilterResult reports expr mismatch, validity, and warning expectations', () => {
  const problems = compareFilterResult(
    { expr: 'p1', audit: { ok: true, parseError: null, warnings: ['#x is not a project'] } },
    { expr: 'p2', valid: true, warnings: 0 },
  );
  assert.equal(problems.length, 2);
  assert.match(problems[0], /expr "p1"/);
  assert.match(problems[1], /1 warnings ≠ 0/);
  const include = compareFilterResult(
    { expr: 'p1 & #kubernetes', audit: { ok: true, parseError: null, warnings: ['#kubernetes is not a project'] } },
    { exprIncludes: '#kubernetes', valid: true, warningsInclude: 'is not a project' },
  );
  assert.deepEqual(include, []);
});

// ---- runNlEval with a scripted chat ----

test('runNlEval scores capture + filter cases through the real pipeline', async () => {
  // Scripted model: answers the capture prompt with fields JSON and the filter
  // prompt with an expr JSON (told apart by the system prompt's output rule).
  const chat = {
    backend: 's', model: 's',
    async complete(messages) {
      const sys = messages[0].content;
      return sys.includes('Output ONLY one JSON object')
        ? { text: '{"title":"Pay rent","dueDate":"2026-07-10"}', model: 's' }
        : { text: '{"expr":"p1 & overdue"}', model: 's' };
    },
  };
  const { results, passed, total } = await runNlEval(chat, {
    date: '2026-07-10',
    grounding: GROUNDING,
    captureCases: [
      { name: 'pass', text: 'pay rent friday', expect: { title: 'pay rent', dueDate: '2026-07-10' } },
      { name: 'fail', text: 'pay rent friday', expect: { title: 'pay rent', dueDate: '2026-07-17' } },
    ],
    filterCases: [
      { name: 'pass', text: 'p1 overdue', expect: { expr: 'p1 & overdue', valid: true, warnings: 0 } },
    ],
  });
  assert.equal(total, 3);
  assert.equal(passed, 2);
  assert.equal(results[0].pass, true);
  assert.equal(results[1].pass, false);
  assert.match(results[1].problems[0], /dueDate/);
  assert.equal(results[2].pass, true);
});

test('runNlEval survives unparseable output and chat errors as case failures', async () => {
  const chat = {
    backend: 's', model: 's', calls: 0,
    async complete() {
      this.calls += 1;
      if (this.calls === 1) return { text: 'not json at all', model: 's' };
      throw new Error('boom');
    },
  };
  const { results, passed } = await runNlEval(chat, {
    date: '2026-07-10',
    grounding: GROUNDING,
    captureCases: [
      { name: 'junk', text: 'x', expect: { title: 'x' } },
      { name: 'throw', text: 'y', expect: { title: 'y' } },
    ],
  });
  assert.equal(passed, 0);
  assert.match(results[0].problems[0], /not parseable JSON/);
  assert.match(results[1].problems[0], /chat error: boom/);
});

test('comparators throw on a typo’d expectation key (fixture authoring guard)', () => {
  assert.throws(() => compareCaptureFields({ title: 'T' }, { duedate: '2026-07-10' }), /unknown capture expectation key "duedate"/);
  assert.throws(() => compareFilterResult({ expr: 'p1', audit: { ok: true, warnings: [] } }, { warningsIncludes: 'x' }), /unknown filter expectation key "warningsIncludes"/);
});
