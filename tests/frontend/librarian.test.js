// Librarian UI (spec 2026-09-23): the Library health card, the opt-in recall
// sort in the review queue and in Needs review, and the controller actions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderHealthHtml, librarianSection } from '../../public/js/renderHealth.js';
import { sortDocuments } from '../../public/js/libraryFilters.js';
import { buildLibraryModel, librarySortLabel, nextLibrarySort } from '../../public/js/renderLibrary.js';
import { createKnowledgeToolsController } from '../../public/js/knowledgeToolsController.js';

const health = { needsReview: [], empty: [], stale: [], counts: {} };
const base = (over = {}) => ({
  healthData: health, healthLinkSuggestions: [], healthLoading: false, chatStatus: { available: false },
  healthAiReview: null, healthAiReviewLoading: false, healthAiReviewError: null, ...over,
});

const PROPOSAL = {
  documentId: '11111111-1111-4111-8111-111111111111', title: 'Proposal: consolidate “Restore” (+1)',
  sourceIds: ['a', 'b'], method: 'shingle', verified: false,
};

test('the Librarian card: run, schedule, proposals, gaps and prune candidates', () => {
  const html = librarianSection(base({
    librarian: {
      proposals: [PROPOSAL, { ...PROPOSAL, documentId: '22222222-2222-4222-8222-222222222222', verified: true }],
      gaps: { items: [{ query: 'how do we rotate <tls> certs', reason: 'no-hits', occurrences: 3, agents: ['claude'] }], usedSignals: 0 },
      prune: { ready: false, coverageDays: 4, minAgeDays: 30, items: [] },
      settings: { scheduleEnabled: true, telemetryEnabled: true },
    },
  }));
  assert.match(html, /data-action="run-librarian"/);
  assert.match(html, /data-action="toggle-librarian-schedule" checked/);
  // An unverified proposal offers Review (the walk), a verified one Approve.
  assert.match(html, /data-action="verify-health-doc" data-doc-id="11111111-1111-4111-8111-111111111111"/);
  assert.match(html, /data-decision="approve" data-proposal-id="22222222-2222-4222-8222-222222222222"/);
  assert.equal(html.match(/data-decision="dismiss"/g).length, 2);
  assert.match(html, /Nothing is merged or retired until you verify a proposal and approve it/);
  assert.match(html, /how do we rotate &lt;tls&gt; certs/);
  assert.match(html, /asked 3× · no hits · claude/);
  assert.match(html, /prax used &lt;id&gt;/, 'without used signals the card explains why only no-hit gaps show');
  assert.match(html, /Needs 30 days of recall telemetry \(have 4\)/);
});

test('the Librarian card degrades part by part and says when telemetry is off', () => {
  const off = librarianSection(base({ librarian: { proposals: [], gaps: null, prune: null, settings: { scheduleEnabled: false, telemetryEnabled: false } } }));
  assert.match(off, /Recall telemetry is off on this server/);
  assert.match(off, /No open proposals/);
  assert.match(off, /Prune candidates could not be loaded/);
  const unloaded = librarianSection(base({ librarian: null }));
  assert.match(unloaded, /data-action="toggle-librarian-schedule" disabled/);
  assert.match(unloaded, /Proposals could not be loaded/);
  assert.match(librarianSection(base({ librarianRunning: true, librarian: null })), /data-action="run-librarian" disabled>Running…/);
});

test('Needs review has an opt-in recall sort and shows counts only when sorted', () => {
  const plain = renderHealthHtml(base({ healthData: { ...health, needsReview: [{ id: 'd1', title: 'Doc', verified: false }] } }));
  assert.match(plain, /data-action="toggle-health-review-sort" aria-pressed="false">Sort by recall/);
  assert.doesNotMatch(plain, /recalled \d+×/);
  const sorted = renderHealthHtml(base({
    healthReviewSort: 'recall',
    healthData: { ...health, needsReview: [{ id: 'd1', title: 'Doc', verified: false, recallHits: 4 }] },
  }));
  assert.match(sorted, /aria-pressed="true">Most recalled first/);
  assert.match(sorted, /recalled 4×/);
  assert.match(sorted, /aria-label="Librarian"/);
});

