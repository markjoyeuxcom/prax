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
