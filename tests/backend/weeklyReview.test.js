import test from 'node:test';
import assert from 'node:assert/strict';
import { addDaysUtc, compileWeeklyReview, isoWeekId, weekStartOf, weeklyReviewTitle } from '../../server/weeklyReview.js';
import { buildApp } from '../../server/index.js';

const NOW = new Date('2026-07-19T12:00:00.000Z'); // Sunday of week 2026-W29
const WEEK_START = '2026-07-13'; // Monday

test('week identity: ISO weeks, Monday starts, year boundaries', () => {
  assert.equal(weekStartOf(new Date('2026-07-19T12:00:00Z')), '2026-07-13');
  assert.equal(weekStartOf(new Date('2026-07-13T00:00:00Z')), '2026-07-13');
  assert.equal(isoWeekId(new Date('2026-07-19T12:00:00Z')), '2026-W29');
  // Jan 1 2027 is a Friday — it belongs to 2026-W53.
  assert.equal(isoWeekId(new Date('2027-01-01T12:00:00Z')), '2026-W53');
  // Dec 29 2025 (Monday) opens 2026-W01.
  assert.equal(isoWeekId(new Date('2025-12-29T12:00:00Z')), '2026-W01');
  assert.equal(weeklyReviewTitle('2026-W29'), 'Weekly review — 2026-W29');
  assert.equal(addDaysUtc('2026-07-13', 7), '2026-07-20');
});

const PROJECTS = [
  { id: 'inbox-1', slug: 'inbox', name: 'Inbox' },
  { id: 'p-ops', slug: 'ops', name: 'Ops' },
  { id: 'p-idle', slug: 'idle', name: 'Idle Project' },
];

