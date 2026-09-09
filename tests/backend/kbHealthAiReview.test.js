import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';
import { createFakeChat } from '../../server/chat/fake.js';

const A = { id: 'a', title: 'Runbook A', documentType: 'runbook', verified: true, body: 'Always restart the node on OOM.' };
const B = { id: 'b', title: 'Runbook B', documentType: 'note', verified: false, body: 'Never restart the node on OOM; drain it first.' };

// A chat that answers the contradiction prompt vs the gap prompt differently,
// discriminating on the system prompt's headline word.
function scriptChat({ contradiction, gaps, onCall } = {}) {
  return {
    model: 'scripted', backend: 'scripted',
    async complete(messages) {
      const sys = messages[0]?.content || '';
      if (onCall) onCall(messages);
      if (/for CONTRADICTIONS/.test(sys)) return { text: contradiction ?? '{"contradicts":false}', model: 'scripted' };
      if (/for COVERAGE GAPS/.test(sys)) return { text: gaps ?? '{"gaps":[]}', model: 'scripted' };
      return { text: '{}', model: 'scripted' };
    },
    async isAvailable() { return true; },
  };
}

function makeApp({ chat, embedder = { backend: 'fake' }, docs = [A, B], similar, listTasks } = {}) {
  return buildApp({
    skipDb: true,
    chat: chat === undefined ? scriptChat() : chat,
    embedder,
    libraryRepository: {
      listDocuments: async () => docs,
      findSimilarDocuments: async (id) => (similar ? similar(id) : (id === 'a' ? [{ id: 'b', similarity: 0.9 }] : [{ id: 'a', similarity: 0.9 }])),
    },
    tasksRepository: { listTasks: listTasks || (async () => []) },
    projectsRepository: { resolveProject: async () => null },
    appSettingsRepository: { async getSetting(_k, fb) { return fb; }, async putSetting() {} }, // → semanticEnabled() true
    documentLinksRepository: { listStaleDocuments: async () => [], listOutboundLinksForDocuments: async () => new Map() },
  });
}

const post = (app, payload = {}) => app.inject({ method: 'POST', url: '/api/library/health/ai-review', payload });

test('happy path: a grounded contradiction + gaps, with stats', async () => {
  const app = await makeApp({
    chat: scriptChat({
      contradiction: JSON.stringify({ contradicts: true, severity: 'high', issue: 'restart vs never', quoteA: 'Always restart the node on OOM.', quoteB: 'Never restart the node on OOM; drain it first.' }),
      gaps: JSON.stringify({ gaps: [{ topic: 'Failover drills', rationale: 'tasks imply it', evidence: 'open work' }] }),
    }),
  });
  const { statusCode } = await post(app);
  const b = (await post(app)).json();
  assert.equal(statusCode, 200);
  assert.equal(b.degraded, false);
  assert.equal(b.contradictions.length, 1);
  assert.equal(b.contradictions[0].severity, 'high');
  assert.equal(b.contradictions[0].a.quote, 'Always restart the node on OOM.');
  assert.equal(b.contradictions[0].b.quote, 'Never restart the node on OOM; drain it first.');
  assert.equal(b.gaps.length, 1);
  assert.equal(b.gaps[0].topic, 'Failover drills');
  assert.equal(b.contradictionScan.ran, true);
  assert.equal(b.gapScan.ran, true);
  assert.equal(b.stats.pairsJudged, 1);
  assert.equal(b.stats.contradictionsFound, 1);
  assert.equal(b.model, 'scripted');
  await app.close();
});

test('grounding gate drops a contradiction whose quote is not in the body', async () => {
  const app = await makeApp({
    chat: scriptChat({ contradiction: JSON.stringify({ contradicts: true, severity: 'high', issue: 'x', quoteA: 'THIS SENTENCE IS FABRICATED', quoteB: 'ALSO NOT PRESENT' }) }),
  });
  const b = (await post(app)).json();
  assert.equal(b.contradictions.length, 0);
  assert.equal(b.stats.contradictionsFound, 0);
  assert.equal(b.stats.pairsJudged, 1); // it was judged, just not kept
  await app.close();
});

