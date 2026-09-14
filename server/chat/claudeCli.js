import { spawn as nodeSpawn } from 'node:child_process';
import { accessSync, constants, mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, delimiter } from 'node:path';
import { splitSystem } from './messages.js';

// Claude Code CLI as a chat backend: `claude -p` headless completions that
// authenticate through the user's existing `claude` login — the Pro/Max
// subscription powers Prax with NO API key stored anywhere.
//
// Safety fencing, non-negotiable: a summarization call must never become an
// agent run. Every spawn denies the CLI's built-in tools wholesale, appends a
// no-tools instruction, runs in an EMPTY scratch working directory (nothing
// sensitive to read), loads an explicitly empty MCP config (no servers), and
// caps --max-turns as a ceiling. supportsTools is false — the in-app
// assistant degrades honestly instead of pretending.
//
// Spawns are serialized through a single queue: CLI processes are heavy, and
// concurrent advisory calls (NL parse + narration) must not stampede.

// Where the CLI usually lives when a GUI-launched sidecar's minimal PATH
// (/usr/bin:/bin) can't see it. An explicit configured path always wins.
function defaultCandidates(env = process.env) {
  const home = env.HOME || homedir();
  return [
    join(home, '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    join(home, '.local', 'bin', 'claude'),
    join(home, '.npm-global', 'bin', 'claude'),
  ];
}

function executable(path, exists) {
  try {
    return exists ? exists(path) : (accessSync(path, constants.X_OK), true);
  } catch {
    return false;
  }
}

// Resolve the binary: explicit config path (must exist — a wrong explicit
// path is an error to surface, not silently replaced), else PATH, else the
// well-known homes. Returns the absolute/spawnable path or null.
export function resolveClaudeBinary({ binaryPath = '', env = process.env, exists = null } = {}) {
  const explicit = String(binaryPath || '').trim();
  if (explicit) return executable(explicit, exists) ? explicit : null;
  for (const dir of String(env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'claude');
    if (executable(candidate, exists)) return candidate;
  }
  for (const candidate of defaultCandidates(env)) {
    if (executable(candidate, exists)) return candidate;
  }
  return null;
}

// The prompt is the serialized conversation; multi-turn advisory calls are
// rare, so a labelled transcript keeps fidelity without session plumbing.
export function serializeTurns(turns) {
  if (turns.length === 1 && turns[0].role === 'user') return turns[0].content;
  return turns
    .map((turn) => `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${turn.content}`)
    .join('\n\n');
}

// The CLI's built-in tools, denied by NAME so a completion stays a
// completion. This is the primary fence: a "turn" is one assistant message,
// so with tools available the model's first message can be a tool call —
// which consumes the whole budget under a tight --max-turns and ends the run
// as error_max_turns with no text at all (field-observed). Names span CLI
// versions deliberately; unknown ones are harmless.
const DENIED_TOOLS = [
  'Task', 'Bash', 'BashOutput', 'KillBash', 'KillShell',
  'Read', 'Glob', 'Grep', 'LS',
  'Edit', 'MultiEdit', 'Write', 'NotebookRead', 'NotebookEdit',
  'WebFetch', 'WebSearch',
  'TodoRead', 'TodoWrite',
  'EnterPlanMode', 'ExitPlanMode', 'SlashCommand', 'Skill', 'AskUserQuestion',
  'ListMcpResources', 'ReadMcpResource',
].join(',');

// Belt to the deny-list's braces: the model is told not to attempt tools, so
// no turn is wasted on a call that would only come back denied.
const NO_TOOLS_PROMPT = 'Answer directly as plain text. Do not use any tools.';

export function buildCliArgs({ model, system }) {
  return [
    '-p',
    '--output-format', 'json',
    '--model', model,
    // A ceiling, not the fence: with every tool denied a text answer lands in
    // one turn, and the headroom absorbs a stray attempted-then-denied call
    // instead of dying text-less the way --max-turns 1 did.
    '--max-turns', '4',
    '--strict-mcp-config',
    '--mcp-config', '{"mcpServers":{}}',
    '--disallowedTools', DENIED_TOOLS,
    '--append-system-prompt', system ? `${system}\n\n${NO_TOOLS_PROMPT}` : NO_TOOLS_PROMPT,
  ];
}

// The -p --output-format json result envelope → completion text, or a THROWN
// error carrying the CLI's own words (login prompts, rate limits) verbatim.
// The CLI exits non-zero on failures while still writing the envelope to
// stdout — so the envelope is parsed regardless of exit code, and the exit
// code only matters when stdout isn't an envelope at all.
export function parseCliResult(stdout, stderr = '', exitCode = 0) {
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    const hint = (stderr || stdout || '').trim().split('\n').slice(-3).join(' ').slice(0, 300);
    if (exitCode !== 0) throw new Error(hint || `claude CLI exited with code ${exitCode}`);
    throw new Error(`claude CLI returned unparseable output${hint ? `: ${hint}` : ''}`);
  }
  if (data?.is_error || (typeof data?.subtype === 'string' && data.subtype !== 'success')) {
    const detail = typeof data.result === 'string' && data.result.trim()
      ? data.result.trim()
      : data.subtype === 'error_max_turns'
        ? 'claude CLI hit its turn limit before returning text — try again; if it persists the model kept attempting tool calls'
        : `claude CLI reported ${data.subtype || 'an error'}`;
    throw new Error(detail);
  }
  if (typeof data?.result !== 'string' || !data.result) {
    throw new Error('claude CLI returned no text');
  }
  return { text: data.result, model: data?.modelUsage ? Object.keys(data.modelUsage)[0] : null };
}

