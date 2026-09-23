// Two managed blocks share the same instruction files: the skills' standing
// block (`<!-- prax-memory:start -->`, install.sh's edit_instructions) and the
// compiled Library block (`<!-- prax-library:start -->`, cli/lib/managedBlock.js
// through `prax mirror --agents-block`). Each editor must leave the other
// block byte-for-byte alone, in either order in the file, on install or
// refresh, on removal (--uninstall, `prax mirror --agents-block --remove`) and
// when the other block is malformed. The first half drives both routines
// directly; the second runs the real entry points against a throwaway HOME and
// app bundle, so the real ~/.claude, ~/.codex, ~/.copilot and ~/.gemini are
// never touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyManagedBlock, ManagedBlockError } from '../../cli/lib/managedBlock.js';
import { createDb } from '../../server/db.js';
import { runMigrations } from '../../server/migrate.js';
import { buildApp } from '../../server/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SILENT = { info() {}, error() {}, warn() {} };
const USER = '# Mine\n\nKeep this.\n';
const M = (body) => `<!-- prax-memory:start -->\n${body}\n<!-- prax-memory:end -->`;
const L = (body) => `<!-- prax-library:start -->\n${body}\n<!-- prax-library:end -->`;

const heredoc = (() => {
  const script = readFileSync(join(root, 'skills', 'install.sh'), 'utf8');
  const match = /edit_instructions\(\) \{\n {2}node --input-type=module - "\$@" <<'NODE'\n([\s\S]*?)\nNODE\n\}/.exec(script);
  assert.ok(match, 'install.sh still embeds edit_instructions');
  return match[1];
})();

// The installer's routine (prax-memory) on a file: { ok, text, stderr }.
function installerEdit(dir, text, mode, body = '') {
  const file = join(dir, `installer-${Math.random().toString(36).slice(2)}.md`);
  writeFileSync(file, text);
  const run = spawnSync(process.execPath, ['--input-type=module', '-', mode, file, body], { input: heredoc, encoding: 'utf8' });
  const after = readFileSync(file, 'utf8');
  rmSync(file, { force: true });
  return { ok: run.status === 0, text: after, stderr: run.stderr };
}

// managedBlock.js on the same text, as a pure edit: { ok, text }.
function libraryEdit(text, mode, body = '', name = 'prax-library') {
  try {
    return { ok: true, text: applyManagedBlock(text, { mode, body, name }) };
  } catch (error) {
    assert.ok(error instanceof ManagedBlockError, error.message);
    return { ok: false, text };
  }
}

// One editor per block. `memory` runs both implementations of the routine
// and requires the same outcome, so the parity also holds with two blocks.
function editors(dir) {
  return {
    memory(text, mode, body) {
      const shell = installerEdit(dir, text, mode, body);
      const lib = libraryEdit(text, mode, body, 'prax-memory');
      assert.equal(shell.ok, lib.ok, `both routines refuse or both succeed (${shell.stderr})`);
      assert.equal(shell.text, lib.text, 'both routines write the same bytes');
      return lib;
    },
    library: (text, mode, body) => libraryEdit(text, mode, body, 'prax-library'),
  };
}

const ORDERS = [
  { name: 'memory block first', first: 'memory', second: 'library', blocks: { memory: M, library: L } },
  { name: 'library block first', first: 'library', second: 'memory', blocks: { memory: M, library: L } },
];

function writeBoth(edit, order) {
  const one = edit[order.first](USER, 'write', `${order.first} v1`);
  assert.ok(one.ok);
  const two = edit[order.second](one.text, 'write', `${order.second} v1`);
  assert.ok(two.ok);
  return { one: one.text, both: two.text };
}

