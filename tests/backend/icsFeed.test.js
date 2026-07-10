import test from 'node:test';
import assert from 'node:assert/strict';
import { tasksToIcs, taskToVEvent, escapeIcsText, foldIcsLine } from '../../server/icsFeed.js';

const TASK = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Rotate the TLS certs',
  description: 'Renew via certbot',
  priority: 'high',
  status: 'planned',
  projectId: 'p1',
  dueDate: '2026-07-17',
  dueTime: null,
  updatedAt: '2026-07-10T18:57:05.251Z',
};

test('escapeIcsText escapes backslash, semicolon, comma, and newlines (in order)', () => {
  assert.equal(escapeIcsText('a\\b;c,d'), 'a\\\\b\\;c\\,d');
  assert.equal(escapeIcsText('line1\nline2\r\nline3'), 'line1\\nline2\\nline3');
  assert.equal(escapeIcsText(null), '');
});

test('foldIcsLine folds at 75 octets with a space continuation, multibyte-safe', () => {
  const short = 'SUMMARY:short';
  assert.equal(foldIcsLine(short), short);

  const long = `SUMMARY:${'x'.repeat(100)}`;
  const folded = foldIcsLine(long);
  for (const part of folded.split('\r\n')) {
    assert.ok(Buffer.byteLength(part, 'utf8') <= 75, `line under 75 octets: ${part.length}`);
  }
  assert.equal(folded.split('\r\n').slice(1).every((l) => l.startsWith(' ')), true);
  // unfolding restores the original
  assert.equal(folded.replace(/\r\n /g, ''), long);

  // 3-byte chars must never split mid-character
  const emoji = `SUMMARY:${'日'.repeat(40)}`;
  const foldedEmoji = foldIcsLine(emoji);
  assert.equal(foldedEmoji.replace(/\r\n /g, ''), emoji);
  for (const part of foldedEmoji.split('\r\n')) {
    assert.ok(Buffer.byteLength(part, 'utf8') <= 75);
  }
});

test('an undated task yields no event; a dated task yields an all-day VEVENT', () => {
  assert.equal(taskToVEvent({ ...TASK, dueDate: null }), null);
  const lines = taskToVEvent(TASK, { projectName: 'Homelab' });
  assert.ok(lines.includes('UID:11111111-1111-4111-8111-111111111111@prax'));
  assert.ok(lines.includes('DTSTART;VALUE=DATE:20260717'));
  assert.ok(lines.includes('DTEND;VALUE=DATE:20260718'), 'exclusive DTEND is the next day');
  assert.ok(lines.includes('DTSTAMP:20260710T185705Z'));
  assert.ok(lines.includes('SUMMARY:Rotate the TLS certs'));
  assert.ok(lines.includes('CATEGORIES:Homelab'));
  assert.ok(lines.includes('PRIORITY:1'));
  assert.ok(lines.includes('STATUS:CONFIRMED'));
});

test('a timed task uses a floating local DTSTART (no Z, no VALUE=DATE)', () => {
  const lines = taskToVEvent({ ...TASK, dueTime: '09:30' });
  assert.ok(lines.includes('DTSTART:20260717T093000'));
  assert.equal(lines.some((l) => l.startsWith('DTEND')), false);
});

test('all-day DTEND rolls month and year boundaries correctly', () => {
  const dec31 = taskToVEvent({ ...TASK, dueDate: '2026-12-31' });
  assert.ok(dec31.includes('DTEND;VALUE=DATE:20270101'));
  const feb28 = taskToVEvent({ ...TASK, dueDate: '2028-02-28' }); // leap year
  assert.ok(feb28.includes('DTEND;VALUE=DATE:20280229'));
});

// Regression: 9999-12-31 + 1 day is year 10000, which JS renders in the
// expanded "+010000-…" ISO form — grammar-invalid as an RFC 5545 DATE (must
// be exactly 8 digits). The event omits DTEND instead (spec default: one day).
test('a dueDate of 9999-12-31 emits a valid event with no DTEND', () => {
  const lines = taskToVEvent({ ...TASK, dueDate: '9999-12-31' });
  assert.ok(lines.includes('DTSTART;VALUE=DATE:99991231'));
  assert.equal(lines.some((l) => l.startsWith('DTEND')), false);
  assert.equal(lines.some((l) => l.includes('+0')), false, 'no expanded-year garbage anywhere');
});

