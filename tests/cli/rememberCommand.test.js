import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// `prax remember` end to end, against an address nothing listens on: every
// refusal below must happen before the first request, so the process exits
// with the refusal, not with "Prax not reachable".
const CLI = fileURLToPath(new URL('../../cli/prax.js', import.meta.url));

function run(args) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PRAX_API_URL: 'http://127.0.0.1:9', PRAX_PROJECT: 'demo' },
  });
  return { code: res.status, stderr: res.stderr };
}

test('remember without --body is refused before any write', () => {
  const { code, stderr } = run(['remember', 'Deploy runbook', '--project', 'demo']);
  assert.equal(code, 1);
  assert.match(stderr, /needs a non-empty --body/);
  assert.doesNotMatch(stderr, /not reachable/);
});

test('remember with a blank --body is refused', () => {
  const { code, stderr } = run(['remember', 'Deploy runbook', '--body', '   ']);
  assert.equal(code, 1);
  assert.match(stderr, /needs a non-empty --body/);
});

test('a --body value that starts with -- is refused with the --body= hint instead of becoming empty', () => {
  const { code, stderr } = run(['remember', 'Deploy runbook', '--body', '--dry-run is required before step 1']);
  assert.equal(code, 1);
  assert.match(stderr, /--body needs a value; for text that starts with "--" write --body="<text>"/);
});

test('--body=<text> passes a value that starts with -- (and then only fails on the unreachable server)', () => {
  const { code, stderr } = run(['remember', 'Deploy runbook', '--body=--dry-run is required', '--project', 'demo']);
  assert.equal(code, 1);
  assert.match(stderr, /not reachable/);
});

test('bare --tag, --type, --ref, --cite and --id are refused rather than skipped', () => {
  for (const flag of ['--tag', '--type', '--ref', '--cite', '--id']) {
    const { code, stderr } = run(['remember', 'T', '--body', 'B', flag]);
    assert.equal(code, 1, flag);
    assert.match(stderr, new RegExp(`${flag} needs a value`), flag);
  }
});
