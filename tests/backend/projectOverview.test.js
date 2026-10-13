// Every project gets one overview document (server/projectOverview.js): the
// filled starter, the choice of an existing card, the unverified seed whoever
// created the project, the system-project exemption, and the doctor listing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OVERVIEW_TAG, overviewTitle, overviewDocumentId, pickOverview, fillOverviewTemplate, readOverviewTemplate,
  ensureProjectOverview, projectsWithoutOverview,
} from '../../server/projectOverview.js';

const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Klyx', slug: 'klyx', status: 'active', repoUrl: 'git@github.com:org/klyx.git' };
const doc = (id, extra = {}) => ({ id, title: `Doc ${id}`, tags: [], status: 'active', updatedAt: '2026-09-01T00:00:00Z', ...extra });

function fakeLibrary(docsByProject = {}) {
  const created = [];
  return {
    created,
    async listDocuments({ projectId }) { return projectId ? (docsByProject[projectId] || []) : Object.values(docsByProject).flat(); },
    async createDocument(document) {
      created.push(document);
      const row = { id: `doc-${created.length}`, ...document, status: 'active', archivedAt: null };
      (docsByProject[document.projectId] ||= []).push(row);
      return row;
    },
  };
}

test('the title is "<Name> project overview"', () => {
  assert.equal(overviewTitle(' Klyx '), 'Klyx project overview');
});

