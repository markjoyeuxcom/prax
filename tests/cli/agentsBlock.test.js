// The compiled instruction block (`prax mirror --agents-block`): only verified
// standing rules, bounded with explicit truncation notes, deterministic, and
// written with the installer's managed-marker routine (tests/skills covers the
// installer itself; the parity test here holds the two routines together).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDocumentMarkdown } from '../../server/libraryExport.js';
import { sha256 } from '../../cli/lib/mirrorFormat.js';
import {
  compileAgentsBlock, DEFAULT_BLOCK_MAX_CHARS, defaultInstructionFile, neutraliseMarkers, selectBlockDocuments,
} from '../../cli/lib/agentsBlock.js';
import { applyManagedBlock, editManagedBlock, ManagedBlockError } from '../../cli/lib/managedBlock.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
let n = 0;

// One export document as GET /api/library/export?format=json&layout=mirror returns it.
function exportDoc(fields) {
  n += 1;
  const doc = {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    title: `Doc ${n}`,
    body: 'Body.',
    documentType: 'decision',
    tags: [],
    status: 'active',
    verified: true,
    verifiedBy: 'Mark',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    ...fields,
  };
  doc.contentHash = sha256(doc.body);
  return {
    path: `${doc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`,
    id: doc.id,
    title: doc.title,
    documentType: doc.documentType,
    status: doc.status,
    tags: doc.tags,
    verified: doc.verified,
    verifiedBy: doc.verifiedBy,
    verifiedAt: null,
    contentHash: doc.contentHash,
    markdown: renderDocumentMarkdown(doc, 'demo', null),
  };
}

