// `prax mirror` writing a folder: deterministic bytes, updates, retirement as a
// move, removal, and the guards that keep it from touching files it does not
// own. The export itself (paths, rendering) is covered by the route tests and
// the round-trip contract test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderDocumentMarkdown } from '../../server/libraryExport.js';
import { sha256, isMirrorDocumentPath, parseMirrorMarkdown, recoverBody } from '../../cli/lib/mirrorFormat.js';
import { planMirror, readMirrorState, writeMirror, MirrorError } from '../../cli/lib/mirror.js';

function doc(id, fields = {}) {
  const record = {
    id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    title: `Doc ${id}`,
    body: `Body ${id}`,
    documentType: 'note',
    tags: [],
    status: 'active',
    verified: false,
    verifiedBy: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...fields,
  };
  record.contentHash = sha256(record.body);
  const folder = record.status === 'active' ? '' : 'retired/';
  return {
    path: fields.path || `${folder}doc-${id}.md`,
    id: record.id,
    title: record.title,
    documentType: record.documentType,
    status: record.status,
    tags: record.tags,
    verified: record.verified,
    verifiedBy: record.verifiedBy,
    verifiedAt: null,
    contentHash: record.contentHash,
    markdown: renderDocumentMarkdown(record, 'demo', null),
  };
}

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'prax-mirror-'));
  try { return fn(join(dir, 'library'), dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

function snapshot(dir) {
  const files = {};
  for (const name of readdirSync(dir, { recursive: true })) {
    const path = join(dir, name);
    if (statSync(path).isFile()) files[name] = readFileSync(path, 'utf8');
  }
  return files;
}

test('the same Library state writes identical bytes and a second run changes nothing', () => {
  withDir((dir) => {
    const docs = [doc(1), doc(2, { verified: true, verifiedBy: 'Mark', documentType: 'decision' }), doc(3, { status: 'superseded' })];
    const first = writeMirror({ dir, project: 'demo', documents: docs });
    assert.equal(first.wrote, true);
    assert.deepEqual(first.added.sort(), ['doc-1.md', 'doc-2.md', 'retired/doc-3.md']);
    const before = snapshot(dir);
    assert.deepEqual(Object.keys(before).sort(), ['README.md', 'doc-1.md', 'doc-2.md', 'index.json', 'retired/doc-3.md']);
    assert.equal(before['doc-1.md'], docs[0].markdown, 'files are the exporter bytes');

    const index = JSON.parse(before['index.json']);
    assert.equal(index.format, 'prax.library-mirror');
    assert.deepEqual(index.documents.map((d) => d.path), ['doc-1.md', 'doc-2.md', 'retired/doc-3.md']);
    assert.doesNotMatch(before['index.json'] + before['README.md'], /\d{4}-\d\d-\d\dT/, 'no timestamps in the index files');
    assert.match(before['README.md'], /\| \[Doc 2\]\(doc-2\.md\) \| decision \| verified by Mark \|/);
    assert.match(before['README.md'], /## Retired \(1\)/);

    // Age every file, then mirror the same state (in another order): nothing is rewritten.
    const old = new Date('2020-01-01T00:00:00Z');
    for (const name of Object.keys(before)) utimesSync(join(dir, name), old, old);
    const second = writeMirror({ dir, project: 'demo', documents: [...docs].reverse() });
    assert.equal(second.wrote, false);
    assert.equal(second.stale, false);
    assert.deepEqual(snapshot(dir), before);
    for (const name of Object.keys(before)) assert.equal(statSync(join(dir, name)).mtimeMs, old.getTime(), `${name} untouched`);
    assert.equal(writeMirror({ dir, project: 'demo', documents: docs, check: true }).stale, false);
  });
});

test('an edit updates one file; retiring moves it; archiving or deleting removes it', () => {
  withDir((dir) => {
    writeMirror({ dir, project: 'demo', documents: [doc(1), doc(2), doc(3)] });

    const edited = writeMirror({ dir, project: 'demo', documents: [doc(1, { body: 'Changed' }), doc(2), doc(3)] });
    assert.deepEqual(edited.updated, ['doc-1.md']);
    assert.deepEqual([...edited.added, ...edited.deleted, ...edited.moved], []);
    assert.match(readFileSync(join(dir, 'doc-1.md'), 'utf8'), /\nChanged\n$/);

    const check = writeMirror({ dir, project: 'demo', documents: [doc(1, { body: 'Changed' }), doc(2, { status: 'superseded' }), doc(3)], check: true });
    assert.equal(check.stale, true);
    assert.equal(check.wrote, false);
    assert.ok(existsSync(join(dir, 'doc-2.md')), '--check writes nothing');

    const retired = writeMirror({ dir, project: 'demo', documents: [doc(1, { body: 'Changed' }), doc(2, { status: 'superseded' }), doc(3)] });
    assert.deepEqual(retired.moved, [{ from: 'doc-2.md', to: 'retired/doc-2.md' }]);
    assert.equal(existsSync(join(dir, 'doc-2.md')), false);
    assert.match(readFileSync(join(dir, 'retired', 'doc-2.md'), 'utf8'), /^status: "superseded"$/m);

    const removed = writeMirror({ dir, project: 'demo', documents: [doc(1, { body: 'Changed' })] });
    assert.deepEqual(removed.deleted.sort(), ['doc-3.md', 'retired/doc-2.md']);
    assert.deepEqual(Object.keys(snapshot(dir)).sort(), ['README.md', 'doc-1.md', 'index.json']);
    assert.equal(existsSync(join(dir, 'retired')), false, 'an empty retired/ folder is removed');
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).documents.map((d) => d.path), ['doc-1.md']);
  });
});

test('a document that takes over a freed name is reported as moved and the departed one as deleted', () => {
  withDir((dir) => {
    writeMirror({ dir, project: 'demo', documents: [doc(1, { path: 'setup.md' }), doc(2, { path: 'setup-2.md' })] });
    const result = writeMirror({ dir, project: 'demo', documents: [doc(2, { path: 'setup.md' })] });
    assert.deepEqual(result.moved, [{ from: 'setup-2.md', to: 'setup.md' }]);
    assert.deepEqual(result.deleted, ['setup.md']);
    assert.deepEqual(Object.keys(snapshot(dir)).sort(), ['README.md', 'index.json', 'setup.md']);
    assert.equal(readFileSync(join(dir, 'setup.md'), 'utf8'), doc(2).markdown);
  });
});

test('files the mirror does not own are reported and never deleted', () => {
  withDir((dir) => {
    writeMirror({ dir, project: 'demo', documents: [doc(1)] });
    writeFileSync(join(dir, 'hand-written.md'), 'mine');
    const result = writeMirror({ dir, project: 'demo', documents: [] });
    assert.deepEqual(result.unmanaged, ['hand-written.md']);
    assert.equal(readFileSync(join(dir, 'hand-written.md'), 'utf8'), 'mine');
    assert.equal(existsSync(join(dir, 'doc-1.md')), false);
  });
});

test('a non-empty folder without a manifest is refused, and --force adoption deletes nothing it did not write', () => {
  withDir((dir) => {
    mkdirSync(dir);
    writeFileSync(join(dir, 'notes.md'), 'existing');
    assert.throws(() => writeMirror({ dir, project: 'demo', documents: [doc(1)] }), MirrorError);
    assert.deepEqual(readdirSync(dir), ['notes.md'], 'the refusal changed nothing');
    const adopted = writeMirror({ dir, project: 'demo', documents: [doc(1)], force: true });
    assert.deepEqual(adopted.unmanaged, ['notes.md']);
    assert.equal(readFileSync(join(dir, 'notes.md'), 'utf8'), 'existing');
    // A later mirror still leaves it alone.
    writeMirror({ dir, project: 'demo', documents: [] });
    assert.equal(readFileSync(join(dir, 'notes.md'), 'utf8'), 'existing');
  });
});

test('a manifest edited to name paths outside the mirror cannot make it delete them', () => {
  withDir((dir, parent) => {
    writeMirror({ dir, project: 'demo', documents: [doc(1)] });
    writeFileSync(join(parent, 'outside.md'), 'keep');
    const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
    index.documents.push({ path: '../outside.md', id: 'x' }, { path: '/etc/hosts.md', id: 'y' }, { path: 'README.md', id: 'z' });
    writeFileSync(join(dir, 'index.json'), JSON.stringify(index));
    writeMirror({ dir, project: 'demo', documents: [] });
    assert.equal(readFileSync(join(parent, 'outside.md'), 'utf8'), 'keep');
    assert.ok(existsSync(join(dir, 'README.md')));
    for (const bad of ['../outside.md', '/etc/hosts.md', 'README.md', 'retired/../x.md', 'a/b.md', 'index.json']) {
      assert.equal(isMirrorDocumentPath(bad), false, bad);
    }
  });
});

test('an interrupted run is finished by the next: the interim manifest owns every path it may leave', () => {
  withDir((dir) => {
    writeMirror({ dir, project: 'demo', documents: [doc(1)] });
    const state = readMirrorState(dir);
    const plan = planMirror({ project: 'demo', documents: [doc(2)], state, read: () => null });
    const interim = JSON.parse(plan.interimIndex);
    assert.deepEqual(interim.documents.map((d) => d.path).sort(), ['doc-1.md', 'doc-2.md']);
    // Simulate a crash after the interim manifest and the new file were written.
    writeFileSync(join(dir, 'index.json'), plan.interimIndex);
    writeFileSync(join(dir, 'doc-2.md'), doc(2).markdown);
    const finished = writeMirror({ dir, project: 'demo', documents: [doc(3)] });
    assert.deepEqual(Object.keys(snapshot(dir)).sort(), ['README.md', 'doc-3.md', 'index.json']);
    assert.ok(finished.deleted.includes('doc-1.md'));
  });
});

test('the v3 reader recovers the exact body, with or without a final newline', () => {
  for (const body of ['one line', 'ends with newline\n', 'two\n\n', '']) {
    const record = { id: 'x', title: 'T: colon', body, tags: ['a', 'needs: quote'], contentHash: sha256(body), createdAt: 'c', updatedAt: 'u' };
    const parsed = parseMirrorMarkdown(renderDocumentMarkdown(record, 'demo', null));
    assert.equal(parsed.meta.title, 'T: colon');
    assert.deepEqual(parsed.meta.tags, ['a', 'needs: quote']);
    assert.deepEqual(recoverBody(parsed.body, record.contentHash), { body, matches: true }, JSON.stringify(body));
  }
  assert.equal(recoverBody('edited\n', sha256('original')).matches, false);
  assert.equal(parseMirrorMarkdown('# not front matter'), null);
});

// The command's grammar refuses misuse before any request (the URL is unreachable).
test('prax mirror refuses flags that belong to another form, before any request', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const cli = fileURLToPath(new URL('../../cli/prax.js', import.meta.url));
  const refused = (args, pattern) => {
    const res = spawnSync(process.execPath, [cli, ...args], {
      encoding: 'utf8', env: { ...process.env, PRAX_API_URL: 'http://127.0.0.1:9', PRAX_PROJECT: 'demo' },
    });
    assert.notEqual(res.status, 0, args.join(' '));
    assert.match(res.stderr, pattern, args.join(' '));
    assert.doesNotMatch(res.stderr, /not reachable/, `${args.join(' ')} reached the network`);
  };
  refused(['mirror', '--print'], /mirror does not take --print/);
  refused(['mirror', 'import', 'dir', '--out', 'x'], /mirror import does not take --out/);
  refused(['mirror', '--agents-block', '--check'], /mirror --agents-block does not take --check/);
  refused(['mirror', '--agents-block', '--print', '--remove'], /give --print or --remove, not both/);
  refused(['mirror', '--agents-block', '--max-chars', '10'], /--max-chars must be at least 1000/);
  refused(['mirror', 'export'], /mirror: unknown subcommand "export"/);
});
