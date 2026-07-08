import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCaptureShorthand } from '../../public/js/captureShorthand.js';

// A fixed Wednesday so weekday math is deterministic.
const WED = new Date(2026, 6, 8); // 2026-07-08 is a Wednesday

test('extracts a ! priority sigil and strips it from the title', () => {
  assert.deepEqual(parseCaptureShorthand('Rotate TLS certs !high', WED), { priority: 'high', title: 'Rotate TLS certs' });
  assert.deepEqual(parseCaptureShorthand('!p2 patch nodes', WED), { priority: 'medium', title: 'patch nodes' });
  assert.equal(parseCaptureShorthand('drain node !lo', WED).priority, 'low');
});

test('resolves relative date keywords against now', () => {
  assert.equal(parseCaptureShorthand('deploy today', WED).dueDate, '2026-07-08');
  assert.equal(parseCaptureShorthand('deploy tomorrow', WED).dueDate, '2026-07-09');
  assert.equal(parseCaptureShorthand('review next week', WED).dueDate, '2026-07-15');
  // next Friday from a Wednesday is +2 days
  assert.equal(parseCaptureShorthand('cert rotation fri', WED).dueDate, '2026-07-10');
  // the same weekday as today jumps a full week, not today
  assert.equal(parseCaptureShorthand('weekly review wed', WED).dueDate, '2026-07-15');
});

test('accepts an explicit ISO date', () => {
  assert.deepEqual(parseCaptureShorthand('access review 2026-09-01', WED), { dueDate: '2026-09-01', title: 'access review' });
});

test('combines priority and date, in any order, stripping both', () => {
  const r = parseCaptureShorthand('!p1 failover drill friday', WED);
  assert.equal(r.priority, 'high');
  assert.equal(r.dueDate, '2026-07-10');
  assert.equal(r.title, 'failover drill');
});

test('leaves possessives and mid-word lookalikes alone', () => {
  // "Monday's" — the (?=\s|$) guard means the apostrophe blocks the match
  assert.deepEqual(parseCaptureShorthand("Review Monday's postmortem", WED), { title: "Review Monday's postmortem" });
  // "!highway" is not a priority token
  assert.deepEqual(parseCaptureShorthand('build !highway map', WED), { title: 'build !highway map' });
  // a bare title stays intact
  assert.deepEqual(parseCaptureShorthand('just a normal task', WED), { title: 'just a normal task' });
});

test('returns an empty title when the input is only modifiers', () => {
  assert.equal(parseCaptureShorthand('!high tomorrow', WED).title, '');
});
