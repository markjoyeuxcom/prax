import test from 'node:test';
import assert from 'node:assert/strict';
import { pickProjectCard, overviewCaveat, projectOverview } from '../../cli/lib/overview.js';

const doc = (id, extra = {}) => ({ id, title: `Doc ${id}`, tags: [], status: 'active', updatedAt: '2026-09-01T00:00:00Z', ...extra });

test('a verified project-card wins over a newer unverified one', () => {
  const docs = [
    doc('new', { tags: ['project-card'], updatedAt: '2026-09-20T00:00:00Z' }),
    doc('old', { tags: ['project-card'], verified: true, verifiedBy: 'mark' }),
  ];
  assert.deepEqual(pickProjectCard(docs, 'Prax'), { doc: docs[1], source: 'project-card' });
});

test('without a verified card the newest project-card is used, then the exact title', () => {
  const cards = [doc('a', { tags: ['project-card'] }), doc('b', { tags: ['project-card'], updatedAt: '2026-09-10T00:00:00Z' })];
  assert.equal(pickProjectCard(cards, 'Prax').doc.id, 'b');
  const titled = [doc('t', { title: 'prax Project Overview' }), doc('x', { title: 'Prax project overview (old)' })];
  assert.deepEqual(pickProjectCard(titled, 'Prax'), { doc: titled[0], source: 'title' });
});

test('superseded, deprecated and archived documents are never chosen', () => {
  const docs = [
    doc('s', { tags: ['project-card'], status: 'superseded', verified: true }),
    doc('d', { tags: ['project-card'], status: 'deprecated' }),
    doc('a', { title: 'Prax project overview', archivedAt: '2026-09-02T00:00:00Z' }),
  ];
  assert.equal(pickProjectCard(docs, 'Prax'), null);
});

test('the caveat always states trust and how the card was found', () => {
  assert.match(overviewCaveat({ doc: { verified: true, verifiedBy: 'mark' }, source: 'project-card' }), /verified by mark, tagged project-card/);
  assert.match(overviewCaveat({ doc: { verified: false }, source: 'title' }), /UNVERIFIED .* matched by title \(not tagged project-card\)/);
});

test('projectOverview resolves the project name, fetches the full card, and reports a missing one', async () => {
  const calls = [];
  const client = {
    listProjects: async () => [{ slug: 'prax', name: 'Prax' }],
    listDocuments: async (slug, opts) => { calls.push(['list', slug, opts.status]); return [doc('card', { title: 'Prax project overview' })]; },
    getDocument: async (id) => ({ id, body: 'full body', verified: false }),
  };
  const found = await projectOverview(client, 'prax');
  assert.deepEqual(calls, [['list', 'prax', 'active']]);
  assert.equal(found.found, true);
  assert.equal(found.source, 'title');
  assert.equal(found.doc.body, 'full body');
  const empty = await projectOverview({ ...client, listDocuments: async () => [] }, 'prax');
  assert.deepEqual(empty, { project: { slug: 'prax', name: 'Prax' }, found: false });
});
