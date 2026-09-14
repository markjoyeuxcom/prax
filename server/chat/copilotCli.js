import { spawn as nodeSpawn } from 'node:child_process';
import { accessSync, constants, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { splitSystem } from './messages.js';

// GitHub Copilot CLI as a keyless chat backend. Prax uses the user's existing
// `copilot` login and runs one non-interactive completion at a time.
//
// The CLI is an agent by default, so the answer path needs an explicit fence.
// An empty --available-tools value means "no restriction" in current releases.
// Instead, the allowlist contains one inert documentation tool and the same
// tool is denied. Deny rules take precedence, leaving no callable tools. The
// process also runs in an empty directory with custom instructions, remote
// control, auto-update, and MCP servers disabled.

const NO_TOOLS_PROMPT = 'Answer directly as plain text. Do not use any tools.';
const FENCE_TOOL = 'fetch_copilot_cli_documentation';

function defaultCandidates(env = process.env) {
  const home = env.HOME || homedir();
  return [
    '/opt/homebrew/bin/copilot',
    '/usr/local/bin/copilot',
    join(home, '.local', 'bin', 'copilot'),
    join(home, '.npm-global', 'bin', 'copilot'),
  ];
}

function executable(path, exists) {
  try {
    return exists ? exists(path) : (accessSync(path, constants.X_OK), true);
  } catch {
    return false;
  }
}

export function resolveCopilotBinary({ binaryPath = '', env = process.env, exists = null } = {}) {
  const explicit = String(binaryPath || '').trim();
  if (explicit) return executable(explicit, exists) ? explicit : null;
  for (const dir of String(env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'copilot');
    if (executable(candidate, exists)) return candidate;
  }
  for (const candidate of defaultCandidates(env)) {
    if (executable(candidate, exists)) return candidate;
  }
  return null;
}

export function serializeCopilotPrompt(messages) {
  const { system, turns } = splitSystem(messages);
  const transcript = turns
    .map((turn) => `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${turn.content}`)
    .join('\n\n');
  const parts = [];
  if (system) parts.push(`System instructions:\n${system}`);
  if (transcript) parts.push(`Conversation:\n${transcript}`);
  parts.push(NO_TOOLS_PROMPT);
  return parts.join('\n\n');
}

export function buildCopilotArgs({ model, prompt }) {
  return [
    '--prompt', prompt,
    '--silent',
    '--output-format', 'text',
    '--stream', 'off',
    '--model', model,
    `--available-tools=${FENCE_TOOL}`,
    `--deny-tool=${FENCE_TOOL}`,
    '--disable-builtin-mcps',
    '--no-custom-instructions',
    '--no-remote',
    '--no-remote-export',
    '--no-auto-update',
    '--no-ask-user',
    '--disallow-temp-dir',
    '--log-level', 'none',
  ];
}

export function parseCopilotResult(stdout, stderr = '', exitCode = 0) {
  const output = String(stdout || '').trim();
  if (exitCode !== 0) {
    const detail = String(stderr || output || '').trim().split('\n').slice(-3).join(' ').slice(0, 500);
    throw new Error(detail || `copilot CLI exited with code ${exitCode}`);
  }
  if (!output) throw new Error('copilot CLI returned no text');
  return { text: output };
}

export function createCopilotCliChat({
  binaryPath = '',
  model = 'auto',
  spawn = nodeSpawn,
  env = process.env,
  exists = null,
  scratchDir = null,
  timeoutMs = 120_000,
} = {}) {
  const chatModel = model || 'auto';
  // A fresh private directory per chat instance (mkdtemp: unpredictable name,
  // mode 0700), never a fixed name under the shared temp dir — see claudeCli.js
  // for why a predictable cwd is a hook-injection path on a multi-user host.
  let scratch = null;

  function ensureScratch() {
    if (scratch) return scratch;
    try {
      scratch = scratchDir || mkdtempSync(join(tmpdir(), 'prax-copilot-cli-'));
    } catch (err) {
      throw new Error(`copilot CLI needs a private scratch directory and could not create one: ${err.message}`);
    }
    return scratch;
  }

  function run(args, timeout) {
    const binary = resolveCopilotBinary({ binaryPath, env, exists });
    if (!binary) {
      const tried = String(binaryPath || '').trim() || 'PATH and the usual install locations';
      return Promise.reject(new Error(`copilot CLI not found (looked at ${tried}) — set the binary path in Settings ▸ Intelligence`));
    }
    return new Promise((resolve, reject) => {
      const child = spawn(binary, args, { cwd: ensureScratch(), env });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(killer);
        fn(value);
      };
      const killer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
        finish(reject, new Error(`copilot CLI timed out after ${Math.round(timeout / 1000)}s`));
      }, timeout);
      if (typeof killer?.unref === 'function') killer.unref();
      child.stdout?.on('data', (chunk) => { stdout += chunk; });
      child.stderr?.on('data', (chunk) => { stderr += chunk; });
      child.on('error', (err) => finish(reject, new Error(`copilot CLI could not start: ${err.message}`)));
      child.on('close', (code) => finish(resolve, { stdout, stderr, code: code ?? -1 }));
      child.stdin?.end();
    });
  }

  let queue = Promise.resolve();
  function enqueue(work) {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  }

  return {
    backend: 'copilot-cli',
    model: chatModel,
    supportsTools: false,

    async complete(messages, opts = {}) {
      if (Array.isArray(opts.tools) && opts.tools.length) {
        throw new Error('the Copilot CLI backend does not support tool calling — the assistant needs an API backend');
      }
      const { turns } = splitSystem(messages);
      if (!turns.length) throw new Error('copilot CLI received an empty prompt');
      const prompt = serializeCopilotPrompt(messages);
      const { stdout, stderr, code } = await enqueue(() => run(buildCopilotArgs({ model: chatModel, prompt }), timeoutMs));
      const parsed = parseCopilotResult(stdout, stderr, code);
      return { text: parsed.text, model: chatModel };
    },

    async isAvailable() {
      try {
        const { stdout, code } = await enqueue(() => run(['--version'], 3_000));
        return code === 0 && Boolean(stdout.trim());
      } catch {
        return false;
      }
    },
  };
}
