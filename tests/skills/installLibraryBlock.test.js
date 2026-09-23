// install.sh --library-block: the memory project's verified conventions
// compiled into each tool's global instruction file, in a marked block of its
// own beside the skills' block; idempotent, removed by --uninstall, and
// harmless when the app is not running. A throwaway HOME and app bundle keep
// the real ~/.claude, ~/.codex, ~/.copilot and ~/.gemini untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../../server/db.js';
import { runMigrations } from '../../server/migrate.js';
import { buildApp } from '../../server/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SILENT = { info() {}, error() {}, warn() {} };

// The app payload as the desktop bundle ships it.
function fakeAppBundle(base) {
  const app = join(base, 'Prax.app', 'Contents', 'Resources', 'resources', 'app');
  // Whole folders, as scripts/prepare-sidecar.mjs ships them.
  for (const dir of ['skills', 'cli', 'server']) cpSync(join(root, dir), join(app, dir), { recursive: true });
  cpSync(join(root, 'public', 'js'), join(app, 'public', 'js'), { recursive: true });
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'prax', version: '9.9.9', type: 'module' }));
  return app;
}

function run(installer, args, env) {
  return new Promise((resolve) => {
    execFile('sh', [installer, ...args], { env, encoding: 'utf8' },
      (error, stdout, stderr) => resolve({ status: error ? error.code : 0, stdout, stderr }));
  });
}

test('--library-block compiles verified memory conventions into every instruction file, idempotently, and --uninstall removes it', async () => {
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT });
  const server = await buildApp({ db });
  await server.listen({ port: 0, host: '127.0.0.1' });
  const base = mkdtempSync(join(tmpdir(), 'prax-install-library-'));
  try {
    const created = await server.inject({
      method: 'POST', url: '/api/library/documents',
      payload: { project: 'memory', title: 'Squash-merge releases', body: 'Releases are squash-merged.', documentType: 'decision', tags: [] },
    });
    const decision = created.json();
    await server.inject({ method: 'POST', url: `/api/library/documents/${decision.id}/verify`, payload: { verified: true, as: 'Mark', revision: decision.revision } });
    await server.inject({
      method: 'POST', url: '/api/library/documents', headers: { 'x-prax-origin': 'agent' },
      payload: { project: 'memory', title: 'Unreviewed agent idea', body: 'Maybe.', documentType: 'decision', tags: [] },
    });

    const app = fakeAppBundle(base);
    const installer = join(app, 'skills', 'install.sh');
    const home = join(base, 'home');
    mkdirSync(home);
    const files = {
      PRAX_CLAUDE_INSTRUCTIONS: join(base, 'claude', 'CLAUDE.md'),
      PRAX_CODEX_INSTRUCTIONS: join(base, 'codex', 'AGENTS.md'),
      PRAX_GEMINI_INSTRUCTIONS: join(base, 'gemini', 'GEMINI.md'),
    };
    const copilot = join(base, 'copilot');
    const env = {
      HOME: home,
      PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
      PRAX_SKILLS_DIR: join(base, 'agents-skills'),
      PRAX_CLAUDE_SKILLS_DIR: join(base, 'claude-skills'),
      PRAX_GEMINI_SKILLS_DIR: join(base, 'gemini-skills'),
      PRAX_BIN_DIR: join(base, 'bin'),
      PRAX_COPILOT_INSTRUCTIONS_DIR: copilot,
      PRAX_API_URL: `http://127.0.0.1:${server.server.address().port}`,
      ...files,
    };
    const all = [...Object.values(files), join(copilot, 'AGENTS.md')];
    mkdirSync(dirname(files.PRAX_CLAUDE_INSTRUCTIONS), { recursive: true });
    writeFileSync(files.PRAX_CLAUDE_INSTRUCTIONS, '# Mine\n');

    const first = await run(installer, ['--instructions', '--library-block'], env);
    assert.equal(first.status, 0, first.stderr);
    for (const file of all) {
      const text = readFileSync(file, 'utf8');
      assert.match(text, /<!-- prax-memory:start -->/, `${file} keeps the skills block`);
      assert.match(text, /<!-- prax-library:start -->\n## Verified project knowledge: memory/, file);
      assert.match(text, /### Squash-merge releases/);
      assert.doesNotMatch(text, /Unreviewed agent idea/, 'unverified documents are never compiled');
    }
    assert.match(readFileSync(files.PRAX_CLAUDE_INSTRUCTIONS, 'utf8'), /^# Mine\n/);

    const before = all.map((file) => readFileSync(file, 'utf8'));
    const again = await run(installer, ['--library-block'], env);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /Compiled Prax block already current in/);
    assert.deepEqual(all.map((file) => readFileSync(file, 'utf8')), before, 'a re-run changes nothing');

    // With the app gone the install still succeeds and the files stay as they were.
    const offline = await run(installer, ['--library-block'], { ...env, PRAX_API_URL: 'http://127.0.0.1:9' });
    assert.equal(offline.status, 0, offline.stderr);
    assert.match(offline.stderr, /could not compile the verified-conventions block/);
    assert.deepEqual(all.map((file) => readFileSync(file, 'utf8')), before);

    const removed = await run(installer, ['--uninstall'], env);
    assert.equal(removed.status, 0, removed.stderr);
    for (const file of all) {
      if (!existsSync(file)) continue;
      assert.doesNotMatch(readFileSync(file, 'utf8'), /prax-(library|memory):/, `${file} holds no block`);
    }
    assert.equal(readFileSync(files.PRAX_CLAUDE_INSTRUCTIONS, 'utf8'), '# Mine\n');
  } finally {
    await server.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test('an uninstall without the app payload leaves a compiled block in place and fails, naming the file', async () => {
  const base = mkdtempSync(join(tmpdir(), 'prax-install-library-piped-'));
  try {
    const home = join(base, 'home');
    mkdirSync(home);
    const claude = join(base, 'CLAUDE.md');
    const text = '# Mine\n\n<!-- prax-library:start -->\nrules\n<!-- prax-library:end -->\n';
    writeFileSync(claude, text);
    // Piped through `sh -s`: no pack, so no CLI to edit with.
    const result = await new Promise((resolve) => {
      const child = execFile('sh', ['-s', '--', '--uninstall'], {
        encoding: 'utf8',
        env: {
          HOME: home, PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
          PRAX_CLAUDE_INSTRUCTIONS: claude, PRAX_SKILLS_DIR: join(base, 's'), PRAX_CLAUDE_SKILLS_DIR: join(base, 'c'),
          PRAX_GEMINI_SKILLS_DIR: join(base, 'g'), PRAX_BIN_DIR: join(base, 'bin'),
        },
      }, (error, stdout, stderr) => resolve({ status: error ? error.code : 0, stdout, stderr }));
      child.stdin.end(readFileSync(join(root, 'skills', 'install.sh')));
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /compiled Prax block in .*CLAUDE\.md needs the app payload's CLI/);
    assert.equal(readFileSync(claude, 'utf8'), text);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
