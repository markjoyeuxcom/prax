// Regression (review 2026-09-22): several views printed stored UTC timestamps
// as if they were local — in Paris a run started at 15:05 read "Started 13:05",
// and in Los Angeles one drawer showed the same moment as 16:30 (Snooze) and
// 23:30 (Activity). Every displayed timestamp now goes through local getters.
//
// node --test runs each file in its own process, and Node re-reads
// process.env.TZ on assignment, so each case switches the zone in-process.
process.env.TZ = 'UTC';

const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const { localDateOf, localTimeOf, localDateTimeOf, localDayHeaders } = await import('../../public/js/dateHelpers.js');
const { renderRunHtml } = await import('../../public/js/renderRun.js');
const { renderTaskDrawerHtml } = await import('../../public/js/renderTaskDetail.js');
const { buildDailyBrief } = await import('../../public/js/brief.js');
const { buildProjectGroups } = await import('../../public/js/renderAllProjects.js');
const { renderDocTable } = await import('../../public/js/renderLibrary.js');
const { renderInboxDialog } = await import('../../public/js/renderInbox.js');

function inZone(zone, fn) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try { return fn(); } finally { process.env.TZ = previous; }
}

const MOMENT = '2026-09-22T13:05:00.000Z';
// The local wall clock at MOMENT (time), 13:10Z (step) and 13:17Z (finish).
// Lord Howe is UTC+10:30 in September, so half-hour offsets are covered too.
const EXPECTED = {
  'America/Los_Angeles': { date: '2026-09-22', time: '06:05', step: '06:10', finish: '06:17' },
  'Australia/Lord_Howe': { date: '2026-09-22', time: '23:35', step: '23:40', finish: '23:47' },
  'Europe/Paris': { date: '2026-09-22', time: '15:05', step: '15:10', finish: '15:17' },
};
const ZONES = Object.keys(EXPECTED);

test('timestamps render in local time; date-only values never shift', () => {
  for (const zone of ZONES) {
    inZone(zone, () => {
      const { date, time } = EXPECTED[zone];
      assert.equal(localTimeOf(MOMENT), time, zone);
      assert.equal(localDateOf(MOMENT), date, zone);
      assert.equal(localDateTimeOf(MOMENT), `${date} ${time}`, zone);
      assert.equal(localDateOf('2026-09-22'), '2026-09-22', zone);
      assert.equal(localDateTimeOf('2026-09-22'), '2026-09-22', zone);
      assert.equal(localDateOf('not a date'), '', zone);
      assert.equal(localTimeOf(null), '', zone);
    });
  }
  inZone('Australia/Lord_Howe', () => {
    assert.equal(localDateOf('2026-09-22T13:31:00.000Z'), '2026-09-23');
    assert.equal(localDateTimeOf('2026-09-22T13:31:00.000Z'), '2026-09-23 00:01');
  });
  inZone('America/Los_Angeles', () => {
    assert.equal(localDateOf('2026-09-23T03:00:00.000Z'), '2026-09-22');
  });
});

test('a runbook run shows local start, step, event and finish times', () => {
  const run = {
    id: 'run-1', documentId: 'doc-1', documentTitle: 'Failover', title: 'DR drill', status: 'completed',
    startedBy: 'user', startedAt: MOMENT, finishedAt: '2026-09-22T13:17:00.000Z', finishedBy: 'user',
    steps: [{ id: 's1', position: 0, text: 'Stop writes', checkedAt: '2026-09-22T13:10:00.000Z', checkedBy: 'user' }],
    events: [{ id: 'e1', sequence: 0, type: 'started', actor: 'user', createdAt: MOMENT }],
  };
  for (const zone of ZONES) {
    inZone(zone, () => {
      const html = renderRunHtml({}, run, { now: new Date('2026-09-22T13:20:00.000Z') });
      assert.match(html, new RegExp(`Started ${EXPECTED[zone].time} by user · 12m`), zone);
      assert.match(html, new RegExp(`${EXPECTED[zone].step} · user`), zone);
      assert.match(html, new RegExp(`Run completed at ${EXPECTED[zone].finish} by user`), zone);
      assert.match(html, new RegExp(`<time datetime="${MOMENT}">${EXPECTED[zone].time}</time>`), zone);
      assert.doesNotMatch(html, /Started 13:05/, zone);
    });
  }
});