function fixtureWeek() {
  const tasks = [
    { id: 's1', title: 'Shipped thing', status: 'completed', projectId: 'p-ops', updatedAt: '2026-07-15T10:00:00Z', archivedAt: null },
    { id: 'st1', title: 'Stalled thing', status: 'in-progress', projectId: 'p-ops', updatedAt: '2026-07-01T10:00:00Z', archivedAt: null },
    { id: 'sl1', title: 'Slippery thing', status: 'planned', projectId: 'p-ops', updatedAt: '2026-07-16T10:00:00Z', archivedAt: null },
    { id: 'ia1', title: 'Old inbox thing', status: 'planned', projectId: 'inbox-1', createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-01T10:00:00Z', archivedAt: null },
    { id: 'nw1', title: 'Next week thing', status: 'planned', projectId: 'p-ops', dueDate: '2026-07-22', updatedAt: '2026-07-16T10:00:00Z', archivedAt: null },
    { id: 'pl1', title: 'Planned next week', status: 'planned', projectId: 'p-ops', plannedFor: '2026-07-21', updatedAt: '2026-07-16T10:00:00Z', archivedAt: null },
  ];
  const activity = [
    { taskId: 'sl1', eventType: 'deferred', message: 'Snoozed', createdAt: '2026-07-15T09:00:00Z' },
    { taskId: 'sl1', eventType: 'rescheduled', message: 'Due moved', createdAt: '2026-07-16T09:00:00Z' },
    { taskId: 's1', eventType: 'status', message: 'Status → completed', createdAt: '2026-07-15T10:00:00Z' },
  ];
  const documents = [
    { id: 'd1', title: 'Ops runbook', projectId: 'p-ops', updatedAt: '2026-07-14T10:00:00Z', archivedAt: null },
  ];
  return { tasks, activity, projects: PROJECTS, documents, weekStart: WEEK_START, now: NOW };
}

test('compileWeeklyReview: every section from a full fixture week', () => {
  const { markdown, stats, weekId } = compileWeeklyReview(fixtureWeek());
  assert.equal(weekId, '2026-W29');
  assert.match(markdown, /## Shipped\n\n- Shipped thing _\(Ops\)_/);
  assert.match(markdown, /## Stalled\n\n- Stalled thing _\(Ops\)_ — untouched since 2026-07-01/);
  assert.match(markdown, /## Most slipped\n\n- Slippery thing _\(Ops\)_ — pushed 2× this week/);
  assert.match(markdown, /## Inbox aging\n\n1 inbox item older than a week/);
  assert.match(markdown, /## Silent projects\n\n- Idle Project/);
  assert.doesNotMatch(markdown, /- Ops\n/, 'a project with movement is not silent');
  assert.match(markdown, /## Next week\n\n- 2026-07-21: 1 task\n- 2026-07-22: 1 task\n2 total due or planned\./);
  assert.match(markdown, /## Documents touched\n\n- \[\[Ops runbook\]\]/);
  assert.match(markdown, /\*Definitions:/);
  assert.deepEqual(stats, { shipped: 1, stalled: 1, slipped: 1, inboxAging: 1, silentProjects: 1, nextWeek: 2 });
});

test('an empty week compiles truthfully — every section present, honestly empty', () => {
  const { markdown, stats } = compileWeeklyReview({ projects: PROJECTS, weekStart: WEEK_START, now: NOW });
  assert.match(markdown, /## Shipped\n\nNothing shipped this week\./);
  assert.match(markdown, /## Stalled\n\nNothing in progress went silent\./);
  assert.match(markdown, /## Most slipped\n\nNo snoozes, reschedules, or carries recorded this week\./);
  assert.match(markdown, /## Inbox aging\n\nNo inbox items older than a week\./);
  assert.match(markdown, /## Next week\n\nNothing due or planned yet\./);
  assert.doesNotMatch(markdown, /## Documents touched/, 'no touched docs, no empty section padding');
  assert.equal(stats.shipped, 0);
});

// ---- through the production route ----

async function reviewApp() {
  const { loadConfig } = await import('../../server/config.js');
  const config = loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' });
  return buildApp({ config });
}

test('generate -> idempotent regenerate -> verified refusal, through the real app', async ({ }) => {
  const app = await reviewApp();
  // Pin the reviewed week to TODAY's week. The route's default anchor is
  // yesterday (so a Monday run reviews last week) — which means on Mondays a
  // seed completed "now" falls outside the default week and shipped would be
  // honestly 0. The pin makes the test deterministic on every weekday.
  const anchor = { date: new Date().toISOString().slice(0, 10) };
  // Seed a completed task this week so the review has content.
  const created = (await app.inject({
    method: 'POST', url: '/api/tasks',
    payload: { title: 'Review seed', project: 'inbox', priority: 'medium', status: 'planned' },
  })).json();
  await app.inject({ method: 'PATCH', url: `/api/tasks/${created.id}`, payload: { status: 'completed' } });

  const first = (await app.inject({ method: 'POST', url: '/api/library/weekly-review', payload: anchor })).json();
  assert.equal(first.degraded, undefined, JSON.stringify(first));
  assert.equal(first.created, true);
  assert.match(first.weekId, /^\d{4}-W\d{2}$/);
  assert.ok(first.stats.shipped >= 1, 'the completed seed shipped');

  const doc = (await app.inject({ method: 'GET', url: `/api/library/documents/${first.documentId}` })).json();
  assert.equal(doc.title, `Weekly review — ${first.weekId}`);
  assert.deepEqual(doc.tags, ['weekly-review']);
  assert.equal(doc.kind, 'synthesized');
  assert.equal(doc.updatedBy, 'agent');
  assert.equal(doc.verified, false, 'agent-written reviews are unverified by default');
  assert.match(doc.body, /## Shipped/);

  // Regenerate: same document, updated in place — never a duplicate.
  const second = (await app.inject({ method: 'POST', url: '/api/library/weekly-review', payload: anchor })).json();
  assert.equal(second.updated, true);
  assert.equal(second.documentId, first.documentId);
  const all = (await app.inject({ method: 'GET', url: '/api/library/documents' })).json();
  const reviews = (Array.isArray(all) ? all : all.documents || []).filter((d) => d.title === doc.title);
  assert.equal(reviews.length, 1);

  // A verified review is refused, not silently overwritten.
  const reviewed = (await app.inject({ method: 'GET', url: `/api/library/documents/${first.documentId}` })).json();
  const verify = await app.inject({ method: 'POST', url: `/api/library/documents/${first.documentId}/verify`, payload: { verified: true, revision: reviewed.revision } });
  assert.equal(verify.statusCode, 200, `verify endpoint responded ${verify.statusCode}`);
  const refused = (await app.inject({ method: 'POST', url: '/api/library/weekly-review', payload: anchor })).json();
  assert.equal(refused.degraded, true);
  assert.equal(refused.reason, 'verified-review');
  assert.equal(refused.documentId, first.documentId);

  // Narration without a chat model degrades honestly but the review stands.
  const unverify = await app.inject({ method: 'POST', url: `/api/library/documents/${first.documentId}/verify`, payload: { verified: false } });
  assert.equal(unverify.statusCode, 200);
  const narrated = (await app.inject({ method: 'POST', url: '/api/library/weekly-review', payload: { ...anchor, narrate: true } })).json();
  assert.equal(narrated.narrated, false);
  assert.equal(narrated.narrationDegraded, true);
  assert.equal(narrated.updated, true);

  await app.close();
});

test('regenerating refuses a review the person edited, keeps their words, and a fresh one follows archiving', async () => {
  const app = await reviewApp();
  const anchor = { date: new Date().toISOString().slice(0, 10) };
  const first = (await app.inject({ method: 'POST', url: '/api/library/weekly-review', payload: anchor })).json();
  const doc = (await app.inject({ method: 'GET', url: `/api/library/documents/${first.documentId}` })).json();
  const notes = `${doc.body}\n\n## My reflections\n\nShip smaller batches next week.`;
  const edit = await app.inject({ method: 'PATCH', url: `/api/library/documents/${doc.id}`, payload: { body: notes, ifRevision: doc.revision } });
  assert.equal(edit.statusCode, 200);

  const refused = (await app.inject({ method: 'POST', url: '/api/library/weekly-review', payload: anchor })).json();
  assert.equal(refused.degraded, true);
  assert.equal(refused.reason, 'edited-review');
  assert.equal(refused.documentId, doc.id);
  const kept = (await app.inject({ method: 'GET', url: `/api/library/documents/${doc.id}` })).json();
  assert.equal(kept.body, notes, 'the person\'s reflections survive');
  assert.equal(kept.updatedBy, 'user');

  // An identified agent's edit is someone else's writing too.
  const agentEdit = await app.inject({
    method: 'PATCH', url: `/api/library/documents/${doc.id}`,
    headers: { 'x-prax-origin': 'agent', 'x-prax-agent': 'codex' },
    payload: { body: `${notes}\n\nAgent follow-up.`, ifRevision: kept.revision },
  });
  assert.equal(agentEdit.statusCode, 200);
  const stillRefused = (await app.inject({ method: 'POST', url: '/api/library/weekly-review', payload: anchor })).json();
  assert.equal(stillRefused.reason, 'edited-review');

  // Archiving the edited review is the documented way to compile a fresh one.
  const archived = await app.inject({ method: 'DELETE', url: `/api/library/documents/${doc.id}` });
  assert.equal(archived.statusCode, 200);
  const fresh = (await app.inject({ method: 'POST', url: '/api/library/weekly-review', payload: anchor })).json();
  assert.equal(fresh.created, true);
  assert.notEqual(fresh.documentId, doc.id);
  await app.close();
});

test('an edit or verification made while the narrative is generated is not overwritten', async () => {
  let app; let during = null;
  const chat = { async complete() { if (during) await during(); return { text: 'A calm week.' }; } };
  const { loadConfig } = await import('../../server/config.js');
  app = await buildApp({ config: loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' }), chat });
  const anchor = { date: new Date().toISOString().slice(0, 10) };
  const first = (await app.inject({ method: 'POST', url: '/api/library/weekly-review', payload: { ...anchor, narrate: true } })).json();
  assert.equal(first.narrated, true);

  during = async () => {
    during = null;
    const doc = (await app.inject({ method: 'GET', url: `/api/library/documents/${first.documentId}` })).json();
    await app.inject({ method: 'PATCH', url: `/api/library/documents/${doc.id}`, payload: { body: 'Edited mid-narration', ifRevision: doc.revision } });
  };
  const racing = (await app.inject({ method: 'POST', url: '/api/library/weekly-review', payload: { ...anchor, narrate: true } })).json();
  assert.equal(racing.degraded, true);
  assert.equal(racing.reason, 'edited-review');
  const doc = (await app.inject({ method: 'GET', url: `/api/library/documents/${first.documentId}` })).json();
  assert.equal(doc.body, 'Edited mid-narration');
  await app.close();
});

test('narration reports why it degraded: no model versus a failed generation', async () => {
  const { loadConfig } = await import('../../server/config.js');
  const config = loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' });
  const anchor = { date: new Date().toISOString().slice(0, 10), narrate: true };
  const none = await reviewApp();
  const noModel = (await none.inject({ method: 'POST', url: '/api/library/weekly-review', payload: anchor })).json();
  assert.equal(noModel.narrationReason, 'no-chat-model');
  await none.close();
  const failing = await buildApp({ config, chat: { async complete() { throw new Error('rate limited'); } } });
  const failed = (await failing.inject({ method: 'POST', url: '/api/library/weekly-review', payload: anchor })).json();
  assert.equal(failed.narrationDegraded, true);
  assert.equal(failed.narrationReason, 'generation-failed');
  assert.equal(failed.created, true, 'the deterministic review still stands');
  await failing.close();
});

test('Inbox aging includes loose notes, excludes reviews and links directly to processing', () => {
  const fixture = fixtureWeek();
  fixture.documents.push({ id: 'loose', title: 'Loose capture', body: '', projectId: 'inbox-1', createdAt: '2026-06-01T00:00:00Z' },
    { id: 'review', title: 'Saved review', body: '', projectId: 'inbox-1', createdAt: '2026-06-01T00:00:00Z', tags: ['weekly-review'] });
  const { markdown, stats } = compileWeeklyReview(fixture);
  assert.equal(stats.inboxAging, 2);
  assert.match(markdown, /Loose capture/); assert.doesNotMatch(markdown, /Saved review/);
  assert.match(markdown, /\[Process Inbox\]\(#inbox-process\)/);
});
