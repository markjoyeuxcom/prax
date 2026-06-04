import test from 'node:test';
import assert from 'node:assert/strict';
import { detectProject } from '../../cli/lib/detectProject.js';

test('flag wins over everything', () => {
  const out = detectProject({ flag: 'explicit', env: 'envproj', cwd: '/work/repo', readFile: () => '{"project":"fromfile"}' });
  assert.deepEqual(out, { project: 'explicit', source: 'flag' });
});

test('env wins over file and folder', () => {
  const out = detectProject({ env: 'envproj', cwd: '/work/repo', readFile: () => '{"project":"fromfile"}' });
  assert.deepEqual(out, { project: 'envproj', source: 'env' });
});

test('reads .moomora/project.json walking up from cwd', () => {
  const files = { '/work/repo/sub/.moomora/project.json': null, '/work/repo/.moomora/project.json': '{"project":"fromfile"}' };
  const out = detectProject({ cwd: '/work/repo/sub', readFile: (p) => { if (!(p in files) || files[p] === null) throw new Error('nope'); return files[p]; } });
  assert.deepEqual(out, { project: 'fromfile', source: 'file' });
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
  const out = detectProject({ cwd: '/work/repo', readFile: (p) => (p === '/work/repo/.moomora/project.json' ? 'not json' : (() => { throw new Error('nope'); })()) });
  assert.deepEqual(out, { project: 'repo', source: 'folder' });
});
