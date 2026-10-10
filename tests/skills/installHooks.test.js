// skills/install.sh --hooks: the session-harvesting hook in each agent CLI's
// own settings (docs/superpowers/specs/2026-09-23-session-harvesting-design.md).
// Every run gets a throwaway HOME, so the real ~/.claude, ~/.codex and
// ~/.copilot are never touched. The installer runs from this checkout, which
// is an app payload (cli/ next to skills/), as --hooks requires.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const installer = join(root, 'skills', 'install.sh');

function setup(t) {
  const base = mkdtempSync(join(tmpdir(), 'prax-install-hooks-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, 'home');
  mkdirSync(home, { recursive: true });
  const env = {
    HOME: home,
    PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
    PRAX_SKILLS_DIR: join(base, 'agents-skills'),
    PRAX_CLAUDE_SKILLS_DIR: join(base, 'claude-skills'),
    PRAX_GEMINI_SKILLS_DIR: join(base, 'gemini-skills'),
    PRAX_BIN_DIR: join(base, 'bin'),
  };
  const run = (...args) => spawnSync('sh', [installer, ...args], { env, encoding: 'utf8' });
  return { base, home, env, run };
}

const USER_CLAUDE_SETTINGS = {
  model: 'opus',
  permissions: { allow: ['Bash(npm test)'] },
  hooks: {
    Stop: [{ hooks: [{ type: 'command', command: 'afplay /System/Library/Sounds/Glass.aiff' }] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '~/bin/guard.sh' }] }],
  },
};