test('tasksToIcs wraps events in a VCALENDAR with CRLF endings and calendar name', () => {
  const ics = tasksToIcs([TASK, { ...TASK, id: '2', dueDate: null }], { calendarName: 'Prax — Homelab' });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(ics.includes('VERSION:2.0'));
  assert.ok(ics.includes('X-WR-CALNAME:Prax — Homelab'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1, 'undated task skipped');
  assert.equal(ics.includes('\n') && !ics.includes('\r\n\r\n'), true);
  // every raw line obeys the 75-octet limit
  for (const line of ics.split('\r\n')) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `over-long line: ${line}`);
  }
});

test('titles with pipes, commas, semicolons, and newlines survive escaping', () => {
  const ics = tasksToIcs([{ ...TASK, title: 'check kubectl | grep x; then a,b', description: 'l1\nl2' }]);
  assert.ok(ics.includes('SUMMARY:check kubectl | grep x\\; then a\\,b'));
  assert.ok(ics.includes('DESCRIPTION:l1\\nl2'));
});

// ---- the GET /api/calendar.ics route against a fake repository ----

const PROJECT_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function fakeTasks() {
  return [
    { ...TASK, id: 't-open', projectId: PROJECT_UUID },
    { ...TASK, id: 't-done', status: 'completed', projectId: PROJECT_UUID },
    { ...TASK, id: 't-backlog', status: 'notes', projectId: PROJECT_UUID },
    { ...TASK, id: 't-snoozed', deferredUntil: '2099-01-01T00:00:00.000Z', projectId: PROJECT_UUID },
    { ...TASK, id: 't-woken', deferredUntil: '2020-01-01T00:00:00.000Z', projectId: PROJECT_UUID },
    { ...TASK, id: 't-undated', dueDate: null, projectId: PROJECT_UUID },
    { ...TASK, id: 't-other', projectId: OTHER_UUID, title: 'Other project task' },
  ];
}

function fakeRepositories() {
  return {
    tasksRepository: {
      async listTasks(filters = {}) {
        let rows = fakeTasks();
        if (filters.projectId) rows = rows.filter((t) => t.projectId === filters.projectId);
        return rows;
      },
    },
    projectsRepository: {
      async resolveProject(value) {
        if (value === 'homelab' || value === PROJECT_UUID) return { id: PROJECT_UUID, slug: 'homelab', name: 'Homelab' };
        return null;
      },
      async listProjects() {
        return [
          { id: PROJECT_UUID, slug: 'homelab', name: 'Homelab' },
          { id: OTHER_UUID, slug: 'work', name: 'Work' },
        ];
      },
    },
  };
}

test('GET /api/calendar.ics serves text/calendar with open dated tasks only', async () => {
  const { buildApp } = await import('../../server/index.js');
  const app = await buildApp({ skipDb: true, ...fakeRepositories() });
  const res = await app.inject({ method: 'GET', url: '/api/calendar.ics' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/calendar/);
  assert.ok(res.body.includes('UID:t-open@prax'));
  assert.ok(res.body.includes('UID:t-other@prax'));
  assert.ok(!res.body.includes('t-done'), 'completed excluded');
  assert.ok(!res.body.includes('t-backlog'), 'backlog (notes status) excluded — same open rule as the grid');
  assert.ok(!res.body.includes('t-snoozed'), 'snoozed excluded — the feed must not resurface a deferral');
  assert.ok(res.body.includes('t-woken'), 'a past deferredUntil no longer hides the task');
  assert.ok(!res.body.includes('t-undated'), 'undated excluded');
  assert.ok(res.body.includes('CATEGORIES:Homelab'));
  assert.ok(res.body.includes('X-WR-CALNAME:Prax'));
  await app.close();
});

test('GET /api/calendar.ics?project= scopes and names the feed; bad project 400s', async () => {
  const { buildApp } = await import('../../server/index.js');
  const app = await buildApp({ skipDb: true, ...fakeRepositories() });

  const scoped = await app.inject({ method: 'GET', url: '/api/calendar.ics?project=homelab' });
  assert.equal(scoped.statusCode, 200);
  assert.ok(scoped.body.includes('X-WR-CALNAME:Prax — Homelab'));
  assert.ok(scoped.body.includes('UID:t-open@prax'));
  assert.ok(!scoped.body.includes('t-other'), 'other project excluded');

  const bad = await app.inject({ method: 'GET', url: '/api/calendar.ics?project=nope' });
  assert.equal(bad.statusCode, 400);
  await app.close();
});
