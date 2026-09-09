import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';
import {
  cleanNlText, localDateContext, boundGrounding,
  buildNlCaptureMessages, coerceNlCaptureFields,
  buildNlFilterMessages, coerceNlFilterExpr, auditFilterExpr,
} from '../../server/nlParse.js';
import { createFakeChat } from '../../server/chat/fake.js';

const PROJECTS = [
  { slug: 'homelab', name: 'Homelab' },
  { slug: 'work', name: 'Work Stuff' },
];
const LABELS = ['waiting', 'cert'];

// ---- pure: text + date + grounding ----

test('cleanNlText collapses whitespace/newlines, trims, caps at 500', () => {
  assert.equal(cleanNlText('  rotate\ncerts\t tomorrow '), 'rotate certs tomorrow');
  assert.equal(cleanNlText('x'.repeat(600)).length, 500);
  assert.equal(cleanNlText(null), '');
});

test('localDateContext uses LOCAL date parts (no UTC weekday drift) and falls back to now', () => {
  const ctx = localDateContext('2026-07-10');
  assert.equal(ctx.iso, '2026-07-10');
  assert.equal(ctx.weekday, 'Friday');
  const fallback = localDateContext('not-a-date', new Date(2026, 6, 10));
  assert.equal(fallback.iso, '2026-07-10');
  assert.equal(fallback.weekday, 'Friday');
});

test('boundGrounding caps lists, sanitizes shapes, truncates names', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ slug: `p${i}`, name: 'N'.repeat(100) }));
  const { projects, labels } = boundGrounding(
    [...many, { nope: true }, null, { slug: '' }],
    Array.from({ length: 60 }, (_, i) => `@Label-${i}`),
  );
  assert.equal(projects.length, 50);
  assert.equal(projects[0].name.length, 60);
  assert.equal(labels.length, 50);
  assert.equal(labels[0], 'label-0'); // normalized: @ stripped, lowercased
});

// ---- pure: prompt builders ----

test('buildNlCaptureMessages grounds today (weekday + date), projects, labels; raw text is the user first line', () => {
  const [sys, user] = buildNlCaptureMessages({ text: 'pay rent friday', date: '2026-07-10', projects: PROJECTS, labels: LABELS });
  assert.equal(sys.role, 'system');
  assert.match(sys.content, /Today is Friday, 2026-07-10/);
  assert.match(sys.content, /homelab — Homelab/);
  assert.match(sys.content, /KNOWN LABELS: waiting, cert/);
  assert.match(sys.content, /Output ONLY one JSON object/);
  assert.equal(user.content, 'pay rent friday'); // first line == raw text (fake-chat echo contract)
  assert.ok(!user.content.includes('\n'));
});

test('buildNlFilterMessages carries the grammar cheatsheet, few-shots, grounding, and idempotence rule', () => {
  const [sys, user] = buildNlFilterMessages({ text: 'p1 in homelab due this week', date: '2026-07-10', projects: PROJECTS, labels: LABELS });
  assert.match(sys.content, /due:today\|tomorrow\|soon\|week\|none\|YYYY-MM-DD/);
  assert.match(sys.content, /"expr":"p1 & #homelab & due:week"/); // few-shot
  assert.match(sys.content, /already a valid filter expression, return it unchanged/);
  assert.match(sys.content, /homelab — Homelab/);
  assert.equal(user.content, 'p1 in homelab due this week');
});

// ---- pure: capture coercion ----

const COERCE_CTX = { projectSlugs: ['homelab', 'work'], knownLabels: LABELS, rawText: 'rotate certs next friday morning high priority in homelab' };

test('coerceNlCaptureFields keeps valid whitelisted fields', () => {
  const out = coerceNlCaptureFields(
    '{"title":"Rotate certs","priority":"high","dueDate":"2026-07-17","dueTime":"09:00","project":"homelab","labels":["cert"]}',
    COERCE_CTX,
  );
  assert.deepEqual(out.fields, {
    title: 'Rotate certs', priority: 'high', dueDate: '2026-07-17', dueTime: '09:00', project: 'homelab', labels: ['cert'],
  });
  assert.deepEqual(out.dropped, []);
});

test('coerceNlCaptureFields tolerates fenced and prose-embedded JSON', () => {
  const fenced = coerceNlCaptureFields('```json\n{"title":"A"}\n```', COERCE_CTX);
  assert.equal(fenced.fields.title, 'A');
  const prose = coerceNlCaptureFields('Here you go: {"title":"B","priority":"low"} — enjoy!', COERCE_CTX);
  assert.equal(prose.fields.priority, 'low');
});

test('coerceNlCaptureFields clamps enums and validates dates/times', () => {
  const out = coerceNlCaptureFields(
    '{"title":"T","priority":"urgent","dueDate":"July 17","dueTime":"9am","recurrence":"fortnightly"}',
    COERCE_CTX,
  );
  assert.deepEqual(out.fields, { title: 'T' }); // every invalid field dropped
});

