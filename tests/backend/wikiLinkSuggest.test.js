import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestWikiLinks, applyWikiLink } from '../../server/wikiLinkSuggest.js';

const docs = () => [
  { id: 'a', title: 'Postgres Failover', body: 'How to fail over the primary.' },
  { id: 'b', title: 'Incident Playbook', body: 'On a DB outage follow the Postgres Failover steps. Do not touch `Postgres Failover` in code. See [[Cache Notes]] too.' },
  { id: 'c', title: 'Cache Notes', body: 'Warming strategy.' },
  { id: 'd', title: 'DB', body: 'A two-char title that should never be suggested.' },
];

test('suggestWikiLinks finds plain mentions, skipping code, existing links, and short titles', () => {
  const s = suggestWikiLinks(docs());
  const pairs = s.map((x) => `${x.sourceTitle}→${x.targetTitle}`);
  // b mentions "Postgres Failover" in prose (once, plus a code span + nothing linked) → suggested
  assert.ok(pairs.includes('Incident Playbook→Postgres Failover'));
  // b already has [[Cache Notes]] → NOT suggested again
  assert.ok(!pairs.includes('Incident Playbook→Cache Notes'));
  // 'DB' (2 chars) is never a target
  assert.ok(!pairs.some((p) => p.endsWith('→DB')));
  // a suggestion carries a highlighted snippet
  const one = s.find((x) => x.targetTitle === 'Postgres Failover');
  assert.equal(one.snippet.hit, 'Postgres Failover');
});

test('applyWikiLink rewrites the FIRST plain mention only, preserving code + existing links', () => {
  const body = docs()[1].body;
  const out = applyWikiLink(body, 'Postgres Failover');
  assert.match(out, /follow the \[\[Postgres Failover\]\] steps/);
  assert.match(out, /`Postgres Failover` in code/); // code span untouched
  assert.equal((out.match(/\[\[Postgres Failover\]\]/g) || []).length, 1); // only the prose one linked
});

test('applyWikiLink preserves the mention\'s original casing', () => {
  assert.equal(applyWikiLink('see postgres failover here', 'Postgres Failover'), 'see [[postgres failover]] here');
});

test('applyWikiLink returns null when there is no eligible mention', () => {
  assert.equal(applyWikiLink('nothing relevant here', 'Postgres Failover'), null);
  assert.equal(applyWikiLink('[[Postgres Failover]] already', 'Postgres Failover'), null); // only an existing link
  assert.equal(applyWikiLink('', 'X'), null);
});

test('word-boundary: a title is not matched inside a larger word', () => {
  // "Cache" should not match inside "Caches" or "CacheNotes"
  assert.equal(applyWikiLink('the Caches are warm', 'Cache'), null);
  assert.equal(applyWikiLink('the Cache is warm', 'Cache'), 'the [[Cache]] is warm');
});