test('the task drawer shows Activity and Snooze on the same local clock', () => {
  // The Snooze row only shows a snooze that is still in the future.
  const future = MOMENT.replace('2026', '2099');
  const task = { id: 't1', title: 'Rotate certs', status: 'planned', priority: 'medium', dueDate: null, notes: '', deferredUntil: future };
  const state = { taskNotesDraftId: null, taskTitleDraft: '', taskDescriptionDraft: '', taskNotesDraft: '', taskDraftSaveStatus: 'Saved', taskDraftRecoveryReason: null };
  for (const zone of ZONES) {
    inZone(zone, () => {
      const html = renderTaskDrawerHtml(state, task, {
        project: null, projects: [], documents: [], checklist: [], readOnly: false,
        now: new Date('2026-09-22T12:00:00.000Z'),
        activity: [{ id: 'a1', message: 'Snoozed', createdAt: future }],
      });
      const stamp = `${EXPECTED[zone].date.replace('2026', '2099')} ${EXPECTED[zone].time}`;
      assert.match(html, new RegExp(`class="timeline__when">${stamp}<`), zone);
      assert.match(html, new RegExp(`Until ${stamp}`), zone);
    });
  }
});

test('the daily brief is headed with the local date it calls "today"', () => {
  // 21:30 in New York on the 22nd is already the 23rd in UTC.
  inZone('America/New_York', () => {
    const now = new Date('2026-09-23T01:30:00.000Z');
    const md = buildDailyBrief({ tasks: [{ id: 't', title: 'Ship it', status: 'planned', priority: 'medium', dueDate: '2026-09-22' }], projects: [], documents: [] }, now);
    assert.match(md, /# Daily brief — 2026-09-22/);
    assert.match(md, /## Due today[\s\S]*Ship it/);
  });
  inZone('Australia/Lord_Howe', () => {
    const md = buildDailyBrief({ tasks: [], projects: [], documents: [] }, new Date('2026-09-22T13:31:00.000Z'));
    assert.match(md, /# Daily brief — 2026-09-23/);
  });
});

test('All projects, Library and Inbox date labels use the local calendar date', () => {
  const late = '2026-09-22T13:31:00.000Z'; // 00:01 on the 23rd in Lord Howe; 06:31 on the 22nd in LA
  const cases = { 'Australia/Lord_Howe': '2026-09-23', 'America/Los_Angeles': '2026-09-22' };
  for (const [zone, day] of Object.entries(cases)) {
    inZone(zone, () => {
      const groups = buildProjectGroups([{ id: 'p1', name: 'Homelab', status: 'active', updatedAt: late }], []);
      assert.equal(groups.flatMap((g) => g.projects)[0].updated, day, zone);

      const table = renderDocTable(
        [{ id: 'd1', title: 'Runbook', body: '', documentType: 'runbook', projectId: 'p1', tags: [], updatedAt: late }],
        { projects: [{ id: 'p1', slug: 'homelab', name: 'Homelab' }], librarySelectedDocIds: [] },
      );
      assert.match(table, new RegExp(`>${day}<`), zone);

      const dialog = renderInboxDialog({ processing: {
        kind: 'task', id: 't1', queue: [{ id: 't1' }], index: 0, draft: {},
        source: { record: { title: 'Captured', createdAt: late } },
      } });
      assert.match(dialog, new RegExp(`captured ${day}`), zone);
    });
  }
});

test('requests that need "today" carry the viewer\'s local date and IANA zone', () => {
  inZone('America/Los_Angeles', () => {
    assert.deepEqual(localDayHeaders(new Date('2026-09-23T03:00:00.000Z')), {
      'x-prax-local-date': '2026-09-22', 'x-prax-time-zone': 'America/Los_Angeles',
    });
  });
  inZone('Australia/Lord_Howe', () => {
    assert.deepEqual(localDayHeaders(new Date('2026-09-22T13:31:00.000Z')), {
      'x-prax-local-date': '2026-09-23', 'x-prax-time-zone': 'Australia/Lord_Howe',
    });
  });
});
