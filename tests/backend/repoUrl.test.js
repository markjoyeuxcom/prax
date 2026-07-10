import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRepoUrl, matchProjectByRepoUrl } from '../../server/repoUrl.js';

// ---- normalizeRepoUrl: every spelling of the same repo converges ----

test('normalizeRepoUrl canonicalizes the common remote forms to host/path', () => {
  const expected = 'github.com/awaybreaktoday/prax';
  for (const url of [
    'git@github.com:awaybreaktoday/prax.git',   // scp-like SSH (this repo's actual remote)
    'git@github.com:Awaybreaktoday/Prax.git',   // case
    'https://github.com/awaybreaktoday/prax.git',
    'https://github.com/awaybreaktoday/prax',
    'https://GITHUB.com/awaybreaktoday/prax/',  // host case + trailing slash
    'http://github.com/awaybreaktoday/prax',
    'https://user@github.com/awaybreaktoday/prax',        // userinfo
    'https://user:token@github.com/awaybreaktoday/prax',  // PAT
    'ssh://git@github.com/awaybreaktoday/prax.git',
    'ssh://git@github.com:2222/awaybreaktoday/prax.git',  // port
    'git://github.com/awaybreaktoday/prax.git',
  ]) {
    assert.equal(normalizeRepoUrl(url), expected, url);
  }
});

test('normalizeRepoUrl keeps GitLab subgroup paths intact', () => {
  assert.equal(normalizeRepoUrl('git@gitlab.com:group/sub/repo.git'), 'gitlab.com/group/sub/repo');
  assert.equal(normalizeRepoUrl('https://gitlab.example.com/group/sub/repo'), 'gitlab.example.com/group/sub/repo');
});

test('normalizeRepoUrl strips only ONE trailing .git', () => {
  assert.equal(normalizeRepoUrl('git@github.com:org/user.github.io.git'), 'github.com/org/user.github.io');
  assert.equal(normalizeRepoUrl('https://github.com/org/user.github.io'), 'github.com/org/user.github.io');
});

test('normalizeRepoUrl rejects non-URLs rather than guessing', () => {
  assert.equal(normalizeRepoUrl(''), null);
  assert.equal(normalizeRepoUrl(null), null);
  assert.equal(normalizeRepoUrl('not a url'), null);
  assert.equal(normalizeRepoUrl('C:\\repos\\thing'), null);      // Windows path, no @
  assert.equal(normalizeRepoUrl('localhost:3000'), null);        // port-only colon, no @
  assert.equal(normalizeRepoUrl('git@host:'), null);             // empty path
  assert.equal(normalizeRepoUrl('https://github.com/'), null);   // empty path
});

// ---- matchProjectByRepoUrl ----

const PROJECTS = [
  { name: 'Homelab', slug: 'homelab', sortOrder: 2, repoUrl: 'git@github.com:me/homelab.git' },
  { name: 'Prax', slug: 'prax', sortOrder: 1, repoUrl: 'https://github.com/awaybreaktoday/prax' },
  { name: 'No repo', slug: 'no-repo', sortOrder: 0, repoUrl: null },
];

test('matchProjectByRepoUrl matches across spellings on both sides', () => {
  assert.equal(matchProjectByRepoUrl(PROJECTS, 'git@github.com:awaybreaktoday/prax.git')?.slug, 'prax');
  assert.equal(matchProjectByRepoUrl(PROJECTS, 'https://ME@github.com/me/homelab/')?.slug, 'homelab');
});

test('matchProjectByRepoUrl returns null for no match / bad input, ignores null repoUrls', () => {
  assert.equal(matchProjectByRepoUrl(PROJECTS, 'git@github.com:other/repo.git'), null);
  assert.equal(matchProjectByRepoUrl(PROJECTS, ''), null);
  assert.equal(matchProjectByRepoUrl(null, 'git@github.com:me/homelab.git'), null);
});

test('matchProjectByRepoUrl resolves duplicates deterministically by sortOrder then name', () => {
  const dupes = [
    { name: 'B', slug: 'b', sortOrder: 1, repoUrl: 'git@github.com:x/y.git' },
    { name: 'A', slug: 'a', sortOrder: 1, repoUrl: 'https://github.com/x/y' },
    { name: 'C', slug: 'c', sortOrder: 0, repoUrl: 'https://github.com/x/y.git' },
  ];
  assert.equal(matchProjectByRepoUrl(dupes, 'ssh://git@github.com/x/y')?.slug, 'c'); // lowest sortOrder
});

test('normalizeRepoUrl: percent-encoding converges across the URL and scp-like branches', () => {
  // new URL() percent-encodes spaces/unicode; the scp branch keeps them raw —
  // both spellings of the same repo must normalize identically.
  assert.equal(normalizeRepoUrl('https://host.example/team/my repo'), 'host.example/team/my repo');
  assert.equal(normalizeRepoUrl('git@host.example:team/my repo.git'), 'host.example/team/my repo');
  assert.equal(normalizeRepoUrl('https://host.example/team/café'), normalizeRepoUrl('git@host.example:team/café.git'));
});

test('matchProjectByRepoUrl never matches archived or completed projects', () => {
  const projects = [
    { name: 'Prax (old)', slug: 'prax-old', sortOrder: 0, status: 'archived', repoUrl: 'git@github.com:org/prax.git' },
    { name: 'Prax', slug: 'prax', sortOrder: 5, status: 'active', repoUrl: 'https://github.com/org/prax' },
    { name: 'Done', slug: 'done', sortOrder: 1, status: 'completed', repoUrl: 'git@github.com:org/done.git' },
  ];
  // the archived predecessor (lower sortOrder) must NOT beat the active successor
  assert.equal(matchProjectByRepoUrl(projects, 'ssh://git@github.com/org/prax')?.slug, 'prax');
  // a SOLE archived/completed match is no match at all
  assert.equal(matchProjectByRepoUrl(projects, 'git@github.com:org/done.git'), null);
  // undefined status (minimal payloads/fixtures) stays eligible
  assert.equal(matchProjectByRepoUrl([{ name: 'X', slug: 'x', repoUrl: 'git@h.co:a/b.git' }], 'https://h.co/a/b')?.slug, 'x');
});