test('adding or refreshing one block leaves the other byte-for-byte, in either order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prax-blocks-'));
  try {
    const edit = editors(dir);
    for (const order of ORDERS) {
      const { one, both } = writeBoth(edit, order);
      const block = order.blocks;
      assert.equal(one, `${USER}\n${block[order.first](`${order.first} v1`)}\n`, order.name);
      assert.equal(both, `${one}\n${block[order.second](`${order.second} v1`)}\n`, `${order.name}: appended after, the first block untouched`);
      for (const which of ['memory', 'library']) {
        const refreshed = edit[which](both, 'write', `${which} v2`);
        assert.ok(refreshed.ok, `${order.name}: refresh ${which}`);
        assert.equal(refreshed.text, both.replace(block[which](`${which} v1`), block[which](`${which} v2`)),
          `${order.name}: refreshing ${which} changes only its own body`);
        assert.equal(edit[which](refreshed.text, 'write', `${which} v2`).text, refreshed.text, 'a second refresh is a no-op');
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('removing one block leaves the other; removing both in any order restores the original bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prax-blocks-'));
  try {
    const edit = editors(dir);
    for (const order of ORDERS) {
      const { both } = writeBoth(edit, order);
      for (const [gone, kept] of [['memory', 'library'], ['library', 'memory']]) {
        const removed = edit[gone](both, 'remove');
        assert.ok(removed.ok, `${order.name}: remove ${gone}`);
        const onlyKept = edit[kept](USER, 'write', `${kept} v1`).text;
        assert.equal(removed.text, onlyKept, `${order.name}: removing ${gone} leaves exactly the file with only ${kept}`);
        const none = edit[kept](removed.text, 'remove');
        assert.equal(none.text, USER, `${order.name}: removing ${gone} then ${kept} restores the original`);
        assert.equal(edit[gone](removed.text, 'remove').text, removed.text, 'removing an absent block changes nothing');
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Malformed shapes of one block's markers.
const MALFORMED = (name) => [
  `<!-- ${name}:start -->\nno end\n`,
  `no start\n<!-- ${name}:end -->\n`,
  `<!-- ${name}:end -->\nreversed\n<!-- ${name}:start -->\n`,
  `<!-- ${name}:start -->\na\n<!-- ${name}:end -->\n\n<!-- ${name}:start -->\nb\n<!-- ${name}:end -->\n`,
  `text <!-- ${name}:start -->\ninline\n<!-- ${name}:end -->\n`,
];

test('a malformed block refuses only its own edits; the other block is still edited, and the malformed text is kept', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prax-blocks-'));
  try {
    const edit = editors(dir);
    for (const [broken, healthy, wrap] of [['memory', 'library', L], ['library', 'memory', M]]) {
      for (const bad of MALFORMED(`prax-${broken}`)) {
        for (const text of [`${USER}\n${bad}\n${wrap('ok v1')}\n`, `${USER}\n${wrap('ok v1')}\n\n${bad}`]) {
          for (const mode of ['write', 'remove']) {
            const refused = edit[broken](text, mode, 'new');
            assert.equal(refused.ok, false, `${broken} ${mode} refuses: ${JSON.stringify(bad)}`);
            assert.equal(refused.text, text, 'the file is left as it was');
          }
          const refreshed = edit[healthy](text, 'write', 'ok v2');
          assert.ok(refreshed.ok, `${healthy} still refreshes beside malformed ${broken} markers`);
          assert.equal(refreshed.text, text.replace(wrap('ok v1'), wrap('ok v2')));
          const removed = edit[healthy](text, 'remove');
          assert.ok(removed.ok, `${healthy} is still removed beside malformed ${broken} markers`);
          assert.ok(removed.text.includes(bad.trimEnd()), 'the malformed text is untouched');
          assert.doesNotMatch(removed.text, new RegExp(`prax-${healthy}:`));
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('nested or interleaved blocks, and marker-shaped text in a new body, refuse every edit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prax-blocks-'));
  try {
    const edit = editors(dir);
    const tangled = [
      `${USER}\n<!-- prax-memory:start -->\nm\n${L('l')}\n<!-- prax-memory:end -->\n`,
      `${USER}\n<!-- prax-library:start -->\nl\n${M('m')}\n<!-- prax-library:end -->\n`,
      `${USER}\n<!-- prax-memory:start -->\nm\n<!-- prax-library:start -->\nboth\n<!-- prax-memory:end -->\nl\n<!-- prax-library:end -->\n`,
      `${USER}\n<!-- prax-library:start -->\nl\n<!-- prax-memory:start -->\nboth\n<!-- prax-library:end -->\nm\n<!-- prax-memory:end -->\n`,
    ];
    for (const text of tangled) {
      for (const which of ['memory', 'library']) {
        for (const mode of ['write', 'remove']) {
          const result = edit[which](text, mode, 'new');
          assert.equal(result.ok, false, `${which} ${mode} refuses: ${JSON.stringify(text)}`);
          assert.equal(result.text, text);
        }
      }
    }
    const both = writeBoth(edit, ORDERS[0]).both;
    for (const [which, other] of [['memory', 'library'], ['library', 'memory']]) {
      const result = edit[which](both, 'write', `sneaky\n<!-- prax-${other}:end -->\nmore`);
      assert.equal(result.ok, false, `${which}: a body holding a marker is refused`);
      assert.equal(result.text, both);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the real entry points ---------------------------------------------------

function fakeAppBundle(base) {
  const app = join(base, 'Prax.app', 'Contents', 'Resources', 'resources', 'app');
  for (const dir of ['skills', 'cli', 'server']) cpSync(join(root, dir), join(app, dir), { recursive: true });
  cpSync(join(root, 'public', 'js'), join(app, 'public', 'js'), { recursive: true });
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'prax', version: '9.9.9', type: 'module' }));
  return app;
}

function sh(args, env, input) {
  return new Promise((resolve) => {
    const child = execFile('sh', args, { env, encoding: 'utf8' },
      (error, stdout, stderr) => resolve({ status: error ? error.code : 0, stdout, stderr }));
    if (input !== undefined) child.stdin.end(input);
  });
}

// Asynchronous: the app under test answers from this same process.
function praxCli(args, env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [join(root, 'cli', 'prax.js'), ...args], { env, encoding: 'utf8' },
      (error, stdout, stderr) => resolve({ status: error ? error.code : 0, stdout, stderr }));
  });
}

function installEnv(base, file, apiUrl = 'http://127.0.0.1:9') {
  const home = join(base, 'home');
  mkdirSync(home, { recursive: true });
  return {
    HOME: home,
    PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
    PRAX_SKILLS_DIR: join(base, 'agents-skills'),
    PRAX_CLAUDE_SKILLS_DIR: join(base, 'claude-skills'),
    PRAX_GEMINI_SKILLS_DIR: join(base, 'gemini-skills'),
    PRAX_BIN_DIR: join(base, 'bin'),
    PRAX_COPILOT_INSTRUCTIONS_DIR: join(base, 'copilot'),
    PRAX_CODEX_INSTRUCTIONS: join(base, 'codex', 'AGENTS.md'),
    PRAX_GEMINI_INSTRUCTIONS: join(base, 'gemini', 'GEMINI.md'),
    PRAX_CLAUDE_INSTRUCTIONS: file,
    PRAX_API_URL: apiUrl,
  };
}

// The skills' block exactly as the installer writes it with this environment
// (a fresh install into an empty file), so a test can place it before or after
// the other block.
async function realMemoryBlock(installer, env) {
  const scratch = join(dirname(env.PRAX_CLAUDE_INSTRUCTIONS), 'scratch', 'CLAUDE.md');
  const result = await sh([installer, '--instructions'], { ...env, PRAX_CLAUDE_INSTRUCTIONS: scratch });
  assert.equal(result.status, 0, result.stderr);
  const text = readFileSync(scratch, 'utf8');
  assert.match(text, /^<!-- prax-memory:start -->\n[\s\S]*\n<!-- prax-memory:end -->\n$/);
  return text.slice(0, -1);
}

test('install.sh --instructions and --uninstall, and prax mirror --agents-block [--remove], keep the other block intact in either order', async () => {
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT });
  const server = await buildApp({ db });
  await server.listen({ port: 0, host: '127.0.0.1' });
  const base = mkdtempSync(join(tmpdir(), 'prax-blocks-e2e-'));
  try {
    const created = await server.inject({
      method: 'POST', url: '/api/library/documents',
      payload: { project: 'memory', title: 'Squash-merge releases', body: 'Releases are squash-merged.', documentType: 'decision', tags: [] },
    });
    const decision = created.json();
    await server.inject({ method: 'POST', url: `/api/library/documents/${decision.id}/verify`, payload: { verified: true, as: 'Mark', revision: decision.revision } });
    const apiUrl = `http://127.0.0.1:${server.server.address().port}`;
    const app = fakeAppBundle(base);
    const installer = join(app, 'skills', 'install.sh');
    const staleMemory = M('stale standing rules');
    const staleLibrary = L('stale compiled rules');

    for (const [i, layout] of [['memory-first', (m, l) => `${USER}\n${m}\n\n${l}\n`], ['library-first', (m, l) => `${USER}\n${l}\n\n${m}\n`]].entries()) {
      const [name, place] = layout;
      const caseDir = join(base, `case-${i}`);
      const file = join(caseDir, 'CLAUDE.md');
      const env = installEnv(caseDir, file, apiUrl);
      mkdirSync(caseDir, { recursive: true });
      const memory = await realMemoryBlock(installer, env);

      // install.sh --instructions refreshes the skills' block in place.
      writeFileSync(file, place(staleMemory, staleLibrary));
      const installed = await sh([installer, '--instructions'], env);
      assert.equal(installed.status, 0, installed.stderr);
      assert.equal(readFileSync(file, 'utf8'), place(memory, staleLibrary), `${name}: only the skills' block changed`);

      // prax mirror --agents-block refreshes the compiled block in place.
      const compiled = await praxCli(['mirror', '--agents-block', '--project', 'memory', '--file', file, '--url', apiUrl], env);
      assert.equal(compiled.status, 0, compiled.stderr);
      const afterCompile = readFileSync(file, 'utf8');
      const library = /<!-- prax-library:start -->[\s\S]*?<!-- prax-library:end -->/.exec(afterCompile)[0];
      assert.match(library, /### Squash-merge releases/);
      assert.equal(afterCompile, place(memory, library), `${name}: only the compiled block changed`);

      // prax mirror --agents-block --remove takes the compiled block only.
      const removed = await praxCli(['mirror', '--agents-block', '--remove', '--file', file], env);
      assert.equal(removed.status, 0, removed.stderr);
      assert.equal(readFileSync(file, 'utf8'), `${USER}\n${memory}\n`, `${name}: the skills' block is untouched`);

      // --uninstall removes both, whichever comes first, and gives back the original.
      writeFileSync(file, place(memory, library));
      const uninstalled = await sh([installer, '--uninstall'], env);
      assert.equal(uninstalled.status, 0, uninstalled.stderr);
      assert.equal(readFileSync(file, 'utf8'), USER, `${name}: --uninstall restores the original bytes`);

      // A payload-less uninstall (piped) removes the skills' block and leaves
      // the compiled block, which it cannot edit safely, exactly as it was.
      writeFileSync(file, place(memory, library));
      const piped = await sh(['-s', '--', '--uninstall'], env, readFileSync(join(root, 'skills', 'install.sh')));
      assert.notEqual(piped.status, 0);
      assert.equal(readFileSync(file, 'utf8'), `${USER}\n${library}\n`, `${name}: the compiled block is left as it was`);
    }
  } finally {
    await server.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test('the real entry points refuse a malformed block of their own and keep a malformed block of the other', async () => {
  const base = mkdtempSync(join(tmpdir(), 'prax-blocks-malformed-'));
  try {
    const app = fakeAppBundle(base);
    const installer = join(app, 'skills', 'install.sh');
    const file = join(base, 'case', 'CLAUDE.md');
    const env = installEnv(join(base, 'case'), file);
    mkdirSync(dirname(file), { recursive: true });
    const memory = await realMemoryBlock(installer, env);
    const library = L('compiled rules');

    // A malformed skills' block: the installer refuses and changes nothing;
    // the mirror still refreshes or removes its own block around it.
    const badMemory = '<!-- prax-memory:start -->\nhalf a block\n';
    for (const text of [`${USER}\n${badMemory}\n${library}\n`, `${USER}\n${library}\n\n${badMemory}`]) {
      writeFileSync(file, text);
      const installed = await sh([installer, '--instructions'], env);
      assert.notEqual(installed.status, 0, 'install refuses a malformed skills block');
      assert.match(installed.stderr, /Malformed Prax instruction markers/);
      assert.equal(readFileSync(file, 'utf8'), text, 'the file, compiled block included, is unchanged');
      const removed = await praxCli(['mirror', '--agents-block', '--remove', '--file', file], env);
      assert.equal(removed.status, 0, removed.stderr);
      const after = readFileSync(file, 'utf8');
      assert.doesNotMatch(after, /prax-library:/);
      assert.ok(after.includes(badMemory.trimEnd()), 'the malformed skills block is kept as it was');
    }

    // A malformed compiled block: the mirror refuses and changes nothing; the
    // installer still refreshes and removes its own block around it.
    const badLibrary = '<!-- prax-library:start -->\nhalf a block\n';
    for (const text of [`${USER}\n${badLibrary}\n${memory}\n`, `${USER}\n${memory}\n\n${badLibrary}`]) {
      writeFileSync(file, text.replace(memory, M('stale')));
      const installed = await sh([installer, '--instructions'], env);
      assert.equal(installed.status, 0, installed.stderr);
      assert.equal(readFileSync(file, 'utf8'), text, 'the skills block is refreshed; the malformed compiled block is kept');
      const refused = await praxCli(['mirror', '--agents-block', '--remove', '--file', file], env);
      assert.notEqual(refused.status, 0);
      assert.match(refused.stderr, /Malformed prax-library markers/);
      assert.equal(readFileSync(file, 'utf8'), text);
      const uninstalled = await sh([installer, '--uninstall'], env);
      assert.notEqual(uninstalled.status, 0, 'the uninstall reports the block it could not remove');
      const after = readFileSync(file, 'utf8');
      assert.doesNotMatch(after, /prax-memory:/, 'the skills block is removed');
      assert.ok(after.includes(badLibrary.trimEnd()), 'the malformed compiled block is kept as it was');
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
