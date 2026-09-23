import test from 'node:test';
import assert from 'node:assert/strict';
import { detectProject, detectRepoUrl } from '../../cli/lib/detectProject.js';

test('flag wins over everything', () => {
  const out = detectProject({ flag: 'explicit', env: 'envproj', cwd: '/work/repo', readFile: () => '{"project":"fromfile"}' });
  assert.deepEqual(out, { project: 'explicit', source: 'flag' });
});

test('env wins over file and folder', () => {
  const out = detectProject({ env: 'envproj', cwd: '/work/repo', readFile: () => '{"project":"fromfile"}' });
  assert.deepEqual(out, { project: 'envproj', source: 'env' });
});

test('reads .prax/project.json walking up from cwd', () => {
  const files = { '/work/repo/sub/.prax/project.json': null, '/work/repo/.prax/project.json': '{"project":"fromfile"}' };
  const out = detectProject({ cwd: '/work/repo/sub', readFile: (p) => { if (!(p in files) || files[p] === null) throw new Error('nope'); return files[p]; } });
  assert.deepEqual(out, { project: 'fromfile', source: 'file' });
});

test('still reads the legacy .moomora/project.json marker', () => {
  const files = { '/work/repo/.moomora/project.json': '{"project":"legacyproj"}' };
  const out = detectProject({ cwd: '/work/repo/sub', readFile: (p) => { if (!(p in files)) throw new Error('nope'); return files[p]; } });
  assert.deepEqual(out, { project: 'legacyproj', source: 'file' });
});

test('.prax marker wins over .moomora in the same directory', () => {
  const files = {
    '/work/repo/.prax/project.json': '{"project":"newproj"}',
    '/work/repo/.moomora/project.json': '{"project":"legacyproj"}',
  };
  const out = detectProject({ cwd: '/work/repo', readFile: (p) => { if (!(p in files)) throw new Error('nope'); return files[p]; } });
  assert.deepEqual(out, { project: 'newproj', source: 'file' });
});

test('falls back to cwd folder name', () => {
  const out = detectProject({ cwd: '/work/my-repo', readFile: () => { throw new Error('nope'); } });
  assert.deepEqual(out, { project: 'my-repo', source: 'folder' });
});

test('returns null project when cwd is root and nothing else resolves', () => {
  const out = detectProject({ cwd: '/', readFile: () => { throw new Error('nope'); } });
  assert.equal(out.project, null);
  assert.equal(out.source, 'none');
});

test('ignores a malformed project.json and keeps walking', () => {
  const out = detectProject({ cwd: '/work/repo', readFile: (p) => (p === '/work/repo/.prax/project.json' ? 'not json' : (() => { throw new Error('nope'); })()) });
  assert.deepEqual(out, { project: 'repo', source: 'folder' });
});

// ---- the repository boundary (review 2026-09-22) ----------------------------

const reader = (files) => (p) => { if (p in files) return files[p]; throw new Error('ENOENT'); };

test('a marker inside the repository is explicit intent; one above its root is only an outer marker', () => {
  const files = {
    '/work/.prax/project.json': '{"project":"workspace"}',
    '/work/repoC/.git/config': '[remote "origin"]\n\turl = git@example.com:org/repoC.git\n',
  };
  assert.deepEqual(detectProject({ cwd: '/work/repoC/docs', readFile: reader(files) }), { project: 'workspace', source: 'outer-file' });
  const inside = { ...files, '/work/repoC/.prax/project.json': '{"project":"repo-c"}' };
  assert.deepEqual(detectProject({ cwd: '/work/repoC/docs', readFile: reader(inside) }), { project: 'repo-c', source: 'file' });
  // Outside any repository the search has no boundary: the marker is explicit.
  assert.deepEqual(detectProject({ cwd: '/work/notes/2026', readFile: reader(files) }), { project: 'workspace', source: 'file' });
});

test('a worktree .git pointer file is a repository boundary too', () => {
  const files = {
    '/home/u/.prax/project.json': '{"project":"dotfiles"}',
    '/home/u/wt/.git': 'gitdir: /home/u/main/.git/worktrees/wt\n',
  };
  assert.equal(detectProject({ cwd: '/home/u/wt/src', readFile: reader(files) }).source, 'outer-file');
});

test('the folder guess is the repository root\'s name, never a subfolder\'s', () => {
  const files = { '/work/repoB/.git/config': '[core]\n' };
  assert.deepEqual(detectProject({ cwd: '/work/repoB/docs/api', readFile: reader(files) }), { project: 'repoB', source: 'folder' });
  // Outside a repository there is nothing better than the current folder.
  assert.deepEqual(detectProject({ cwd: '/work/scratch', readFile: reader({}) }), { project: 'scratch', source: 'folder' });
});