test('the recall sort: most recalled, then most used, then newest; the cycler offers it in the queue only', () => {
  const docs = [
    { id: 'a', updatedAt: '2026-09-03' },
    { id: 'b', updatedAt: '2026-09-02' },
    { id: 'c', updatedAt: '2026-09-01' },
  ];
  const counts = { c: { hits: 5, uses: 0 }, b: { hits: 1, uses: 2 }, a: { hits: 1, uses: 0 } };
  assert.deepEqual(sortDocuments(docs, 'recalled', { recallCounts: counts }).map((d) => d.id), ['c', 'b', 'a']);
  assert.deepEqual(sortDocuments(docs, 'recalled').map((d) => d.id), ['a', 'b', 'c'], 'no counts: newest first');
  assert.equal(nextLibrarySort('updated', { review: true }), 'title');
  assert.equal(nextLibrarySort('title', { review: true }), 'recalled');
  assert.equal(nextLibrarySort('recalled', { review: true }), 'updated');
  assert.equal(nextLibrarySort('title', { review: false }), 'updated');
  assert.equal(librarySortLabel('recalled'), 'Most recalled');

  const agentDoc = (id, updatedAt) => ({ id, title: id, updatedAt, updatedBy: 'agent', verified: false, status: 'active', documentType: 'note', tags: [] });
  const state = {
    libraryView: 'review', librarySortBy: 'recalled', libraryGroupBy: 'none',
    documents: [agentDoc('new', '2026-09-03'), agentDoc('old', '2026-09-01')],
    recallCounts: { counts: { old: { hits: 2, uses: 0 } } },
  };
  assert.deepEqual(buildLibraryModel(state).groups.flatMap((g) => g.docs).map((d) => d.id), ['old', 'new']);
  assert.deepEqual(buildLibraryModel({ ...state, librarySortBy: 'updated' }).groups.flatMap((g) => g.docs).map((d) => d.id), ['new', 'old'], 'the default order is unchanged');
});

function controllerFor(state, overrides = {}) {
  const toasts = [];
  const calls = [];
  const controller = createKnowledgeToolsController({
    getState: () => state, setState: (patch) => Object.assign(state, patch), renderApp: () => {}, showToast: (m) => toasts.push(m),
    announce: () => {}, getRoot: () => null, loadDocuments: async () => { calls.push('loadDocuments'); },
    fetchHealth: async (_project, options) => { calls.push(['fetchHealth', options?.sort ?? null]); return health; },
    fetchLinkSuggestions: async () => [],
    fetchKnowledgeGaps: async () => ({ items: [], usedSignals: 0 }),
    fetchLibrarianProposals: async () => ({ items: [PROPOSAL] }),
    fetchPruneCandidates: async () => { throw new Error('old server'); },
    fetchLibrarianSettings: async () => ({ scheduleEnabled: false, telemetryEnabled: true }),
    ...overrides,
  });
  return { controller, toasts, calls };
}

test('the controller loads the card with each part independent, and toggles the review sort', async () => {
  const state = {};
  const { controller, calls } = controllerFor(state);
  await controller.loadHealth();
  assert.deepEqual(state.librarian.proposals, [PROPOSAL]);
  assert.equal(state.librarian.prune, null, 'one failing part does not blank the card');
  await controller.actions['toggle-health-review-sort']();
  assert.equal(state.healthReviewSort, 'recall');
  assert.deepEqual(calls.filter((c) => c[0] === 'fetchHealth').map((c) => c[1]), [null, 'recall']);
});

test('Run librarian, approve (verify-first explained), dismiss and the schedule', async () => {
  const state = {};
  const decisions = [];
  const { controller, toasts } = controllerFor(state, {
    runLibrarian: async () => ({ created: [{ id: 'p' }], clusters: [{}], method: 'shingle' }),
    decideLibrarianProposal: async (id, decision) => {
      decisions.push([id, decision]);
      if (decision === 'approve') throw Object.assign(new Error('no'), { reason: 'verify-first' });
      return { proposal: { status: 'dismissed' } };
    },
    saveLibrarianSettings: async (patch) => ({ ...patch, telemetryEnabled: true }),
  });
  await controller.actions['run-librarian']();
  assert.equal(state.librarianRunning, false);
  assert.deepEqual(state.librarianLastRun, { created: 1, clusters: 1, method: 'shingle' });
  assert.match(toasts.at(-1), /filed 1 proposal for review/);
  await controller.actions['decide-proposal']({ dataset: { proposalId: 'p', decision: 'approve' } });
  assert.match(toasts.at(-1), /verify the proposal first/);
  await controller.actions['decide-proposal']({ dataset: { proposalId: 'p', decision: 'dismiss' } });
  assert.match(toasts.at(-1), /dismissed and archived/);
  assert.deepEqual(decisions, [['p', 'approve'], ['p', 'dismiss']]);
  await controller.loadHealth();
  await controller.actions['toggle-librarian-schedule']();
  assert.equal(state.librarian.settings.scheduleEnabled, true);
});