test('cost is bounded: ≤ MAX_PAIRS judgments + 1 gap call, no pair judged twice', async () => {
  // 8 mutually-similar docs → many raw pairs, but caps + dedupe bound it
  const docs = Array.from({ length: 8 }, (_, i) => ({ id: `d${i}`, title: `D${i}`, documentType: 'note', verified: true, body: `body ${i}` }));
  const seen = [];
  const app = await makeApp({
    docs,
    similar: (id) => docs.filter((d) => d.id !== id).slice(0, 3).map((d) => ({ id: d.id, similarity: 0.9 })),
    chat: scriptChat({ onCall: (m) => { if (/for CONTRADICTIONS/.test(m[0].content)) seen.push(m[1].content.match(/"([^"]+)"/g)?.slice(0, 2).sort().join('|')); } }),
  });
  const b = (await post(app)).json();
  assert.ok(b.stats.pairsJudged <= 12, `pairsJudged ${b.stats.pairsJudged} > 12`);
  const uniq = new Set(seen);
  assert.equal(uniq.size, seen.length, 'a pair was judged more than once');
  await app.close();
});

test('the deterministic fake chat degrades cleanly (unparseable → no findings, no crash)', async () => {
  const app = await makeApp({ chat: createFakeChat() }); // echoes "[fake-chat] …", not JSON
  const b = (await post(app)).json();
  assert.equal(b.degraded, false);           // embedder present, scan ran, just found nothing
  assert.equal(b.contradictions.length, 0);
  assert.equal(b.gaps.length, 0);
  assert.equal(b.contradictionScan.ran, true);
  assert.equal(b.gapScan.ran, true);
  await app.close();
});

test('no chat model → fully degraded, zero token spend', async () => {
  const app = await makeApp({ chat: null });
  const b = (await post(app)).json();
  assert.equal(b.degraded, true);
  assert.equal(b.reason, 'no-chat-model');
  assert.equal(b.contradictionScan.ran, false);
  assert.equal(b.gapScan.ran, false);
  await app.close();
});

test('no embedder → contradiction scan skipped, gaps still run', async () => {
  const app = await makeApp({ embedder: null, chat: scriptChat({ gaps: JSON.stringify({ gaps: [{ topic: 'X' }] }) }) });
  const b = (await post(app)).json();
  assert.equal(b.contradictionScan.reason, 'no-embedder');
  assert.equal(b.contradictions.length, 0);
  assert.equal(b.degraded, true);       // a capability was missing
  assert.equal(b.gaps.length, 1);       // gaps unaffected
  assert.equal(b.gapScan.ran, true);
  await app.close();
});

test('candidate generation throwing degrades to embed-failed, gaps still run', async () => {
  const app = await makeApp({
    similar: () => { throw new Error('reindex in progress'); },
    chat: scriptChat({ gaps: JSON.stringify({ gaps: [{ topic: 'X' }] }) }),
  });
  const b = (await post(app)).json();
  assert.equal(b.contradictionScan.reason, 'embed-failed');
  assert.equal(b.contradictions.length, 0);
  assert.equal(b.gaps.length, 1);
  await app.close();
});

test('gap call throwing → gaps empty, generation-failed, contradictions unaffected', async () => {
  const app = await makeApp({
    chat: {
      model: 's', backend: 's',
      async complete(m) {
        if (/for COVERAGE GAPS/.test(m[0].content)) throw new Error('gap boom');
        return { text: JSON.stringify({ contradicts: true, severity: 'low', issue: 'i', quoteA: 'Always restart the node on OOM.', quoteB: 'Never restart the node on OOM; drain it first.' }), model: 's' };
      },
      async isAvailable() { return true; },
    },
  });
  const b = (await post(app)).json();
  assert.equal(b.gaps.length, 0);
  assert.equal(b.gapScan.reason, 'generation-failed');
  assert.equal(b.contradictions.length, 1); // unaffected
  await app.close();
});

test('empty library → no findings, zero chat calls', async () => {
  let calls = 0;
  const app = await makeApp({ docs: [], chat: { model: 's', backend: 's', async complete() { calls += 1; return { text: '{}', model: 's' }; }, async isAvailable() { return true; } } });
  const b = (await post(app)).json();
  assert.equal(b.degraded, false);
  assert.equal(b.stats.documentsScanned, 0);
  assert.equal(calls, 0); // short-circuit, no tokens spent
  await app.close();
});

test('per-pair chat throw skips only that pair; gaps still run', async () => {
  const app = await makeApp({
    chat: {
      model: 's', backend: 's',
      async complete(m) {
        if (/for CONTRADICTIONS/.test(m[0].content)) throw new Error('one pair boom');
        return { text: JSON.stringify({ gaps: [{ topic: 'G' }] }), model: 's' };
      },
      async isAvailable() { return true; },
    },
  });
  const b = (await post(app)).json();
  assert.equal(b.contradictions.length, 0);
  assert.equal(b.gaps.length, 1);        // gaps ran despite the pair throwing
  await app.close();
});

// ---- review-hardening regressions -----------------------------------------

test('all pair judgments failing → degraded judge-failed, not a false all-clear', async () => {
  const app = await makeApp({
    chat: {
      model: 's', backend: 's',
      async complete(m) {
        if (/for CONTRADICTIONS/.test(m[0].content)) throw new Error('chat down');
        return { text: JSON.stringify({ gaps: [{ topic: 'G' }] }), model: 's' };
      },
      async isAvailable() { return true; },
    },
  });
  const b = (await post(app)).json();
  assert.equal(b.contradictionScan.reason, 'judge-failed');
  assert.equal(b.contradictionScan.degraded, true);
  assert.equal(b.degraded, true);          // surfaces at the top level, not "clean"
  assert.equal(b.contradictions.length, 0);
  assert.equal(b.gaps.length, 1);          // gaps still ran
  await app.close();
});

test('project resolution throwing degrades to a 200 (never 500)', async () => {
  const app = await buildApp({
    skipDb: true,
    chat: scriptChat(),
    embedder: { backend: 'fake' },
    libraryRepository: { listDocuments: async () => [A, B], findSimilarDocuments: async () => [] },
    tasksRepository: { listTasks: async () => [] },
    projectsRepository: { async resolveProject() { throw new Error('db down'); } },
    appSettingsRepository: { async getSetting(_k, fb) { return fb; }, async putSetting() {} },
    documentLinksRepository: { listStaleDocuments: async () => [], listOutboundLinksForDocuments: async () => new Map() },
  });
  const res = await app.inject({ method: 'POST', url: '/api/library/health/ai-review', payload: { project: 'homelab' } });
  assert.equal(res.statusCode, 200); // NOT 500
  const b = res.json();
  assert.equal(b.degraded, true);
  assert.equal(b.reason, 'ai-review-failed');
  await app.close();
});