test('only active, verified decisions and convention-tagged documents are compiled', () => {
  const docs = [
    exportDoc({ title: 'Verified decision' }),
    exportDoc({ title: 'Unverified decision', verified: false, verifiedBy: null }),
    exportDoc({ title: 'Superseded decision', status: 'superseded' }),
    exportDoc({ title: 'Verified runbook', documentType: 'runbook' }),
    exportDoc({ title: 'Convention reference', documentType: 'reference', tags: ['convention'] }),
    exportDoc({ title: 'Unverified convention', documentType: 'note', tags: ['convention'], verified: false }),
  ];
  const selected = selectBlockDocuments(docs);
  assert.deepEqual(selected.map((d) => d.title), ['Convention reference', 'Verified decision']);
  const block = compileAgentsBlock({ project: 'demo', documents: selected });
  assert.match(block, /### Verified decision/);
  assert.match(block, /### Convention reference/);
  assert.doesNotMatch(block, /### (Unverified|Superseded|Verified runbook)/);
  assert.match(block, /_decision · verified by Mark · `prax get [0-9a-f-]{36}`_/);
  // --type/--tag replace the defaults.
  assert.deepEqual(selectBlockDocuments(docs, { types: ['runbook'], tags: [] }).map((d) => d.title), ['Verified runbook']);
});

test('the body round-trips exactly, headings are demoted outside code fences, and markers are neutralised', () => {
  const doc = exportDoc({
    title: 'Headings',
    body: '# Top\n\nText <!-- prax-memory:start --> inline.\n\n```sh\n# a shell comment\n```\n<!-- prax-library:end -->',
  });
  const [selected] = selectBlockDocuments([doc]);
  assert.equal(selected.body, '# Top\n\nText <!-- prax-memory:start --> inline.\n\n```sh\n# a shell comment\n```\n<!-- prax-library:end -->');
  const block = compileAgentsBlock({ project: 'demo', documents: [selected] });
  assert.match(block, /^\*\*Top\*\*$/m);
  assert.match(block, /^# a shell comment$/m, 'a fenced line is code, not a heading');
  assert.doesNotMatch(block, /<!--\s*prax-/);
  assert.match(block, /`prax-memory:start marker`/);
  assert.equal(neutraliseMarkers('<!-- prax-library:start -->'), '`prax-library:start marker`');
  // The file stays editable with both marker pairs in it.
  const text = applyManagedBlock('<!-- prax-memory:start -->\nx\n<!-- prax-memory:end -->\n', { mode: 'write', body: block, name: 'prax-library' });
  assert.equal(applyManagedBlock(text, { mode: 'write', body: 'y', name: 'prax-memory' }).includes('y'), true);
});

test('the block is bounded: long bodies are cut with a note, surplus documents are counted, fences are closed', () => {
  const long = exportDoc({ title: 'A long one', body: `${'line of text\n'.repeat(80)}\`\`\`js\n${'code();\n'.repeat(300)}\`\`\`\n` });
  const many = Array.from({ length: 30 }, (_, i) => exportDoc({ title: `Rule ${String(i).padStart(2, '0')}`, body: 'x'.repeat(600) }));
  const selected = selectBlockDocuments([long, ...many]);
  const block = compileAgentsBlock({ project: 'demo', documents: selected });
  assert.ok(block.length <= DEFAULT_BLOCK_MAX_CHARS, `block is ${block.length} characters`);
  assert.match(block, /_Truncated at 1500 characters; full text: `prax get [0-9a-f-]{36}`\._/);
  const fences = block.match(/^```/gm) || [];
  assert.equal(fences.length % 2, 0, 'every opened fence is closed');
  const shown = (block.match(/^### /gm) || []).length;
  assert.ok(shown > 0 && shown < selected.length);
  assert.match(block, new RegExp(`_Not shown: ${selected.length - shown} more verified documents \\(block limit ${DEFAULT_BLOCK_MAX_CHARS} characters\\)`));
  // A larger limit shows them all and needs no note.
  const all = compileAgentsBlock({ project: 'demo', documents: selected, maxChars: 100000 });
  assert.equal((all.match(/^### /gm) || []).length, selected.length);
  assert.doesNotMatch(all, /Not shown/);
});

test('compilation is deterministic and an empty selection says so', () => {
  const docs = selectBlockDocuments([exportDoc({ title: 'B' }), exportDoc({ title: 'A' })]);
  assert.equal(compileAgentsBlock({ project: 'demo', documents: docs }), compileAgentsBlock({ project: 'demo', documents: [...docs].reverse().sort((a, b) => a.title.localeCompare(b.title)) }));
  assert.match(compileAgentsBlock({ project: 'demo', documents: [] }), /_No verified documents match yet\./);
});

test('writing is idempotent, keeps surrounding text, follows a symlink, and removes cleanly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prax-block-'));
  try {
    const target = join(dir, 'AGENTS.md');
    writeFileSync(target, '# Project rules\n\nKeep this.\n');
    chmodSync(target, 0o640);
    symlinkSync('AGENTS.md', join(dir, 'CLAUDE.md'));
    assert.equal(defaultInstructionFile(dir), target);

    const first = editManagedBlock(join(dir, 'CLAUDE.md'), { mode: 'write', body: 'rules v1', name: 'prax-library' });
    assert.equal(first.action, 'added');
    assert.ok(lstatSync(join(dir, 'CLAUDE.md')).isSymbolicLink(), 'the link stays a link');
    assert.equal(readFileSync(target, 'utf8'), '# Project rules\n\nKeep this.\n\n<!-- prax-library:start -->\nrules v1\n<!-- prax-library:end -->\n');
    assert.equal(statSync(target).mode & 0o777, 0o640, 'the mode is kept');

    const mtime = statSync(target).mtimeMs;
    assert.equal(editManagedBlock(target, { mode: 'write', body: 'rules v1', name: 'prax-library' }).action, 'unchanged');
    assert.equal(statSync(target).mtimeMs, mtime, 'an unchanged block is not rewritten');
    assert.equal(editManagedBlock(target, { mode: 'write', body: 'rules v2', name: 'prax-library' }).action, 'updated');
    assert.match(readFileSync(target, 'utf8'), /rules v2/);

    assert.equal(editManagedBlock(target, { mode: 'remove', name: 'prax-library' }).action, 'removed');
    assert.equal(readFileSync(target, 'utf8'), '# Project rules\n\nKeep this.\n');
    assert.equal(editManagedBlock(target, { mode: 'remove', name: 'prax-library' }).action, 'absent');

    writeFileSync(target, 'a\n<!-- prax-library:start -->\nb\n');
    assert.throws(() => editManagedBlock(target, { mode: 'write', body: 'c', name: 'prax-library' }), ManagedBlockError);
    assert.equal(readFileSync(target, 'utf8'), 'a\n<!-- prax-library:start -->\nb\n', 'a malformed file is left unchanged');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The installer embeds the same routine as a heredoc. Run it on the same
// inputs and require identical bytes, so the two cannot drift apart.
test('managedBlock.js and install.sh edit_instructions produce identical files', () => {
  const script = readFileSync(join(root, 'skills', 'install.sh'), 'utf8');
  const heredoc = /edit_instructions\(\) \{\n {2}node --input-type=module - "\$@" <<'NODE'\n([\s\S]*?)\nNODE\n\}/.exec(script);
  assert.ok(heredoc, 'install.sh still embeds edit_instructions');
  const dir = mkdtempSync(join(tmpdir(), 'prax-block-parity-'));
  try {
    const cases = [
      ['write', '', 'new body'],
      ['write', 'intro\n', 'new body'],
      ['write', 'intro\n\n<!-- prax-memory:start -->\nold\n<!-- prax-memory:end -->\n\noutro\n', 'new body'],
      ['write', '<!-- prax-memory:start -->\nold\n<!-- prax-memory:end -->', 'x'],
      ['remove', 'intro\n\n<!-- prax-memory:start -->\nold\n<!-- prax-memory:end -->\n', ''],
      ['remove', 'intro\n<!-- prax-memory:start -->\nold\n<!-- prax-memory:end -->\noutro\n', ''],
      ['write', 'a\n<!-- prax-memory:start -->\nb\n', 'x'],
      ['write', 'a <!-- prax-memory:start -->\nb\n<!-- prax-memory:end -->\n', 'x'],
      ['remove', 'no markers\n', ''],
    ];
    cases.forEach(([mode, before, body], i) => {
      const shellFile = join(dir, `shell-${i}.md`);
      const libFile = join(dir, `lib-${i}.md`);
      writeFileSync(shellFile, before);
      writeFileSync(libFile, before);
      const shell = spawnSync(process.execPath, ['--input-type=module', '-', mode, shellFile, body], { input: heredoc[1], encoding: 'utf8' });
      let libFailed = false;
      try { editManagedBlock(libFile, { mode, body, name: 'prax-memory' }); } catch (error) {
        assert.ok(error instanceof ManagedBlockError);
        libFailed = true;
      }
      assert.equal(shell.status !== 0, libFailed, `case ${i}: both refuse or both succeed (${shell.stderr})`);
      assert.equal(readFileSync(libFile, 'utf8'), readFileSync(shellFile, 'utf8'), `case ${i}: identical result`);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