test('the starter is filled with the name, slug and repo URL; other placeholders stay', async () => {
  const template = await readOverviewTemplate();
  const body = fillOverviewTemplate(template, PROJECT);
  assert.match(body, /^# Klyx project overview/);
  assert.match(body, /- Prax project: Klyx \(klyx\)/);
  assert.match(body, /- Repository: git@github\.com:org\/klyx\.git/);
  assert.doesNotMatch(body, /<Project name>/);
  assert.match(body, /<repository-relative path>/, 'the codebase guide is for the person to fill');
  const dollars = fillOverviewTemplate(template, { name: 'Cash $$ Tracker', slug: 'cash', repoUrl: 'https://example.com/$&' });
  assert.match(dollars, /^# Cash \$\$ Tracker project overview/, 'a $ in a name is literal, not a replacement pattern');
  assert.match(dollars, /- Repository: https:\/\/example\.com\/\$&\n/);
  const bare = fillOverviewTemplate(template, { name: 'Notes' });
  assert.match(bare, /- Prax project: Notes\n/);
  assert.match(bare, /- Repository: <repository URL>/, 'no repo URL keeps the placeholder');
});

test('pickOverview prefers a verified card, then the newest card, then the exact title; never a retired one', () => {
  const verified = doc('v', { tags: [OVERVIEW_TAG], verified: true });
  const newer = doc('n', { tags: [OVERVIEW_TAG], updatedAt: '2026-10-01T00:00:00Z' });
  assert.equal(pickOverview([newer, verified], 'Klyx').id, 'v');
  assert.equal(pickOverview([doc('o', { tags: [OVERVIEW_TAG] }), newer], 'Klyx').id, 'n');
  assert.equal(pickOverview([doc('t', { title: 'klyx Project Overview' })], 'Klyx').id, 't');
  assert.equal(pickOverview([
    doc('s', { tags: [OVERVIEW_TAG], status: 'superseded' }),
    doc('a', { tags: [OVERVIEW_TAG], archivedAt: '2026-09-02T00:00:00Z' }),
  ], 'Klyx'), null);
});

test('ensureProjectOverview creates one unverified card and then returns the same one', async () => {
  const library = fakeLibrary();
  const first = await ensureProjectOverview({ libraryRepository: library, project: PROJECT });
  assert.equal(first.created, true);
  assert.equal(first.document.title, 'Klyx project overview');
  assert.deepEqual(first.document.tags, [OVERVIEW_TAG]);
  assert.equal(first.document.documentType, 'reference');
  assert.equal(first.document.verified, false, 'a template is not knowledge anyone vouched for');
  assert.equal(first.document.updatedBy, 'user');
  const again = await ensureProjectOverview({ libraryRepository: library, project: PROJECT });
  assert.equal(again.created, false);
  assert.equal(again.document.id, first.document.id);
  assert.equal(library.created.length, 1);
});

test('an agent create is attributed to the agent and still lands unverified', async () => {
  const library = fakeLibrary();
  const { document } = await ensureProjectOverview({
    libraryRepository: library, project: PROJECT, actor: { updatedBy: 'agent', updatedByAgent: 'claude' },
  });
  assert.equal(document.updatedBy, 'agent');
  assert.equal(document.updatedByAgent, 'claude');
  assert.equal(document.verified, false);
});

test('system projects get no card; a missing library repository is a no-op', async () => {
  const library = fakeLibrary();
  const inbox = await ensureProjectOverview({ libraryRepository: library, project: { id: 'i', name: 'Inbox', slug: 'inbox', status: 'active' } });
  assert.deepEqual(inbox, { document: null, created: false, reserved: true });
  const memory = await ensureProjectOverview({ libraryRepository: library, project: { id: 'm', name: 'memory', slug: 'memory', status: 'active' } });
  assert.equal(memory.reserved, true);
  assert.equal(library.created.length, 0);
  assert.deepEqual(await ensureProjectOverview({ libraryRepository: null, project: PROJECT }), { document: null, created: false });
});

test('projectsWithoutOverview lists active non-system projects that have no card', async () => {
  const withCard = { id: 'c', name: 'Cards', slug: 'cards', status: 'active' };
  const onHold = { id: 'h', name: 'Hold', slug: 'hold', status: 'on-hold' };
  const library = fakeLibrary({ c: [doc('card', { tags: [OVERVIEW_TAG], projectId: 'c' })] });
  const missing = await projectsWithoutOverview({
    libraryRepository: library,
    projects: [PROJECT, withCard, onHold, { id: 'i', name: 'Inbox', slug: 'inbox', status: 'active' }],
  });
  assert.deepEqual(missing, [{ id: PROJECT.id, slug: 'klyx', name: 'Klyx' }]);
});

test('with an idempotent repository two concurrent ensures resolve to one card with a project-derived id', async () => {
  const library = fakeLibrary();
  const stored = new Map();
  library.createDocumentIdempotent = async (document) => {
    if (stored.has(document.id)) return { document: stored.get(document.id), created: false };
    const row = { ...document, status: 'active', archivedAt: null };
    stored.set(document.id, row);
    return { document: row, created: true };
  };
  const [a, b] = await Promise.all([
    ensureProjectOverview({ libraryRepository: library, project: PROJECT }),
    ensureProjectOverview({ libraryRepository: library, project: PROJECT }),
  ]);
  assert.equal(a.document.id, overviewDocumentId(PROJECT.id));
  assert.equal(b.document.id, a.document.id);
  assert.equal([a, b].filter((r) => r.created).length, 1, 'exactly one create');
  assert.equal(library.created.length, 0, 'the plain create path was not used');
  assert.match(overviewDocumentId('x'), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(overviewDocumentId('x'), overviewDocumentId('x'));
  assert.notEqual(overviewDocumentId('x'), overviewDocumentId('y'));
});

test('an archived card blocks a new seed and is reported as archived', async () => {
  const archivedCard = doc('old', { tags: [OVERVIEW_TAG], archivedAt: '2026-10-01T00:00:00Z' });
  const library = {
    created: [],
    async listDocuments({ projectId, archived }) { return archived && projectId === PROJECT.id ? [archivedCard] : []; },
    async createDocument(document) { library.created.push(document); return document; },
  };
  const result = await ensureProjectOverview({ libraryRepository: library, project: PROJECT });
  assert.deepEqual(result, { document: archivedCard, created: false, archived: true });
  assert.equal(library.created.length, 0);
});

test('a derived id taken by a card that was moved or superseded is not returned as this project\'s overview', async () => {
  const library = fakeLibrary();
  const derived = overviewDocumentId(PROJECT.id);
  const elsewhere = doc(derived, { tags: [OVERVIEW_TAG], projectId: 'another-project', title: 'Klyx project overview' });
  library.createDocumentIdempotent = async () => ({ document: elsewhere, created: false });
  const moved = await ensureProjectOverview({ libraryRepository: library, project: PROJECT });
  assert.equal(moved.created, true);
  assert.notEqual(moved.document.id, derived);
  assert.equal(moved.document.projectId, PROJECT.id);
  const retired = doc(derived, { tags: [OVERVIEW_TAG], projectId: PROJECT.id, status: 'superseded' });
  const library2 = fakeLibrary();
  library2.createDocumentIdempotent = async () => ({ document: retired, created: false });
  const fresh = await ensureProjectOverview({ libraryRepository: library2, project: PROJECT });
  assert.equal(fresh.created, true);
  assert.notEqual(fresh.document.id, derived);
  assert.equal(library.created.length + library2.created.length, 2, 'both fell back to a plain create');
});
