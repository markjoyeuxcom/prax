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
