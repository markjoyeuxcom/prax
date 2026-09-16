import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The one path a new machine takes: skills/install.sh against a repository it has
// never seen. The test builds a throwaway git repository holding this working
// tree's skills/ folder, so it runs offline, on a detached HEAD in CI, and never
// touches the real ~/.agents, ~/.claude or ~/.gemini: every run gets a throwaway
// HOME, so a destination a test forgets to override still lands in the temp dir
// (a forgotten PRAX_GEMINI_SKILLS_DIR once left dangling links in the real home).

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const installer = join(root, 'skills', 'install.sh');
const SKILLS = ['prax-recall', 'prax-remember'];

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

// A git repository whose only content is skills/, on a branch named main.
function sourceRepo(base) {
  const repo = join(base, 'source');
  mkdirSync(repo);
  cpSync(join(root, 'skills'), join(repo, 'skills'), { recursive: true });
  git(repo, 'init', '--quiet', '--initial-branch=main');
  git(repo, '-c', 'user.email=t@example.test', '-c', 'user.name=t', 'add', '.');
  git(repo, '-c', 'user.email=t@example.test', '-c', 'user.name=t', 'commit', '--quiet', '-m', 'skills');
  return repo;
}

// A HOME inside the test's temp dir: the installer's defaults all hang off
// $HOME, so this is the isolation that does not depend on remembering a flag.
function isolatedHome(base) {
  const home = join(base, 'home');
  mkdirSync(home, { recursive: true });
  return home;
}

function run(args, env) {
  if (!env?.HOME) throw new Error('installer tests must pass an isolated HOME (isolatedHome(base))');
  return spawnSync('sh', [installer, ...args], {
    env: {
      // The running Node first, so the installer's version check sees a real
      // binary rather than a version-manager shim that needs $HOME state.
      PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
      ...env,
    },
    encoding: 'utf8',
  });
}

