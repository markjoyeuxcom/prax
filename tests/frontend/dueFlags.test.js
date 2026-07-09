import test from 'node:test';
import assert from 'node:assert/strict';
import { dueFlag, dueBucket } from '../../public/js/dueFlags.js';

// Fixed clock: Monday 2026-07-06 (any time of day must not matter).
const NOW = new Date('2026-07-06T09:30:00');

test('no due date yields no flag and bucket none', () => {
  assert.equal(dueFlag(null, { now: NOW }), null);
  assert.equal(dueFlag('', { now: NOW }), null);
  assert.equal(dueBucket(null, { now: NOW }), 'none');
});

test('past dates are overdue with the date in the label', () => {
  const flag = dueFlag('2026-07-04', { now: NOW });
  assert.equal(flag.bucket, 'overdue');
  assert.equal(flag.label, 'Jul 4 · overdue');
});

test('same-day is today with the literal Today label', () => {
  const flag = dueFlag('2026-07-06', { now: NOW });
  assert.equal(flag.bucket, 'today');
  assert.equal(flag.label, 'Today');
});

test('within three days is soon, beyond is later', () => {
  assert.equal(dueFlag('2026-07-07', { now: NOW }).bucket, 'soon');
  assert.equal(dueFlag('2026-07-09', { now: NOW }).bucket, 'soon');
  assert.equal(dueFlag('2026-07-10', { now: NOW }).bucket, 'later');
  assert.equal(dueFlag('2026-07-10', { now: NOW }).label, 'Jul 10');
});

test('completed tasks always render the muted done bucket', () => {
  assert.equal(dueFlag('2026-07-01', { done: true, now: NOW }).bucket, 'done');
  assert.equal(dueFlag('2026-07-20', { done: true, now: NOW }).bucket, 'done');
  // label keeps the plain date, no overdue suffix
  assert.equal(dueFlag('2026-07-01', { done: true, now: NOW }).label, 'Jul 1');
});

test('evening clock does not shift the bucket boundaries', () => {
  const evening = new Date('2026-07-06T23:45:00');
  assert.equal(dueFlag('2026-07-06', { now: evening }).bucket, 'today');
  assert.equal(dueFlag('2026-07-07', { now: evening }).bucket, 'soon');
});

test('malformed dates yield no flag rather than NaN labels', () => {
  assert.equal(dueFlag('not-a-date', { now: NOW }), null);
});

test('dueFlag appends a dueTime to the label, keeping the date-only bucket', () => {
  const today = dueFlag('2026-07-06', { now: NOW, dueTime: '12:00' });
  assert.deepEqual(today, { label: 'Today 12:00', bucket: 'today' });

  const overdue = dueFlag('2026-07-05', { now: NOW, dueTime: '09:00' });
  assert.equal(overdue.bucket, 'overdue');
  assert.match(overdue.label, /Jul 5 09:00 · overdue/);

  // no dueTime → unchanged label
  assert.equal(dueFlag('2026-07-06', { now: NOW }).label, 'Today');
});
