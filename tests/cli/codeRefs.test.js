// Code-pinned memory: tie a claim to the code it describes, so the repository
// itself can say when the claim stopped being true.
//
// A memory is an assertion about a system ("a non-loopback bind requires an
// explicit acknowledgement"). Today nothing connects that sentence to
// server/config.js, so the only way to find out it has rotted is for a human to
// notice. Pinning the claim to a file range and a content hash turns staleness
// detection into `git`: deterministic, free, and impossible for a hosted memory
// service to copy, because it is not sitting in the repository.
//
// Line numbers drift when code above them is edited, so a naive range check
// would cry stale on every unrelated insertion. checkCitation therefore
// re-finds the cited content by hashing equal-length windows — which detects a
// MOVE without ever copying the source into the memory store.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCitation, sliceLines, hashCitation, checkCitation } from '../../cli/lib/codeRefs.js';

const FILE = ['alpha', 'bravo', 'charlie', 'delta', 'echo'].join('\n');

// --- parsing ------------------------------------------------------------------

test('parseCitation accepts a bare path, a single line and a range', () => {
  assert.deepEqual(parseCitation('server/config.js'), { path: 'server/config.js', startLine: null, endLine: null });
  assert.deepEqual(parseCitation('server/config.js:12'), { path: 'server/config.js', startLine: 12, endLine: 12 });
  assert.deepEqual(parseCitation('server/config.js:12-36'), { path: 'server/config.js', startLine: 12, endLine: 36 });
});

test('parseCitation tolerates a path containing colons only in the line suffix', () => {
  assert.deepEqual(parseCitation('a/b-c.d.js:3-4'), { path: 'a/b-c.d.js', startLine: 3, endLine: 4 });
});

test('parseCitation rejects nonsense rather than guessing', () => {
  assert.throws(() => parseCitation(''), /citation/i);
  assert.throws(() => parseCitation('file.js:0'), /line/i);
  assert.throws(() => parseCitation('file.js:9-3'), /before/i);
  assert.throws(() => parseCitation('/etc/passwd'), /relative/i);
  assert.throws(() => parseCitation('../outside.js'), /relative/i);
});

// --- slicing and hashing --------------------------------------------------------

test('sliceLines takes an inclusive 1-based range, and the whole file when unbounded', () => {
  assert.equal(sliceLines(FILE, 2, 3), 'bravo\ncharlie');
  assert.equal(sliceLines(FILE, 1, 1), 'alpha');
  assert.equal(sliceLines(FILE, null, null), FILE);
});

test('sliceLines returns null when the range runs past the end of the file', () => {
  assert.equal(sliceLines(FILE, 4, 99), null);
  assert.equal(sliceLines(FILE, 99, 99), null);
});

test('hashing ignores line-ending style, so a CRLF checkout is not a false alarm', () => {
  assert.equal(hashCitation('a\r\nb'), hashCitation('a\nb'));
});

test('hashing is sensitive to the content itself', () => {
  assert.notEqual(hashCitation('a\nb'), hashCitation('a\nc'));
});

// --- the check ------------------------------------------------------------------

const ref = (over = {}) => ({ path: 'f.js', startLine: 2, endLine: 3, contentHash: hashCitation('bravo\ncharlie'), ...over });

test('unchanged code reports current', () => {
  assert.deepEqual(checkCitation(ref(), FILE), { status: 'current', startLine: 2, endLine: 3 });
});

test('a deleted file reports missing, never current', () => {
  assert.deepEqual(checkCitation(ref(), null), { status: 'missing', startLine: 2, endLine: 3 });
});

test('edited code reports changed — the memory may have rotted', () => {
  const edited = ['alpha', 'bravo', 'CHARLIE HAS CHANGED', 'delta'].join('\n');
  assert.equal(checkCitation(ref(), edited).status, 'changed');
});

test('code that merely MOVED reports moved, with its new location', () => {
  // Two lines inserted above: a naive range check would call this stale.
  const shifted = ['new', 'lines', 'alpha', 'bravo', 'charlie', 'delta'].join('\n');
  assert.deepEqual(checkCitation(ref(), shifted), { status: 'moved', startLine: 4, endLine: 5 });
});

test('a whole-file citation tracks the whole file', () => {
  const whole = { path: 'f.js', startLine: null, endLine: null, contentHash: hashCitation(FILE) };
  assert.equal(checkCitation(whole, FILE).status, 'current');
  assert.equal(checkCitation(whole, `${FILE}\nextra`).status, 'changed');
});

test('an empty file does not match a non-empty citation', () => {
  assert.equal(checkCitation(ref(), '').status, 'changed');
});

// --- resolving a citation at capture time -----------------------------------------

import { resolveCitation, describeCitationStatus } from '../../cli/lib/codeRefs.js';

const reader = (files) => (path) => (path in files ? files[path] : null);

test('resolveCitation pins the cited content and records where it was taken', () => {
  const pin = resolveCitation('f.js:2-3', { readFile: reader({ 'f.js': FILE }), headSha: 'deadbeef' });
  assert.deepEqual(pin, {
    path: 'f.js', startLine: 2, endLine: 3,
    contentHash: hashCitation('bravo\ncharlie'), commitSha: 'deadbeef',
  });
});

test('resolveCitation works without a commit, because a citation is content-based', () => {
  const pin = resolveCitation('f.js', { readFile: reader({ 'f.js': FILE }) });
  assert.equal(pin.commitSha, null);
  assert.equal(pin.contentHash, hashCitation(FILE));
});

test('resolveCitation refuses to pin a file that is not there', () => {
  assert.throws(() => resolveCitation('nope.js', { readFile: reader({}) }), /not found|nope\.js/i);
});

test('resolveCitation refuses a range the file does not reach, rather than pinning a short slice', () => {
  assert.throws(() => resolveCitation('f.js:4-99', { readFile: reader({ 'f.js': FILE }) }), /lines? 4-99|only 5/i);
});

// --- how a status is shown ---------------------------------------------------------

test('only a real divergence is worded as a warning', () => {
  assert.equal(describeCitationStatus({ status: 'current' }, { path: 'a.js' }), '');
  assert.match(describeCitationStatus({ status: 'changed' }, { path: 'a.js' }), /a\.js changed/);
  assert.match(describeCitationStatus({ status: 'missing' }, { path: 'a.js' }), /a\.js is gone/);
  // A move is not rot: say where it went, without the alarm.
  assert.match(describeCitationStatus({ status: 'moved', startLine: 9, endLine: 10 }, { path: 'a.js' }), /moved to a\.js:9-10/);
});
