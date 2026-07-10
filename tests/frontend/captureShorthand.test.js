import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCaptureShorthand, mergeNlCapture } from '../../public/js/captureShorthand.js';

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

test('extracts repeatable @labels and a #project, stripping them from the title', () => {
  const r = parseCaptureShorthand('deploy audit #homelab @cert @waiting !high fri', WED);
  assert.equal(r.title, 'deploy audit');
  assert.equal(r.project, 'homelab');
  assert.deepEqual(r.labels, ['cert', 'waiting']);
  assert.equal(r.priority, 'high');
  assert.equal(r.dueDate, '2026-07-10');
});

test('#project keeps the last one; @labels dedupe + lowercase', () => {
  const r = parseCaptureShorthand('thing #a #b @Cert @cert', WED);
  assert.equal(r.project, 'b');
  assert.deepEqual(r.labels, ['cert']);
});

test('leaves emails and c# alone (leading-boundary guard)', () => {
  assert.deepEqual(parseCaptureShorthand('email foo@bar.com about c#', WED), { title: 'email foo@bar.com about c#' });
  // a leading @/# still tokenizes
  assert.equal(parseCaptureShorthand('#work fix it', WED).project, 'work');
});

// ---- mergeNlCapture (Tier-3 #8): sigiled tokens override the model ----------

test('mergeNlCapture: sigiled tokens (!, #, @, ISO date) win over model fields', () => {
  const merged = mergeNlCapture('rotate certs !low #work @cert 2026-08-01', {
    title: 'Rotate certs', priority: 'high', project: 'homelab', dueDate: '2026-07-17', labels: ['tls'],
  }, WED);
  assert.equal(merged.priority, 'low');       // ! sigil beats the model
  assert.equal(merged.project, 'work');       // #project beats the model
  assert.equal(merged.dueDate, '2026-08-01'); // explicit ISO beats the model
  assert.deepEqual(merged.labels, ['cert', 'tls']); // union, sigils first
  assert.equal(merged.title, 'Rotate certs'); // model title kept
});

test('mergeNlCapture: keyword dates are the model\'s job — bare "friday" must NOT override', () => {
  // "next friday" contains the bare-weekday token; honoring it would resolve to
  // THIS Friday. The model already resolved the full phrase.
  const merged = mergeNlCapture('pay rent next friday', { title: 'Pay rent', dueDate: '2026-07-17' }, WED);
  assert.equal(merged.dueDate, '2026-07-17');
});

test('mergeNlCapture: falls back to the sigil-stripped text when the model gave no title', () => {
  const merged = mergeNlCapture('patch nodes !high', {}, WED);
  assert.equal(merged.title, 'patch nodes');
  assert.equal(merged.priority, 'high');
});

test('mergeNlCapture: drops dueTime when no dueDate survives', () => {
  const merged = mergeNlCapture('take tablet', { title: 'Take tablet', dueTime: '12:00' }, WED);
  assert.equal(merged.dueTime, undefined);
  const kept = mergeNlCapture('take tablet', { title: 'Take tablet', dueDate: '2026-07-09', dueTime: '12:00' }, WED);
  assert.equal(kept.dueTime, '12:00');
});

test('mergeNlCapture: the title fallback keeps date KEYWORDS (only sigils are stripped)', () => {
  // parseCaptureShorthand would delete the bare "friday"/"today" from the
  // title while this path ignores its keyword date — the word must survive.
  assert.equal(mergeNlCapture('prep friday retro agenda', { title: '' }, WED).title, 'prep friday retro agenda');
  assert.equal(mergeNlCapture('summarize today standup !low', { title: '' }, WED).title, 'summarize today standup');
});
