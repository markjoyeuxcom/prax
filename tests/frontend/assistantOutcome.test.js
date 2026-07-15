import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantOutcomeNotice } from '../../public/js/assistantOutcome.js';

test('a failure before any write remains a retryable hard error', () => {
  assert.deepEqual(
    assistantOutcomeNotice({ status: 'error', error: 'provider down', didWrite: false }),
    { kind: 'error', text: 'The assistant hit an error: provider down' },
  );
  assert.match(
    assistantOutcomeNotice({ status: 'error' }).text,
    /try again/i,
  );
});

test('a committed write plus provider failure is a non-repeatable partial success', () => {
  const notice = assistantOutcomeNotice(
    { status: 'error', error: 'provider down', didWrite: true },
    { refreshed: true },
  );
  assert.equal(notice.kind, 'partial');
  assert.match(notice.text, /approved change completed/i);
  assert.match(notice.text, /workspace is refreshed/i);
  assert.match(notice.text, /do not repeat/i);
  assert.doesNotMatch(notice.text, /try again/i);
});

test('a committed write never claims refresh succeeded when refresh failed', () => {
  const notice = assistantOutcomeNotice(
    { status: 'error', error: 'provider down', didWrite: true },
    { refreshed: false },
  );
  assert.equal(notice.kind, 'partial');
  assert.match(notice.text, /reload to see the committed change/i);
  assert.match(notice.text, /do not repeat/i);
  assert.doesNotMatch(notice.text, /workspace is refreshed/i);
});

test('a normal assistant completion is quiet unless its write refresh failed', () => {
  assert.equal(assistantOutcomeNotice({ status: 'done', didWrite: true }, { refreshed: true }), null);
  const notice = assistantOutcomeNotice({ status: 'done', didWrite: true }, { refreshed: false });
  assert.equal(notice.kind, 'partial');
  assert.match(notice.text, /change completed/i);
  assert.match(notice.text, /reload/i);
});