test('coerceNlCaptureFields drops dueTime without a valid dueDate', () => {
  const out = coerceNlCaptureFields('{"title":"T","dueTime":"09:00"}', COERCE_CTX);
  assert.equal(out.fields.dueTime, undefined);
});

test('coerceNlCaptureFields drops unknown projects into dropped[]', () => {
  const out = coerceNlCaptureFields('{"title":"T","project":"homlab"}', COERCE_CTX);
  assert.equal(out.fields.project, undefined);
  assert.deepEqual(out.dropped, [{ field: 'project', value: 'homlab' }]);
});

test('coerceNlCaptureFields verbatim-label rule: known kept, verbatim kept, hallucinated dropped', () => {
  const out = coerceNlCaptureFields(
    '{"title":"T","labels":["waiting","certs","ops-review"]}',
    { ...COERCE_CTX, rawText: 'rotate certs for ops' },
  );
  // 'waiting' is known; 'certs' appears verbatim in the raw text; 'ops-review' is neither.
  assert.deepEqual(out.fields.labels, ['waiting', 'certs']);
  assert.deepEqual(out.dropped, [{ field: 'label', value: 'ops-review' }]);
});

test('coerceNlCaptureFields falls back to the raw text when the title is missing, and caps long titles', () => {
  const missing = coerceNlCaptureFields('{"priority":"high"}', COERCE_CTX);
  assert.equal(missing.fields.title, COERCE_CTX.rawText);
  const long = coerceNlCaptureFields(`{"title":"${'x'.repeat(400)}"}`, COERCE_CTX);
  assert.equal(long.fields.title.length, 300);
});

test('coerceNlCaptureFields returns null on garbage', () => {
  assert.equal(coerceNlCaptureFields('[fake-chat] rotate certs', COERCE_CTX), null);
  assert.equal(coerceNlCaptureFields('[1,2,3]', COERCE_CTX), null);
});

// ---- pure: filter coercion + audit ----

test('coerceNlFilterExpr extracts the expr, null on junk or empty', () => {
  assert.equal(coerceNlFilterExpr('{"expr":"p1 & #homelab"}'), 'p1 & #homelab');
  assert.equal(coerceNlFilterExpr('{"expr":"  "}'), null);
  assert.equal(coerceNlFilterExpr('no json here'), null);
});

test('auditFilterExpr: clean grounded expression → ok, no warnings', () => {
  const audit = auditFilterExpr('p1 & #homelab & due:week & @waiting & -done', { projects: PROJECTS, labels: LABELS });
  assert.equal(audit.ok, true);
  assert.equal(audit.parseError, null);
  assert.deepEqual(audit.warnings, []);
});

