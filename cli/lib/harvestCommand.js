// cli/lib/harvestCommand.js — `prax harvest`: the I/O around cli/lib/harvest.js.
//
//   prax harvest --transcript <file>      a manual run on a saved transcript
//   prax harvest < hook.json|transcript   hook JSON or a transcript on stdin
//   prax harvest --hook <vendor>          the agent-CLI hook entry point
//
// Hook mode never blocks or fails the agent: it reads stdin (bounded), hands
// it to a DETACHED worker through a private temporary file, and exits 0 with
// nothing on stdout (a Stop hook's stdout can reach the model, and exit 2
// would keep the agent running). The worker runs under a hard time budget and
// swallows every failure, logging one line to PRAX_HARVEST_LOG when it is set.
import { spawn } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectProject } from './detectProject.js';
import {
  extractCandidates, formatHarvest, harvest, isHookVendor, NO_MARKERS, parseHookInput, readTranscript,
  sessionKey, candidateIds,
} from './harvest.js';

export const DEFAULT_BUDGET_MS = 20000;
const STDIN_MAX_BYTES = 8 * 1024 * 1024;
const STDIN_TIMEOUT_MS = 2000;
const TRANSCRIPT_MAX_BYTES = 256 * 1024 * 1024;
const TEMP_PREFIX = 'prax-harvest-';
const CLI_PATH = fileURLToPath(new URL('../prax.js', import.meta.url));

export class HarvestBudgetError extends Error {
  constructor(budgetMs) {
    super(`time budget of ${budgetMs} ms spent`);
    this.name = 'HarvestBudgetError';
  }
}

// stdin, bounded in size and time: a hook whose agent never closes the pipe
// must not hang the hook. A terminal is not input.
export function readStdin({ stdin = process.stdin, maxBytes = STDIN_MAX_BYTES, timeoutMs = STDIN_TIMEOUT_MS } = {}) {
  if (stdin.isTTY) return Promise.resolve('');
  return new Promise((resolveText) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stdin.pause();
      resolveText(Buffer.concat(chunks).toString('utf8'));
    };
    const timer = setTimeout(finish, timeoutMs);
    stdin.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { chunks.length = 0; finish(); return; }
      chunks.push(chunk);
    });
    stdin.on('end', finish);
    stdin.on('error', finish);
  });
}

function readTranscriptFile(path) {
  const size = statSync(path).size;
  if (size > TRANSCRIPT_MAX_BYTES) throw new Error(`transcript ${path} is larger than ${TRANSCRIPT_MAX_BYTES} bytes`);
  return readFileSync(path, 'utf8');
}

