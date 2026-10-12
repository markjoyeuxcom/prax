import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTagKey, narrowingTags, tagStats, tagMergeSuggestions, filterTagStats } from '../../public/js/tagStats.js';

const docs = [
  { id: '1', tags: ['postgres', 'backup'], updatedAt: '2026-10-01', updatedBy: 'human' },
  { id: '2', tags: ['postgres', 'cnpg', '#Backup'], updatedAt: '2026-10-07', updatedBy: 'agent' },
  { id: '3', tags: ['postgresql', 'backups'], updatedAt: '2026-10-03', updatedBy: 'agent' },
  { id: '4', tags: ['k8s', 'dns'], updatedAt: '2026-09-01', updatedBy: 'human' },
  { id: '5', tags: ['kubernetes'], updatedAt: '2026-10-11', updatedBy: 'agent' },
  { id: '6', tags: ['dns'], updatedAt: '2026-08-01', updatedBy: 'human', archivedAt: '2026-09-01' },
];

test('tag keys are lowercase, unhashed and hyphenated', () => {
  assert.equal(normalizeTagKey('  #Disaster Recovery '), 'disaster-recovery');
  assert.equal(normalizeTagKey('a  -- b'), 'a-b');
  assert.equal(normalizeTagKey(null), '');
});

test('narrowing tags are the ones present in the current results, minus the active ones', () => {
  const results = docs.slice(0, 2);
  assert.deepEqual(narrowingTags(results, ['backup']), [{ tag: 'postgres', count: 2 }, { tag: 'cnpg', count: 1 }]);
});

test('tag stats count live documents, last use, who added it, and companions', () => {
  const stats = tagStats(docs);
  const postgres = stats.find((row) => row.tag === 'postgres');
  assert.deepEqual(postgres, { tag: 'postgres', count: 2, lastUsed: '2026-10-07', addedBy: 'both', oftenWith: ['backup', 'cnpg'] });
  assert.equal(stats.find((row) => row.tag === 'dns').count, 1, 'archived documents do not count');
  assert.equal(stats.find((row) => row.tag === 'kubernetes').addedBy, 'agents');
  assert.equal(stats[0].count >= stats[stats.length - 1].count, true);
});

test('merge suggestions group spellings into the most-used tag, conservatively', () => {
  const suggestions = tagMergeSuggestions(tagStats(docs));
  assert.deepEqual(suggestions.find((s) => s.into === 'postgres'), { into: 'postgres', from: ['postgresql'], documents: 1, agentOnly: true });
  assert.deepEqual(suggestions.find((s) => s.into === 'backup').from, ['backups']);
  assert.deepEqual(suggestions.find((s) => s.into === 'k8s').from, ['kubernetes']);
  // "dns" and "postgres" keep their s: no singular tag exists for them.
  assert.equal(suggestions.some((s) => s.from.includes('dns')), false);
});

test('tag filters: duplicates, used once, agent-only', () => {
  const stats = tagStats(docs);
  const suggestions = tagMergeSuggestions(stats);
  assert.deepEqual(filterTagStats(stats, 'once', suggestions).map((r) => r.tag).sort(), ['backups', 'cnpg', 'dns', 'k8s', 'kubernetes', 'postgresql']);
  assert.ok(filterTagStats(stats, 'agents', suggestions).every((r) => r.addedBy === 'agents'));
  assert.ok(filterTagStats(stats, 'duplicates', suggestions).some((r) => r.tag === 'pg' || r.tag === 'postgresql'));
  assert.equal(filterTagStats(stats, 'all', suggestions).length, stats.length);
});