export function createClaudeCliChat({
  binaryPath = '',
  model = 'haiku',
  spawn = nodeSpawn,
  env = process.env,
  exists = null,
  scratchDir = null,
  timeoutMs = 120_000,
} = {}) {
  const chatModel = model || 'haiku';
  // A fresh private directory per chat instance (mkdtemp: unpredictable name,
  // mode 0700), never a fixed name under the shared temp dir. The CLI reads
  // project settings — including hooks that run shell commands — from its cwd,
  // so a predictable path on a multi-user host would let another local user
  // plant a `.claude/settings.json` that executes as the Prax user. One
  // directory per provider instance; the OS reaps the temp dir.
  let scratch = null;
  function ensureScratch() {
    if (scratch) return scratch;
    try {
      scratch = scratchDir || mkdtempSync(join(tmpdir(), 'prax-claude-cli-'));
    } catch (err) {
      throw new Error(`claude CLI needs a private scratch directory and could not create one: ${err.message}`);
    }
    return scratch;
  }

  function run(args, input, timeout) {
    const binary = resolveClaudeBinary({ binaryPath, env, exists });
    if (!binary) {
      const tried = String(binaryPath || '').trim() || 'PATH and the usual install locations';
      return Promise.reject(new Error(`claude CLI not found (looked at ${tried}) — set the binary path in Settings ▸ Intelligence`));
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
        finish(reject, new Error(`claude CLI timed out after ${Math.round(timeout / 1000)}s`));
      }, timeout);
      if (typeof killer?.unref === 'function') killer.unref();
      child.stdout?.on('data', (chunk) => { stdout += chunk; });
      child.stderr?.on('data', (chunk) => { stderr += chunk; });
      child.on('error', (err) => finish(reject, new Error(`claude CLI could not start: ${err.message}`)));
      // Resolve on ANY exit: failures (not logged in, rate limited) arrive
      // as a result envelope on stdout WITH a non-zero exit code, so the
      // caller must parse the envelope — rejecting here would leak raw JSON
      // as the error message instead of the CLI's own words.
      child.on('close', (code) => finish(resolve, { stdout, stderr, code: code ?? -1 }));
      if (input != null) {
        child.stdin?.write(input);
      }
      child.stdin?.end();
    });
  }

  // One CLI process at a time; later calls wait rather than stampede.
  let queue = Promise.resolve();
  function enqueue(work) {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  }

  return {
    backend: 'claude-cli',
    model: chatModel,
    supportsTools: false,

    async complete(messages, opts = {}) {
      if (Array.isArray(opts.tools) && opts.tools.length) {
        throw new Error('the Claude CLI backend does not support tool calling — the assistant needs an API backend');
      }
      const { system, turns } = splitSystem(messages);
      const prompt = serializeTurns(turns);
      if (!prompt) throw new Error('claude CLI received an empty prompt');
      const { stdout, stderr, code } = await enqueue(() => run(buildCliArgs({ model: chatModel, system }), prompt, timeoutMs));
      const parsed = parseCliResult(stdout, stderr, code);
      return { text: parsed.text, model: parsed.model || chatModel };
    },

    // Cheap, offline, quota-free: the binary resolves and answers --version.
    // Login state is discovered honestly at first use (the CLI's own message
    // travels through the degraded path verbatim).
    async isAvailable() {
      try {
        const { stdout, code } = await enqueue(() => run(['--version'], null, 3_000));
        return code === 0 && Boolean(stdout.trim());
      } catch {
        return false;
      }
    },
  };
}