// A hook-handoff file is removed by the worker only when it is exactly what
// hook mode writes: <tmpdir>/prax-harvest-XXXXXX/hook.json.
function removeHandoff(file) {
  try {
    const dir = dirname(realpathSync(file));
    if (basename(file) === 'hook.json' && basename(dir).startsWith(TEMP_PREFIX)
      && dirname(dir) === realpathSync(tmpdir())) {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch { /* already gone */ }
}

function log(env, line) {
  if (!env.PRAX_HARVEST_LOG) return;
  try { appendFileSync(env.PRAX_HARVEST_LOG, `${new Date().toISOString()} ${line}\n`); } catch { /* never fail on the log */ }
}

// Hook mode, parent half: hand stdin to a detached worker and return at once.
function detachWorker({ text, vendor, flags, env }) {
  const dir = mkdtempSync(join(tmpdir(), TEMP_PREFIX));
  const file = join(dir, 'hook.json');
  writeFileSync(file, text, { mode: 0o600 });
  const args = [CLI_PATH, 'harvest', '--hook', vendor, '--foreground', '--input', file, '--handoff'];
  for (const key of ['budget-ms', 'url', 'agent']) {
    if (typeof flags[key] === 'string') args.push(`--${key}`, flags[key]);
  }
  const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore', env });
  child.on('error', () => removeHandoff(file));
  child.unref();
}

function insideRepository(dir) {
  for (let current = resolve(dir); ; current = dirname(current)) {
    if (existsSync(join(current, '.git'))) return true;
    if (dirname(current) === current) return false;
  }
}

// Where the candidate probably belongs, from the session's working directory:
// its .prax/project.json, else the repository's name. A plain folder's name
// outside any repository is too weak a guess to show a reviewer. Local only.
function suggestedProjectFor(cwd) {
  if (!cwd) return null;
  try {
    const found = detectProject({ cwd });
    if (!found?.project) return null;
    if (found.source === 'folder') {
      return insideRepository(cwd) ? { slug: found.project, from: 'the session repository\'s name' } : null;
    }
    return { slug: found.project, from: 'the session directory\'s .prax/project.json' };
  } catch { return null; }
}

// Everything a run needs from its input: the agent's messages and the session.
function gatherInput({ flags, stdinText, env }) {
  const input = typeof flags.input === 'string' ? readFileSync(flags.input, 'utf8') : null;
  if (input !== null && flags.handoff === true) removeHandoff(flags.input);
  const hookText = input ?? (typeof flags.transcript === 'string' ? null : stdinText);
  const hook = hookText ? parseHookInput(hookText) : null;
  let transcriptPath = typeof flags.transcript === 'string' ? resolve(flags.transcript) : (hook?.transcriptPath || null);
  let transcript = { format: null, sessionId: null, cwd: null, messages: [] };
  let transcriptError = null;
  if (transcriptPath) {
    try { transcript = readTranscript(readTranscriptFile(transcriptPath)); }
    catch (error) {
      // A hook whose transcript is not there yet still has its last message.
      if (!hook?.lastAssistantMessage) throw error;
      transcriptError = error.message;
    }
  } else if (!hook && hookText) {
    transcript = readTranscript(hookText); // a transcript piped on stdin
    transcriptPath = null;
  }
  const messages = [...transcript.messages];
  if (hook?.lastAssistantMessage) messages.push(hook.lastAssistantMessage);
  const sessionId = sessionKey({
    hookSessionId: hook?.sessionId,
    transcriptSessionId: transcript.sessionId,
    flagSession: typeof flags.session === 'string' ? flags.session : null,
    transcriptPath: transcriptPath && existsSync(transcriptPath) ? realpathSync(transcriptPath) : transcriptPath,
  });
  return {
    messages,
    transcriptError,
    source: {
      vendor: typeof flags.hook === 'string' ? flags.hook : (transcript.format && !['text', 'jsonl'].includes(transcript.format) ? transcript.format : null),
      sessionId,
      event: hook?.event || null,
      transcriptPath,
      cwd: hook?.cwd || transcript.cwd || null,
    },
    env,
  };
}

function withBudget(work, budgetMs) {
  let timer;
  const expired = new Promise((_, reject) => { timer = setTimeout(() => reject(new HarvestBudgetError(budgetMs)), budgetMs); });
  return Promise.race([work(), expired]).finally(() => clearTimeout(timer));
}

export function budgetFrom(flags) {
  if (flags['budget-ms'] === undefined) return DEFAULT_BUDGET_MS;
  const value = Number(flags['budget-ms']);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`--budget-ms must be a positive whole number of milliseconds (got "${flags['budget-ms']}").`);
  return value;
}

// Returns the process exit code. `createClient` is injected so the budget can
// bound every request; `out` writes one block to stdout.
export async function runHarvest({
  flags, agent, createClient, out, env = process.env, stdin = process.stdin,
}) {
  const vendor = flags.hook;
  const hookMode = vendor !== undefined;
  if (hookMode && !isHookVendor(vendor)) {
    // A wrong vendor is an installer bug; the agent must still not notice.
    log(env, `harvest: unknown --hook "${vendor}"`);
    return 0;
  }

  // Hook mode, parent half: never wait on Prax. The worker does the rest.
  if (hookMode && !flags.foreground) {
    try {
      const text = await readStdin({ stdin });
      if (text.trim()) detachWorker({ text, vendor, flags, env });
    } catch (error) {
      log(env, `harvest: could not start the worker: ${error.message}`);
    }
    return 0;
  }

  let budgetMs;
  try { budgetMs = budgetFrom(flags); } catch (error) {
    if (hookMode) { log(env, `harvest: ${error.message}`); return 0; }
    throw error;
  }
  const results = [];
  let gathered = null;
  let extracted = null;
  let client = null;
  try {
    await withBudget(async () => {
      const needsStdin = typeof flags.input !== 'string' && typeof flags.transcript !== 'string';
      const stdinText = needsStdin ? await readStdin({ stdin }) : '';
      if (needsStdin && !stdinText.trim() && !hookMode) {
        throw new Error('harvest needs --transcript <file>, or hook JSON or a transcript on stdin.');
      }
      gathered = gatherInput({ flags, stdinText, env });
      extracted = extractCandidates(gathered.messages);
      if (!gathered.source.sessionId && extracted.candidates.length) {
        throw new Error('cannot tell which session this is; pass --session <id>.');
      }
      if (flags['dry-run'] || !extracted.candidates.length) return;
      client = createClient({ baseUrl: flags.url, agent: agent ?? (hookMode ? vendor : undefined), timeoutMs: budgetMs });
      gathered.source.agent = client.agent || agent || vendor || null;
      await harvest(client, {
        candidates: extracted.candidates,
        source: gathered.source,
        suggestedProject: suggestedProjectFor(gathered.source.cwd),
        results,
      });
    }, budgetMs);
  } catch (error) {
    const incomplete = error instanceof HarvestBudgetError ? error.message : null;
    log(env, `harvest ${vendor || 'manual'} ${gathered?.source?.sessionId || '?'}: ${error.message} (${results.length} done)`);
    if (hookMode) return 0;
    if (incomplete && extracted) {
      out(flags.json
        ? { results, skipped: extracted.skipped, incomplete }
        : formatHarvest({ results, skipped: extracted.skipped, source: gathered.source, base: client?.base, incomplete }));
    }
    throw error;
  }
  if (hookMode) {
    const note = gathered.transcriptError ? ` (transcript not read: ${gathered.transcriptError})` : '';
    log(env, `harvest ${vendor} ${gathered.source.sessionId}: ${results.map((r) => r.status).join(', ') || 'no candidates'}${note}`);
    return 0;
  }
  if (flags['dry-run']) {
    const preview = extracted.candidates.map((c) => ({
      title: c.title, type: c.type || 'note', tags: c.tags, marker: c.marker,
      ...(gathered.source.sessionId ? candidateIds(gathered.source.sessionId, c) : {}),
    }));
    out(flags.json
      ? { session: gathered.source.sessionId, candidates: preview, skipped: extracted.skipped }
      : [
        `Dry run: ${preview.length} candidate${preview.length === 1 ? '' : 's'} in ${gathered.source.sessionId || 'this input'}; nothing sent.`,
        ...preview.map((c) => `  "${c.title}" (${c.type}, ${c.marker})${c.id ? ` → ${c.id}` : ''}`),
        ...extracted.skipped.map((s) => `  skipped "${s.title}": ${s.reason}`),
      ].join('\n'));
    return 0;
  }
  if (!extracted.candidates.length) {
    out(flags.json ? { results: [], skipped: extracted.skipped } : [NO_MARKERS, ...extracted.skipped.map((s) => `  skipped "${s.title}": ${s.reason}`)].join('\n'));
    return 0;
  }
  out(flags.json
    ? { results, skipped: extracted.skipped }
    : formatHarvest({ results, skipped: extracted.skipped, source: gathered.source, base: client.base }));
  return 0;
}
