import test from 'node:test';
import assert from 'node:assert/strict';
import {
  memoryDelta, planDelta, formatDelta, recordDelta, parseSince, DeltaError,
} from '../../cli/lib/delta.js';

const NOW = new Date('2026-09-23T12:00:00Z');

const ITEMS = [
  {
    id: 'old', title: 'Old pooler', documentType: 'note', status: 'superseded', verified: false, projectSlug: 'homelab',
    changes: ['superseded'], supersededBy: ['new'], changedAt: '2026-09-22T10:00:00.000Z', snippet: 'Old body.', updatedAt: '2026-09-22T10:00:00.000Z',
  },
  {
    id: 'new', title: 'New pooler', documentType: 'note', status: 'active', verified: false, projectSlug: 'homelab',
    changes: ['created'], supersededBy: [], changedAt: '2026-09-22T09:00:00.000Z', snippet: 'New body.', updatedAt: '2026-09-22T09:00:00.000Z', updatedBy: 'agent', updatedByAgent: 'codex',
  },
  {
    id: 'rb', title: 'Restore runbook', documentType: 'runbook', status: 'active', verified: true, verifiedBy: 'mark', projectSlug: 'homelab',
    changes: ['verified'], supersededBy: [], changedAt: '2026-09-21T09:00:00.000Z', snippet: 'Runbook body.', updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

function client({ agent = 'claude', response = {}, failMarker = false } = {}) {
  const calls = { changes: [], marker: [] };
  return {
    agent,
    calls,
    memoryChanges: async (args) => {
      calls.changes.push(args);
      return {
        agent, project: null, baseline: args.sinceLastSession ? 'marker' : 'explicit', since: '2026-09-20T00:00:00.000Z',
        until: '2026-09-22T10:00:00.000Z', items: ITEMS, page: { returned: 3, total: 3, hasMore: false, limit: 50 }, ...response,
      };
    },
    advanceRecallMarker: async (args) => {
      calls.marker.push(args);
      if (failMarker) throw new Error('Prax not reachable');
      return { lastRecallAt: args.at };
    },
    listProjects: async () => [],
    listCodeRefs: async () => [],
  };
}

test('parseSince accepts ISO dates and date-times only', () => {
  assert.equal(parseSince('2026-09-20'), '2026-09-20T00:00:00.000Z');
  assert.equal(parseSince('2026-09-20T10:00:00Z'), '2026-09-20T10:00:00.000Z');
  assert.equal(parseSince('last week'), null);
  assert.equal(parseSince(''), null);
});

test('the delta needs exactly one window, and an agent for since-last-session', async () => {
  await assert.rejects(memoryDelta(client(), {}), DeltaError);
  await assert.rejects(memoryDelta(client(), { since: '2026-01-01T00:00:00.000Z', sinceLastSession: true }), DeltaError);
  await assert.rejects(memoryDelta(client({ agent: null }), { sinceLastSession: true }), /needs an agent id/);
});

test('an old server without the changes route is named, not guessed around', async () => {
  const c = client();
  c.memoryChanges = async () => { const e = new Error('HTTP 404'); e.status = 404; throw e; };
  await assert.rejects(memoryDelta(c, { sinceLastSession: true }), /predates the memory delta/);
});

test('the delta is fill-ordered: verified first, then the rest by the time of the change', async () => {
  const c = client();
  const result = await memoryDelta(c, { sinceLastSession: true, project: 'homelab', limit: 10 });
  assert.deepEqual(c.calls.changes, [{ since: undefined, sinceLastSession: true, project: 'homelab', limit: 10 }]);
  assert.deepEqual(result.items.map((i) => i.id), ['rb', 'old', 'new']);
  assert.deepEqual(result.items.map((i) => i.tier), ['verified', 'recent', 'recent']);
  const text = formatDelta(result, { now: NOW });
  assert.match(text, /^# Memory changes since the last delta for claude \(all projects\)/);
  assert.match(text, /_Window: 2026-09-20T00:00:00.000Z → 2026-09-22T10:00:00.000Z · 3 changes_/);
  assert.match(text, /## \[verified\] Restore runbook {2}\(runbook · rb · in homelab · changed: verified · verified by mark/);
  // A retired row prints as one line with what replaced it, never its old body as current.
  assert.match(text, /^- \[superseded\] Old pooler \(note · old · changed: superseded · superseded by new\) — Old body\.$/m);
  assert.match(text, /unverifications and permanent deletions are not tracked/);
});

test('the first delta sets a baseline and says so', () => {
  const text = formatDelta({
    kind: 'delta', agent: 'claude', project: null, baseline: 'none', since: null, until: '2026-09-23T12:00:00.000Z', items: [], page: null,
  }, { now: NOW });
  assert.match(text, /^No earlier delta recorded for agent "claude" \(all projects\); baseline set at 2026-09-23T12:00:00.000Z/);
});

test('a budget that leaves changes out holds the marker and says so', async () => {
  const result = await memoryDelta(client(), { sinceLastSession: true });
  const tight = planDelta(result, 80, NOW);
  assert.equal(tight.advance, false);
  assert.ok(tight.summary.omitted.total > 0);
  assert.match(tight.text, /marker not advanced: changes were left out by the budget/);
  const roomy = planDelta(result, 5000, NOW);
  assert.equal(roomy.advance, true);
  assert.doesNotMatch(roomy.text, /marker not advanced/);
  // An explicit --since never advances anything.
  const explicit = await memoryDelta(client(), { since: '2026-09-20T00:00:00.000Z' });
  assert.equal(planDelta(explicit, Infinity, NOW).advance, false);
});

test('recordDelta advances the marker to the end of the delta, fail-soft', async () => {
  const c = client();
  const result = await memoryDelta(c, { sinceLastSession: true, project: 'homelab' });
  assert.deepEqual(await recordDelta(c, result, { project: 'homelab' }), { marked: true });
  assert.deepEqual(c.calls.marker, [{ project: 'homelab', at: '2026-09-22T10:00:00.000Z' }]);

  const failing = client({ failMarker: true });
  const outcome = await recordDelta(failing, await memoryDelta(failing, { sinceLastSession: true }));
  assert.equal(outcome.marked, false);
  assert.match(outcome.error.message, /not reachable/);

  const explicit = client();
  assert.deepEqual(await recordDelta(explicit, await memoryDelta(explicit, { since: '2026-09-20T00:00:00.000Z' })), { marked: false });
  assert.deepEqual(explicit.calls.marker, []);
});