test('install.sh installs both skills from a repository, links them for Claude Code and Antigravity, runs, updates and uninstalls', () => {
  const base = mkdtempSync(join(tmpdir(), 'prax-install-'));
  try {
    const repo = sourceRepo(base);
    const dest = join(base, 'agents-skills');
    const claude = join(base, 'claude-skills');
    const gemini = join(base, 'gemini-skills');
    const env = {
      HOME: isolatedHome(base),
      PRAX_SKILLS_REPO: repo,
      PRAX_SKILLS_DIR: dest,
      PRAX_CLAUDE_SKILLS_DIR: claude,
      PRAX_GEMINI_SKILLS_DIR: gemini,
    };

    const install = run([], env);
    assert.equal(install.status, 0, install.stderr);
    assert.match(install.stdout, /over explicit\./);
    for (const skill of SKILLS) {
      assert.ok(existsSync(join(dest, skill, 'SKILL.md')), `${skill}/SKILL.md installed`);
      const script = readdirSync(join(dest, skill, 'scripts')).find((f) => f.endsWith('.mjs'));
      assert.equal(
        readFileSync(join(dest, skill, 'scripts', script), 'utf8'),
        readFileSync(join(root, 'skills', skill, 'scripts', script), 'utf8'),
        `${skill} bundle is byte-identical to the source`,
      );
      assert.ok(lstatSync(join(claude, skill)).isSymbolicLink(), `${skill} is linked for Claude Code`);
      assert.equal(readlinkSync(join(claude, skill)), join(dest, skill));
      assert.ok(lstatSync(join(gemini, skill)).isSymbolicLink(), `${skill} is linked for Antigravity`);
      assert.equal(readlinkSync(join(gemini, skill)), join(dest, skill));
    }

    // The installed script runs from outside any checkout: no args is a usage error, not a crash.
    const usage = spawnSync(process.execPath, [join(claude, 'prax-recall', 'scripts', 'recall.mjs')], { encoding: 'utf8' });
    assert.equal(usage.status, 2);
    assert.match(usage.stderr, /Usage: recall/);

    // Re-running updates in place without duplicating or breaking the links.
    const again = run([], env);
    assert.equal(again.status, 0, again.stderr);
    assert.ok(lstatSync(join(claude, 'prax-recall')).isSymbolicLink());
    assert.ok(lstatSync(join(gemini, 'prax-recall')).isSymbolicLink());

    const uninstall = run(['--uninstall'], env);
    assert.equal(uninstall.status, 0, uninstall.stderr);
    for (const skill of SKILLS) {
      assert.equal(existsSync(join(dest, skill)), false);
      assert.equal(existsSync(join(claude, skill)), false);
      assert.equal(existsSync(join(gemini, skill)), false);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('install.sh --instructions adds one marked block per tool, keeps existing content, is idempotent, and --uninstall removes it', () => {
  const base = mkdtempSync(join(tmpdir(), 'prax-install-instr-'));
  try {
    const repo = sourceRepo(base);
    const home = isolatedHome(base);
    const dest = join(base, 'agents-skills');
    const env = {
      HOME: home, PRAX_SKILLS_REPO: repo, PRAX_SKILLS_DIR: dest,
      PRAX_CLAUDE_SKILLS_DIR: join(base, 'claude-skills'), PRAX_GEMINI_SKILLS_DIR: join(base, 'gemini-skills'),
    };
    // A pre-existing global file must keep what it had.
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'CLAUDE.md'), '# Mine\n\nKeep me.\n');

    const first = run(['--instructions'], env);
    assert.equal(first.status, 0, first.stderr);
    const files = [
      join(home, '.claude', 'CLAUDE.md'),
      join(home, '.codex', 'AGENTS.md'),
      join(home, '.copilot', 'instructions', 'AGENTS.md'),
    ];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      assert.equal((text.match(/<!-- prax-memory:start -->/g) || []).length, 1, `${file} has exactly one block`);
      assert.match(text, /<!-- prax-memory:end -->\s*$/, `${file} block is closed`);
      assert.match(text, /## Long-term memory \(Prax\)/);
      assert.ok(text.includes(`node "${dest}/prax-recall/scripts/recall.mjs"`), `${file} names the installed recall script`);
      assert.ok(text.includes(`node "${dest}/prax-remember/scripts/remember.mjs"`), `${file} names the installed remember script`);
      assert.doesNotMatch(text, /__SKILLS_DIR__/, 'the placeholder is fully substituted');
    }
    assert.match(readFileSync(files[0], 'utf8'), /^# Mine\n\nKeep me\.\n/, 'existing content stays above the block');
    assert.match(first.stdout, /export COPILOT_CUSTOM_INSTRUCTIONS_DIRS="[^"]*\/\.copilot\/instructions"/, 'Copilot needs the env var; the installer prints the export');
    assert.match(first.stdout, /Antigravity has no global instructions file/, 'Antigravity gets a workspace note, not a global write');

    const again = run(['--instructions'], env);
    assert.equal(again.status, 0, again.stderr);
    for (const file of files) {
      assert.equal((readFileSync(file, 'utf8').match(/prax-memory:start/g) || []).length, 1, `${file} gets no second block`);
    }
    assert.match(again.stdout, /instructions already present/);

    // The env var already naming the directory changes the hint, not the file.
    const told = run(['--instructions'], { ...env, COPILOT_CUSTOM_INSTRUCTIONS_DIRS: `/elsewhere,${join(home, '.copilot', 'instructions')}` });
    assert.match(told.stdout, /already names/);

    const uninstall = run(['--uninstall'], env);
    assert.equal(uninstall.status, 0, uninstall.stderr);
    for (const file of files) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /prax-memory|Long-term memory \(Prax\)/, `${file} block removed`);
    }
    assert.match(readFileSync(files[0], 'utf8'), /# Mine\n\nKeep me\./, 'uninstall leaves the rest of the file alone');

    const bad = run(['--nope'], env);
    assert.equal(bad.status, 2, 'an unknown option is an error, never silently ignored');
    assert.match(bad.stderr, /unknown option --nope/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('install.sh refuses a Node older than 20 with an actionable message and installs nothing', () => {
  const base = mkdtempSync(join(tmpdir(), 'prax-install-oldnode-'));
  try {
    const repo = sourceRepo(base);
    const shims = join(base, 'bin');
    mkdirSync(shims);
    writeFileSync(join(shims, 'node'), '#!/bin/sh\ncase "$*" in *--version*) echo v18.20.0 ;; *) echo 18 ;; esac\n', { mode: 0o755 });
    const dest = join(base, 'agents-skills');
    const claude = join(base, 'claude-skills');
    const result = spawnSync('sh', [installer], {
      env: { PATH: `${shims}:${process.env.PATH}`, HOME: isolatedHome(base), PRAX_SKILLS_REPO: repo, PRAX_SKILLS_DIR: dest, PRAX_CLAUDE_SKILLS_DIR: claude },
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Node 20 or newer is required .*found v18\.20\.0/);
    assert.equal(existsSync(dest), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('install.sh explains a failed clone in terms of repository access', () => {
  const base = mkdtempSync(join(tmpdir(), 'prax-install-noclone-'));
  try {
    const result = run([], {
      HOME: isolatedHome(base),
      PRAX_SKILLS_REPO: join(base, 'does-not-exist'),
      PRAX_SKILLS_DIR: join(base, 'a'),
      PRAX_CLAUDE_SKILLS_DIR: join(base, 'c'),
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /could not clone .*does-not-exist@main over explicit/);
    assert.match(result.stderr, /the repository is private/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('with a glab login, both the clone and the sparse checkout carry the glab credential helper', () => {
  // A blobless clone defers the skills blobs to the sparse checkout, so the
  // credential helper has to apply to that second git command as well (F3).
  const base = mkdtempSync(join(tmpdir(), 'prax-install-gh-'));
  try {
    const repo = sourceRepo(base);
    const shims = join(base, 'bin');
    mkdirSync(shims);
    const log = join(base, 'git-args.log');
    const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    // `glab auth status` succeeds; `git` records its arguments, swaps the HTTPS
    // URL for the local fixture repository, and runs the real git.
    writeFileSync(join(shims, 'glab'), '#!/bin/sh\n[ "$1" = "auth" ] && [ "$2" = "status" ] && exit 0\nexit 1\n', { mode: 0o755 });
    writeFileSync(join(shims, 'git'), `#!/bin/sh
printf '%s\\n' "$*" >> "${log}"
args=""
for a in "$@"; do
  if [ "$a" = "https://gitlab.com/markjoyeuxcom/apps/prax.git" ]; then a="${repo}"; fi
  args="$args \\"$(printf '%s' "$a" | sed 's/"/\\\\"/g')\\""
done
eval set -- $args
exec "${realGit}" "$@"
`, { mode: 0o755 });
    const dest = join(base, 'agents-skills');
    const claude = join(base, 'claude-skills');
    const result = spawnSync('sh', [installer], {
      env: {
        PATH: `${shims}:${dirname(process.execPath)}:${process.env.PATH}`,
        HOME: isolatedHome(base),
        PRAX_SKILLS_DIR: dest,
        PRAX_CLAUDE_SKILLS_DIR: claude,
        // The installer under test sits next to a real pack (this checkout), so
        // force the clone path: this test is about the transport.
        PRAX_SKILLS_SOURCE: 'clone',
        // No PRAX_GEMINI_SKILLS_DIR on purpose: the throwaway HOME must catch the
        // default. No PRAX_SKILLS_REPO: the installer must choose the gh HTTPS
        // transport itself.
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /over https \(glab credentials\)\./);
    // The destination this test did not override landed in the throwaway HOME,
    // not in the real one.
    assert.ok(lstatSync(join(base, 'home', '.gemini', 'config', 'skills', 'prax-recall')).isSymbolicLink());
    const invocations = readFileSync(log, 'utf8').trim().split('\n');
    const helper = "-c credential.helper= -c credential.helper=!glab auth git-credential";
    const clone = invocations.find((line) => line.includes(' clone '));
    const sparse = invocations.find((line) => line.includes('sparse-checkout set'));
    assert.ok(clone && clone.startsWith(helper), `clone carries the helper: ${clone}`);
    assert.ok(sparse && sparse.startsWith(helper), `sparse checkout carries the helper: ${sparse}`);
    assert.ok(existsSync(join(dest, 'prax-recall', 'SKILL.md')));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// --- dmg-only machines: install from the app bundle, no repository, no git ----
//
// The desktop bundle stages skills/ next to cli/ and mcp/ (prepare-sidecar) and
// ships its own Node runtime. Run from there, the installer copies the pack
// without cloning anything, --cli writes a shim onto that runtime, and --mcp
// prints the registrations against the bundle's server.

function fakeAppBundle(base) {
  const app = join(base, 'Prax.app', 'Contents', 'Resources', 'resources', 'app');
  for (const dir of ['skills', 'cli', 'mcp']) cpSync(join(root, dir), join(app, dir), { recursive: true });
  // What cli/prax.js imports from outside cli/.
  mkdirSync(join(app, 'public', 'js'), { recursive: true });
  cpSync(join(root, 'public', 'js', 'documentTypes.js'), join(app, 'public', 'js', 'documentTypes.js'));
  mkdirSync(join(app, 'server'), { recursive: true });
  cpSync(join(root, 'server', 'repoUrl.js'), join(app, 'server', 'repoUrl.js'));
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'prax', version: '9.9.9', type: 'module' }));
  // The bundled runtime: the sidecar convention is a renamed Node binary.
  const macos = join(base, 'Prax.app', 'Contents', 'MacOS');
  mkdirSync(macos, { recursive: true });
  writeFileSync(join(macos, 'prax-server'), `#!/bin/sh\nexec "${process.execPath}" "$@"\n`, { mode: 0o755 });
  return { app, runtime: join(macos, 'prax-server') };
}

test('install.sh run from the app bundle installs the local pack without git, and --cli/--mcp target the bundle', () => {
  const base = mkdtempSync(join(tmpdir(), 'prax-install-bundle-'));
  try {
    const { app, runtime } = fakeAppBundle(base);
    // Any git use is a failure: a dmg-only machine has no repository access.
    const shims = join(base, 'bin');
    mkdirSync(shims);
    writeFileSync(join(shims, 'git'), '#!/bin/sh\necho "git must not be used" >&2\nexit 99\n', { mode: 0o755 });
    const dest = join(base, 'agents-skills');
    const bin = join(base, 'local-bin');
    const env = {
      HOME: isolatedHome(base),
      PATH: `${shims}:${dirname(process.execPath)}:${process.env.PATH}`,
      PRAX_SKILLS_DIR: dest, PRAX_CLAUDE_SKILLS_DIR: join(base, 'claude-skills'), PRAX_GEMINI_SKILLS_DIR: join(base, 'gemini-skills'),
      PRAX_BIN_DIR: bin,
    };
    const result = spawnSync('sh', [join(app, 'skills', 'install.sh'), '--cli', '--mcp'], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /git must not be used/);
    assert.match(result.stdout, /Prax skills installed from the local pack at .*\/resources\/app\/skills \(Prax v9\.9\.9\)\./, 'the origin names the bundle and its version');
    for (const skill of SKILLS) {
      assert.ok(existsSync(join(dest, skill, 'SKILL.md')), `${skill} copied from the bundle`);
      assert.ok(lstatSync(join(base, 'claude-skills', skill)).isSymbolicLink());
    }

    // --cli: a shim onto the bundle's own runtime and CLI, and it actually runs.
    const shim = readFileSync(join(bin, 'prax'), 'utf8');
    assert.match(shim, /prax-shim: written by the Prax skills installer/);
    assert.ok(shim.includes(`exec "${runtime}" "${app}/cli/prax.js" "$@"`), shim);
    const help = spawnSync(join(bin, 'prax'), ['help'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: env.HOME } });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /prax — shared project memory CLI/);
    assert.ok(result.stdout.includes(`installed ${bin}/prax -> ${runtime} ${app}/cli/prax.js`), 'the installer says what the shim runs');

    // --mcp: the registrations name the bundle runtime and server, one per tool.
    for (const tool of ['claude mcp add prax --', 'codex mcp add prax --', 'copilot mcp add prax --', 'agy mcp add prax']) {
      assert.ok(result.stdout.includes(`${tool} "${runtime}" "${app}/mcp/server.js"`), `${tool} line is printed`);
    }

    // A foreign `prax` in the bin dir is never overwritten; the installer's own shim is removed on uninstall.
    const uninstall = spawnSync('sh', [join(app, 'skills', 'install.sh'), '--uninstall'], { env, encoding: 'utf8' });
    assert.equal(uninstall.status, 0, uninstall.stderr);
    assert.equal(existsSync(join(bin, 'prax')), false, 'uninstall removes the shim');
    assert.equal(existsSync(join(dest, 'prax-recall')), false);
    writeFileSync(join(bin, 'prax'), '#!/bin/sh\necho someone else\n', { mode: 0o755 });
    const again = spawnSync('sh', [join(app, 'skills', 'install.sh'), '--cli'], { env, encoding: 'utf8' });
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stderr, /is not the installer's shim — left unchanged/);
    assert.equal(readFileSync(join(bin, 'prax'), 'utf8'), '#!/bin/sh\necho someone else\n');
    const stillThere = spawnSync('sh', [join(app, 'skills', 'install.sh'), '--uninstall'], { env, encoding: 'utf8' });
    assert.equal(stillThere.status, 0);
    assert.ok(existsSync(join(bin, 'prax')), 'uninstall never deletes a prax that is not the shim');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('install.sh piped through sh (no pack next to it) still clones, and --cli then explains what it needs', () => {
  const base = mkdtempSync(join(tmpdir(), 'prax-install-piped-'));
  try {
    const repo = sourceRepo(base);
    const env = {
      HOME: isolatedHome(base), PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
      PRAX_SKILLS_REPO: repo, PRAX_SKILLS_DIR: join(base, 'agents-skills'),
      PRAX_CLAUDE_SKILLS_DIR: join(base, 'claude-skills'), PRAX_GEMINI_SKILLS_DIR: join(base, 'gemini-skills'), PRAX_BIN_DIR: join(base, 'bin'),
    };
    const piped = spawnSync('sh', ['-s', '--', '--cli'], { input: readFileSync(installer, 'utf8'), env, encoding: 'utf8' });
    assert.equal(piped.status, 1);
    assert.match(piped.stdout, /Prax skills installed from .* over explicit\./, 'the skills still install from the clone');
    assert.match(piped.stderr, /--cli and --mcp need the app payload .* run this installer from the Prax app bundle or a checkout/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
