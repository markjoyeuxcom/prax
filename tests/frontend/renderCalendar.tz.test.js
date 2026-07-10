// Regression: the calendar grid must be host-timezone-independent. Samoa
// (Pacific/Apia) skipped the entire calendar day 2011-12-30 crossing the
// international date line — local-midnight Date construction resolves that
// day to Dec 31, rendering a duplicate cell and dropping Dec 30. The grid
// now runs on UTC arithmetic, where every calendar day exists.
//
// process.env.TZ must be set before the first Date use in this process;
// node --test runs each file in its own process, so this is safe here.
process.env.TZ = 'Pacific/Apia';

const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const { buildCalendarModel } = await import('../../public/js/renderCalendar.js');

test('every grid cell is a unique, consecutive day even across the Samoa date-line skip', () => {
  const model = buildCalendarModel([], [], { month: '2011-12', now: new Date(2011, 11, 15) });
  const isos = model.weeks.flat().map((c) => c.iso);
  assert.equal(new Set(isos).size, isos.length, 'no duplicate cells');
  assert.ok(isos.includes('2011-12-30'), 'the skipped local day still gets a cell');
  // consecutive: each day is exactly +1 UTC day from the previous
  for (let i = 1; i < isos.length; i += 1) {
    const prev = Date.parse(`${isos[i - 1]}T00:00:00Z`);
    const curr = Date.parse(`${isos[i]}T00:00:00Z`);
    assert.equal(curr - prev, 86400000, `${isos[i - 1]} -> ${isos[i]}`);
  }
  assert.equal(model.label, 'December 2011');
});

test('a task due on the locally-skipped day still lands on exactly one cell', () => {
  const task = {
    id: 't1', title: 'Skipped-day task', priority: 'high', status: 'planned',
    projectId: 'p1', dueDate: '2011-12-30', dueTime: null, archivedAt: null, deferredUntil: null,
  };
  const model = buildCalendarModel([task], [], { month: '2011-12', now: new Date(2011, 11, 15) });
  const cellsWithTask = model.weeks.flat().filter((c) => c.tasks.length > 0);
  assert.equal(cellsWithTask.length, 1);
  assert.equal(cellsWithTask[0].iso, '2011-12-30');
  assert.equal(model.monthTaskCount, 1);
});