test('--hooks adds one Prax handler per agent CLI, keeps every other setting, is idempotent, and --uninstall reverses it', (t) => {
  const { base, home, run } = setup(t);
  // Claude Code settings live behind a symlink (a dotfiles checkout) with a private mode.
  const dotfiles = join(base, 'dotfiles');
  mkdirSync(dotfiles);
  const target = join(dotfiles, 'claude-settings.json');
  writeFileSync(target, `${JSON.stringify(USER_CLAUDE_SETTINGS, null, 2)}\n`);
  chmodSync(target, 0o640);
  mkdirSync(join(home, '.claude'));
  symlinkSync(target, join(home, '.claude', 'settings.json'));
  // Codex already has a hook of its own.
  mkdirSync(join(home, '.codex'));
  const codexOwn = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo hello' }] }] } };
  writeFileSync(join(home, '.codex', 'hooks.json'), JSON.stringify(codexOwn));

  const install = run('--hooks', '--instructions');
  assert.equal(install.status, 0, install.stderr);
  assert.match(install.stdout, /harvest hook updated in .*settings\.json \(Claude Code Stop\)/);
  assert.match(install.stdout, /run \/hooks and trust the Prax harvest hook/);

  const claude = JSON.parse(readFileSync(target, 'utf8'));
  assert.ok(lstatSync(join(home, '.claude', 'settings.json')).isSymbolicLink(), 'the link stays a link');
  assert.equal(statSync(target).mode & 0o777, 0o640, 'the mode is kept');
  assert.equal(claude.model, 'opus');
  assert.deepEqual(claude.permissions, USER_CLAUDE_SETTINGS.permissions);
  assert.deepEqual(claude.hooks.PreToolUse, USER_CLAUDE_SETTINGS.hooks.PreToolUse);
  assert.equal(claude.hooks.Stop.length, 2, 'the person\'s own Stop hook stays, Prax\'s is added after it');
  assert.deepEqual(claude.hooks.Stop[0], USER_CLAUDE_SETTINGS.hooks.Stop[0]);
  const handler = claude.hooks.Stop[1].hooks[0];
  assert.equal(handler.type, 'command');
  assert.equal(handler.async, undefined, 'synchronous: it hands off to a detached worker and returns at once');
  assert.equal(handler.timeout, 30);
  assert.equal(handler.command, `'${process.execPath}' '${join(root, 'cli', 'prax.js')}' harvest --hook claude`);

  const codex = JSON.parse(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8'));
  assert.deepEqual(codex.hooks.SessionStart, codexOwn.hooks.SessionStart);
  assert.match(codex.hooks.Stop[0].hooks[0].command, / harvest --hook codex$/);

  const copilotFile = join(home, '.copilot', 'hooks', 'prax-harvest.json');
  const copilot = JSON.parse(readFileSync(copilotFile, 'utf8'));
  assert.equal(copilot.version, 1);
  assert.match(copilot.hooks.agentStop[0].bash, / harvest --hook copilot$/);
  assert.equal(statSync(copilotFile).mode & 0o777, 0o600, 'a new hook file is private');

  // The standing block teaches the markers, because a hook now reads them.
  const block = readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8');
  assert.match(block, /\*\*Propose what you are unsure of\.\*\*/);
  assert.match(block, /start\na line of your reply with `Remember:`/);

  // The installed command runs and fails open: nothing listens, it still exits 0 silently.
  const hook = spawnSync('sh', ['-c', handler.command], {
    input: JSON.stringify({ session_id: 's', hook_event_name: 'Stop', last_assistant_message: 'Remember: nothing is listening on this port.' }),
    env: { PATH: process.env.PATH, HOME: home, PRAX_API_URL: 'http://127.0.0.1:9' },
    encoding: 'utf8',
  });
  assert.equal(hook.status, 0, hook.stderr);
  assert.equal(hook.stdout, '');

  // Re-running changes nothing.
  const snapshot = [target, join(home, '.codex', 'hooks.json'), copilotFile].map((f) => readFileSync(f, 'utf8'));
  const again = run('--hooks');
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /harvest hook already current in .*settings\.json/);
  assert.deepEqual([target, join(home, '.codex', 'hooks.json'), copilotFile].map((f) => readFileSync(f, 'utf8')), snapshot);

  // --uninstall removes only Prax's handlers and file.
  const uninstall = run('--uninstall');
  assert.equal(uninstall.status, 0, uninstall.stderr);
  assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), USER_CLAUDE_SETTINGS);
  assert.ok(lstatSync(join(home, '.claude', 'settings.json')).isSymbolicLink());
  assert.equal(statSync(target).mode & 0o777, 0o640);
  assert.deepEqual(JSON.parse(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8')), codexOwn);
  assert.equal(existsSync(copilotFile), false);
  assert.doesNotMatch(readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8'), /Propose what you are unsure of/);
});

test('without --hooks the standing block does not teach the markers', (t) => {
  const { home, run } = setup(t);
  const install = run('--instructions');
  assert.equal(install.status, 0, install.stderr);
  assert.doesNotMatch(readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8'), /Propose what you are unsure of/);
  assert.equal(existsSync(join(home, '.claude', 'settings.json')), false, 'no settings file appears without --hooks');
});

test('--hooks refuses malformed settings and a foreign Copilot file, leaving them byte-identical', (t) => {
  const { home, run } = setup(t);
  mkdirSync(join(home, '.claude'));
  const broken = '{ "model": "opus", // a comment is not JSON\n}\n';
  writeFileSync(join(home, '.claude', 'settings.json'), broken);
  mkdirSync(join(home, '.codex'));
  writeFileSync(join(home, '.codex', 'hooks.json'), JSON.stringify({ hooks: { Stop: { not: 'an array' } } }));
  mkdirSync(join(home, '.copilot', 'hooks'), { recursive: true });
  const foreign = JSON.stringify({ version: 1, hooks: { agentStop: [{ type: 'command', bash: 'say done' }] } });
  writeFileSync(join(home, '.copilot', 'hooks', 'prax-harvest.json'), foreign);

  const install = run('--hooks');
  assert.equal(install.status, 1, 'a refused edit fails the run');
  assert.match(install.stderr, /invalid JSON in .*settings\.json; file left unchanged/);
  assert.match(install.stderr, /hooks\.Stop value that is not an array/);
  assert.match(install.stderr, /not the installer's own/);
  assert.equal(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'), broken);
  assert.equal(readFileSync(join(home, '.copilot', 'hooks', 'prax-harvest.json'), 'utf8'), foreign);

  // Uninstall leaves files that hold no Prax handler exactly as they were.
  const uninstall = run('--uninstall');
  assert.equal(uninstall.status, 0, uninstall.stderr);
  assert.equal(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'), broken);
  assert.equal(readFileSync(join(home, '.copilot', 'hooks', 'prax-harvest.json'), 'utf8'), foreign);
});

test('--hooks honours the settings path overrides', (t) => {
  const { base, env } = setup(t);
  const claude = join(base, 'custom', 'claude.json');
  const codex = join(base, 'custom', 'codex-hooks.json');
  const copilotDir = join(base, 'custom', 'copilot-hooks');
  const withOverrides = { ...env, PRAX_CLAUDE_SETTINGS: claude, PRAX_CODEX_HOOKS: codex, PRAX_COPILOT_HOOKS_DIR: copilotDir };
  const install = spawnSync('sh', [installer, '--hooks'], { env: withOverrides, encoding: 'utf8' });
  assert.equal(install.status, 0, install.stderr);
  assert.ok(existsSync(claude) && existsSync(codex) && existsSync(join(copilotDir, 'prax-harvest.json')));
  assert.equal(existsSync(join(env.HOME, '.claude', 'settings.json')), false);
  const uninstall = spawnSync('sh', [installer, '--uninstall'], { env: withOverrides, encoding: 'utf8' });
  assert.equal(uninstall.status, 0, uninstall.stderr);
  assert.deepEqual(JSON.parse(readFileSync(claude, 'utf8')), {}, 'a settings file is never deleted, only emptied of Prax');

});
