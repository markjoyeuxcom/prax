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
// touches the real ~/.agents or ~/.claude (both destinations are overridden).

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

function run(args, env) {
  return spawnSync('sh', [installer, ...args], {
    env: {
      // The running Node first, so the installer's version check sees a real
      // binary rather than a version-manager shim that needs $HOME state.
      PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
      HOME: process.env.HOME,
      ...env,
    },
    encoding: 'utf8',
  });
}

test('install.sh installs both skills from a repository, links them for Claude Code, runs, updates and uninstalls', () => {
  const base = mkdtempSync(join(tmpdir(), 'prax-install-'));
  try {
    const repo = sourceRepo(base);
    const dest = join(base, 'agents-skills');
    const claude = join(base, 'claude-skills');
    const env = { PRAX_SKILLS_REPO: repo, PRAX_SKILLS_DIR: dest, PRAX_CLAUDE_SKILLS_DIR: claude };

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
    }

    // The installed script runs from outside any checkout: no args is a usage error, not a crash.
    const usage = spawnSync(process.execPath, [join(claude, 'prax-recall', 'scripts', 'recall.mjs')], { encoding: 'utf8' });
    assert.equal(usage.status, 2);
    assert.match(usage.stderr, /Usage: recall/);

    // Re-running updates in place without duplicating or breaking the links.
    const again = run([], env);
    assert.equal(again.status, 0, again.stderr);
    assert.ok(lstatSync(join(claude, 'prax-recall')).isSymbolicLink());

    const uninstall = run(['--uninstall'], env);
    assert.equal(uninstall.status, 0, uninstall.stderr);
    for (const skill of SKILLS) {
      assert.equal(existsSync(join(dest, skill)), false);
      assert.equal(existsSync(join(claude, skill)), false);
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
      env: { PATH: `${shims}:${process.env.PATH}`, HOME: process.env.HOME, PRAX_SKILLS_REPO: repo, PRAX_SKILLS_DIR: dest, PRAX_CLAUDE_SKILLS_DIR: claude },
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
