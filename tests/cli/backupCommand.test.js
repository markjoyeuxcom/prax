import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBackupHistory, formatBackupRun, formatBackupStatus, runBackup } from '../../cli/lib/backupCommand.js';

function harness(overrides = {}) {
  const calls = [];
  const lines = [];
  const client = {
    gitBackupStatus: async () => { calls.push(['status']); return overrides.status ?? { configured: false, gitAvailable: true, gitVersion: 'git version 2.56.0', lastBackup: null }; },
    gitBackupRun: async () => { calls.push(['run']); return overrides.run ?? { changed: true, commit: 'a'.repeat(40), bytes: 2 * 1024 * 1024, branch: 'main', remote: 'git@gitlab.com:g/b.git', large: false }; },
    gitBackupHistory: async (options) => { calls.push(['history', options]); return overrides.history ?? { branch: 'main', backups: [] }; },
    gitBackupRestore: async (commit) => { calls.push(['restore', commit]); return { commit, backupCreatedAt: '2026-10-24T10:00:00Z', bytes: 4096 }; },
  };
  return { calls, lines, client, out: (text) => lines.push(typeof text === 'string' ? text : JSON.stringify(text)) };
}

test('prax backup pushes a backup and says what it did', async () => {
  const h = harness();
  await runBackup({ positionals: ['backup'], flags: {}, client: h.client, out: h.out });
  assert.deepEqual(h.calls, [['run']]);
  assert.match(h.lines[0], /Backed up 2\.0 MB as commit aaaaaaaaaaaa on main/);
  const unchanged = harness({ run: { changed: false, commit: 'b'.repeat(40) } });
  await runBackup({ positionals: ['backup'], flags: {}, client: unchanged.client, out: unchanged.out });
  assert.match(unchanged.lines[0], /Nothing changed since the last backup \(bbbbbbbbbbbb\)/);
});

test('prax backup status, list and restore use the right routes and guard the restore with --yes', async () => {
  const h = harness({ history: { branch: 'main', backups: [{ commit: 'c'.repeat(40), at: '2026-10-25T10:00:00Z', bytes: 4096, praxVersion: '0.47.0' }] } });
  await runBackup({ positionals: ['backup', 'status'], flags: {}, client: h.client, out: h.out });
  assert.match(h.lines[0], /not configured/);
  await runBackup({ positionals: ['backup', 'list'], flags: { limit: '5' }, client: h.client, out: h.out });
  assert.deepEqual(h.calls[1], ['history', { limit: 5 }]);
  assert.match(h.lines[1], /^cccccccccccc  2026-10-25 10:00 UTC  4 KB  v0\.47\.0$/m);
  const before = process.exitCode;
  await runBackup({ positionals: ['backup', 'restore', 'ccccccc'], flags: {}, client: h.client, out: h.out });
  assert.equal(process.exitCode, 1);
  process.exitCode = before;
  assert.ok(!h.calls.some(([name]) => name === 'restore'));
  assert.match(h.lines[2], /--yes/);
  await runBackup({ positionals: ['backup', 'restore', 'ccccccc'], flags: { yes: true }, client: h.client, out: h.out });
  assert.deepEqual(h.calls.at(-1), ['restore', 'ccccccc']);
  assert.match(h.lines[3], /Restore staged from commit ccccccc/);
  await assert.rejects(runBackup({ positionals: ['backup', 'nope'], flags: {}, client: h.client, out: h.out }), /Unknown backup subcommand/);
  await assert.rejects(runBackup({ positionals: ['backup', 'restore'], flags: { yes: true }, client: h.client, out: h.out }), /needs a commit id/);
});

test('formatters cover the configured, failed and staged states', () => {
  const status = formatBackupStatus({
    configured: true, remote: 'https://github.com/me/b.git', branch: 'main', auth: 'token', hasToken: true, scheduleEnabled: true,
    lastScheduledRunAt: '2026-10-25T01:00:00Z', gitAvailable: true, gitVersion: 'git version 2.56.0',
    lastBackup: { at: '2026-10-25T01:00:01Z', error: { message: 'The repository refused the credentials.' } },
    pendingRestore: { commit: 'd'.repeat(40), backupCreatedAt: '2026-10-24T10:00:00Z' },
    lastRestore: { ok: false, appliedAt: '2026-10-23T10:00:00Z', error: 'newer Prax' },
  });
  assert.match(status, /token saved/);
  assert.match(status, /Daily backup: on/);
  assert.match(status, /Last backup: failed .* refused the credentials/);
  assert.match(status, /Restore staged: commit dddddddddddd/);
  assert.match(status, /Last restore: failed .* newer Prax/);
  assert.match(formatBackupRun({ changed: true, commit: 'e'.repeat(40), bytes: 95 * 1024 * 1024, branch: 'main', remote: 'r', large: true }), /near the hosting limit/);
  assert.equal(formatBackupHistory({ branch: 'main', backups: [] }), 'No backups on main yet.');
});