test('auditFilterExpr warns on unknown projects/labels and silent match-nothing atoms', () => {
  const audit = auditFilterExpr('#homlab & @urgent & due:next-week & priority:urgent & status:doing & is:done', { projects: PROJECTS, labels: LABELS });
  assert.equal(audit.ok, true); // all structurally legal…
  assert.equal(audit.warnings.length, 6); // …all semantically dead
  assert.match(audit.warnings[0], /#homlab is not a project/);
  assert.match(audit.warnings[1], /@urgent is not a known label/);
  assert.match(audit.warnings[2], /due:next-week matches nothing/);
});

test('auditFilterExpr flags barewords that name a project or label', () => {
  const audit = auditFilterExpr('homelab & waiting', { projects: PROJECTS, labels: LABELS });
  assert.match(audit.warnings[0], /did you mean #homelab\?/);
  assert.match(audit.warnings[1], /did you mean @waiting\?/);
});

test('auditFilterExpr reports parse errors', () => {
  const audit = auditFilterExpr('(p1', { projects: PROJECTS, labels: LABELS });
  assert.equal(audit.ok, false);
  assert.match(audit.parseError, /missing \)/);
});

// ---- fake-chat >>{...} directive (browser-verification contract) ----

test('fake chat echoes a >>{...} directive verbatim as the completion', async () => {
  const chat = createFakeChat();
  const res = await chat.complete([{ role: 'user', content: 'rotate certs >>{"title":"Rotate certs","priority":"high"}' }]);
  assert.equal(res.text, '{"title":"Rotate certs","priority":"high"}');
  const plain = await chat.complete([{ role: 'user', content: 'rotate certs' }]);
  assert.match(plain.text, /^\[fake-chat\] rotate certs/);
});

// ---- routes ----

function makeApp({ chat } = {}) {
  return buildApp({
    skipDb: true, chat,
    tasksRepository: {},
    libraryRepository: { listDocuments: async () => [] },
    projectsRepository: { resolveProject: async () => null },
    appSettingsRepository: { async getSetting(_k, fb) { return fb; }, async putSetting() {} },
    documentLinksRepository: { listStaleDocuments: async () => [], listOutboundLinksForDocuments: async () => new Map() },
  });
}
const scripted = (json) => ({ model: 's', backend: 's', async complete() { return { text: json, model: 's' }; }, async isAvailable() { return true; } });
const post = (app, url, payload) => app.inject({ method: 'POST', url, payload });

const CAPTURE_BODY = { text: 'rotate certs next friday morning in homelab', date: '2026-07-10', projects: PROJECTS, labels: LABELS };

test('POST nl-capture returns coerced fields from the model JSON', async () => {
  const app = await makeApp({ chat: scripted('{"title":"Rotate certs","priority":"high","dueDate":"2026-07-17","dueTime":"09:00","project":"homelab"}') });
  const b = (await post(app, '/api/tasks/nl-capture', CAPTURE_BODY)).json();
  assert.equal(b.degraded, false);
  assert.equal(b.model, 's');
  assert.deepEqual(b.fields, { title: 'Rotate certs', priority: 'high', dueDate: '2026-07-17', dueTime: '09:00', project: 'homelab' });
  await app.close();
});

test('POST nl-capture degrades (200) with no chat model', async () => {
  const app = await makeApp({ chat: null });
  const res = await post(app, '/api/tasks/nl-capture', CAPTURE_BODY);
  assert.equal(res.statusCode, 200);
  const b = res.json();
  assert.equal(b.degraded, true);
  assert.equal(b.reason, 'no-chat-model');
  assert.equal(b.fields, null);
  await app.close();
});

test('POST nl-capture degrades when the model returns prose (no JSON)', async () => {
  const app = await makeApp({ chat: scripted('[fake-chat] rotate certs next friday') });
  const b = (await post(app, '/api/tasks/nl-capture', CAPTURE_BODY)).json();
  assert.equal(b.degraded, true);
  assert.equal(b.reason, 'generation-failed');
  await app.close();
});

test('POST nl-capture 400s on empty text (before any chat resolution)', async () => {
  const app = await makeApp({ chat: null });
  assert.equal((await post(app, '/api/tasks/nl-capture', { text: '   ' })).statusCode, 400);
  assert.equal((await post(app, '/api/tasks/nl-capture', {})).statusCode, 400);
  await app.close();
});

test('POST nl-filter returns a validated expression with audit warnings', async () => {
  const app = await makeApp({ chat: scripted('{"expr":"p1 & #homelab & due:week"}') });
  const b = (await post(app, '/api/tasks/nl-filter', { text: 'p1 in homelab due this week', projects: PROJECTS, labels: LABELS })).json();
  assert.equal(b.degraded, false);
  assert.equal(b.valid, true);
  assert.equal(b.expr, 'p1 & #homelab & due:week');
  assert.deepEqual(b.warnings, []);
  await app.close();
});

test('POST nl-filter returns an invalid expr with valid:false + parseError (not discarded)', async () => {
  const app = await makeApp({ chat: scripted('{"expr":"(p1"}') });
  const b = (await post(app, '/api/tasks/nl-filter', { text: 'whatever', projects: PROJECTS })).json();
  assert.equal(b.degraded, false);
  assert.equal(b.valid, false);
  assert.equal(b.expr, '(p1');
  assert.match(b.parseError, /missing \)/);
  await app.close();
});

test('POST nl-filter surfaces semantic warnings for a valid-but-dead expression', async () => {
  const app = await makeApp({ chat: scripted('{"expr":"#homlab & due:next-week"}') });
  const b = (await post(app, '/api/tasks/nl-filter', { text: 'whatever', projects: PROJECTS, labels: LABELS })).json();
  assert.equal(b.valid, true);
  assert.equal(b.warnings.length, 2);
  await app.close();
});

test('POST nl-filter degrades on prose output and on missing model', async () => {
  const appProse = await makeApp({ chat: scripted('sorry, no idea') });
  const prose = (await post(appProse, '/api/tasks/nl-filter', { text: 'x' })).json();
  assert.equal(prose.degraded, true);
  assert.equal(prose.reason, 'generation-failed');
  await appProse.close();

  const appNone = await makeApp({ chat: null });
  const none = (await post(appNone, '/api/tasks/nl-filter', { text: 'x' })).json();
  assert.equal(none.reason, 'no-chat-model');
  await appNone.close();
});

test('coerceNlCaptureFields rejects calendar-invalid dates that pass the format regex', () => {
  const out = coerceNlCaptureFields('{"title":"T","dueDate":"2026-02-31","dueTime":"09:00"}', COERCE_CTX);
  assert.equal(out.fields.dueDate, undefined);
  assert.equal(out.fields.dueTime, undefined); // orphaned time dropped with it
});

test('auditFilterExpr warns on unknown @labels even with an empty grounding list', () => {
  const audit = auditFilterExpr('@urgent', { projects: PROJECTS, labels: [] });
  assert.match(audit.warnings[0], /@urgent is not a known label/);
});