// ---- detectRepoUrl (repo-URL project detection) -----------------------------

const GIT_CONFIG = `[core]
\trepositoryformatversion = 0
[remote "origin"]
\turl = git@github.com:awaybreaktoday/prax.git
\tfetch = +refs/heads/*:refs/remotes/origin/*
[remote "backup"]
\turl = git@example.com:other/mirror.git
`;

test('detectRepoUrl reads [remote "origin"] from .git/config, walking up', () => {
  const files = { '/repo/.git/config': GIT_CONFIG };
  const readFile = (p) => { if (p in files) return files[p]; throw new Error('ENOENT'); };
  assert.equal(detectRepoUrl({ cwd: '/repo/sub/dir', readFile }), 'git@github.com:awaybreaktoday/prax.git');
});

test('detectRepoUrl follows a worktree .git FILE to the shared config', () => {
  const files = {
    '/wt/.git': 'gitdir: /repo/.git/worktrees/wt\n',
    '/repo/.git/config': GIT_CONFIG,
  };
  const readFile = (p) => { if (p in files) return files[p]; throw new Error('ENOENT'); };
  assert.equal(detectRepoUrl({ cwd: '/wt', readFile }), 'git@github.com:awaybreaktoday/prax.git');
});

test('detectRepoUrl ignores non-origin remotes and returns null outside a repo', () => {
  const noOrigin = { '/repo/.git/config': '[remote "upstream"]\n\turl = git@x.com:a/b.git\n' };
  const readFile = (p) => { if (p in noOrigin) return noOrigin[p]; throw new Error('ENOENT'); };
  assert.equal(detectRepoUrl({ cwd: '/repo', readFile }), null);
  assert.equal(detectRepoUrl({ cwd: '/tmp/elsewhere', readFile: () => { throw new Error('ENOENT'); } }), null);
});

test('detectRepoUrl treats the first .git as the repo BOUNDARY — no origin means null, never the enclosing repo', () => {
  const files = {
    '/home/u/code/.git/config': GIT_CONFIG, // enclosing repo (has origin)
    '/home/u/code/newproj/.git/config': '[core]\n\trepositoryformatversion = 0\n', // fresh init, no remote
  };
  const readFile = (p) => { if (p in files) return files[p]; throw new Error('ENOENT'); };
  assert.equal(detectRepoUrl({ cwd: '/home/u/code/newproj', readFile }), null); // NOT the dotfiles/code origin
  assert.equal(detectRepoUrl({ cwd: '/home/u/code', readFile }), 'git@github.com:awaybreaktoday/prax.git');
});

test('detectRepoUrl worktree slice anchors on /.git/worktrees/ — a directory named "worktrees" in the path is fine', () => {
  const files = {
    '/home/u/wt/.git': 'gitdir: /home/u/worktrees/proj/.git/worktrees/wt\n',
    '/home/u/worktrees/proj/.git/config': GIT_CONFIG,
  };
  const readFile = (p) => { if (p in files) return files[p]; throw new Error('ENOENT'); };
  assert.equal(detectRepoUrl({ cwd: '/home/u/wt', readFile }), 'git@github.com:awaybreaktoday/prax.git');
});

test('detectRepoUrl: a submodule inside a linked worktree uses ITS OWN config, not the superproject', () => {
  const files = {
    '/data/wt/sub/.git': 'gitdir: /data/main/.git/worktrees/wt/modules/sub\n',
    '/data/main/.git/worktrees/wt/modules/sub/config': '[remote "origin"]\n\turl = git@github.com:org/sub.git\n',
    '/data/main/.git/config': GIT_CONFIG, // superproject — must NOT win
  };
  const readFile = (p) => { if (p in files) return files[p]; throw new Error('ENOENT'); };
  assert.equal(detectRepoUrl({ cwd: '/data/wt/sub', readFile }), 'git@github.com:org/sub.git');
});

test('detectRepoUrl handles Windows-style absolute gitdir pointers (drive letter + forward slashes)', () => {
  const files = {
    '/wt/.git': 'gitdir: C:/Users/u/proj/.git/worktrees/wt\n',
    'C:/Users/u/proj/.git/config': GIT_CONFIG,
  };
  const readFile = (p) => { if (p in files) return files[p]; throw new Error('ENOENT'); };
  assert.equal(detectRepoUrl({ cwd: '/wt', readFile }), 'git@github.com:awaybreaktoday/prax.git');
});
