// cli/lib/sessionStart.js — `prax session-start --hook <vendor>`: the agent-CLI
// SessionStart hook (docs/design/session-start-recall.md).
//
// Reads the vendor's hook JSON on stdin (bounded), finds the project from the
// hook's cwd, and prints ONE block of additional context in the envelope the
// vendor consumes: a budgeted context pack for the project, the agent's
// since-last-session delta (its marker advances exactly as `prax recall
// --since-last-session` would), and the two commands that close the loop.
//
// It fails open, always: Prax down, no project, a slow request, anything at
// all — nothing on stdout, exit 0. A SessionStart hook delays the agent's
// first response, so the whole run sits under one deadline.
import { detectProject, detectRepoUrl } from './detectProject.js';
import { matchProjectByRepoUrl } from '../../server/repoUrl.js';
import { parseHookInput, isHookVendor } from './harvest.js';
import { readStdin } from './harvestCommand.js';
import { budgetedContext, formatBudgetedContext } from './context.js';
import { memoryDelta, planDelta, recordDelta } from './delta.js';
import { createCheckout, repoRoot } from './repoFiles.js';

export const DEFAULT_CONTEXT_BUDGET = 1200;
export const DEFAULT_DELTA_BUDGET = 400;
export const DEFAULT_DEADLINE_MS = 8000;
const REQUEST_TIMEOUT_MS = 5000;

// What the agent is told after the memory itself; the same two commands the
// standing instruction block teaches, so the briefing works without it.
export const CLOSING_LINES = Object.freeze([
  'When one of these informed your work, run `prax used <id>` so Prax learns which memory answers questions.',
  'Persist durable findings with `prax remember "<title>" --body "<body>" --project <slug>` (or `--memory` across projects).',
]);

// The envelope each vendor reads. Claude Code and Codex: hookSpecificOutput
// (plain stdout would also work, but the JSON names the event). Copilot CLI
// consumes only a top-level additionalContext.
export function envelope(vendor, text) {
  if (vendor === 'copilot') return { additionalContext: text };
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } };
}

// The project for the hook's cwd: a marker inside the repository or an explicit
// env/flag wins; a weaker signal (folder name, a marker above the repository)
// is upgraded by the registered repo URL, as resolveProjectName does.
export async function projectFor({ cwd, env, client, flag }) {
  const detected = detectProject({ flag, env: env.PRAX_PROJECT || env.MOOMORA_PROJECT, cwd });
  if (['folder', 'none', 'outer-file'].includes(detected.source)) {
    const repoUrl = detectRepoUrl({ cwd });
    if (repoUrl) {
      const match = matchProjectByRepoUrl(await client.listProjects(), repoUrl);
      if (match) return match.slug;
    }
  }
  return detected.project || null;
}

export function composeBriefing({ vendor, project, contextText, deltaText }) {
  const lines = [`# Prax memory at session start${project ? ` — project ${project}` : ''} (${vendor})`, ''];
  if (contextText) lines.push(contextText.trim(), '');
  if (deltaText) lines.push('## Since your last session', '', deltaText.trim(), '');
  lines.push(...CLOSING_LINES);
  return lines.join('\n');
}

// Returns the text to print (already an envelope, serialised) or null for
// "print nothing". Everything that can throw is caught by runSessionStart.
export async function sessionStart({
  vendor, hook, env, client, checkout, contextBudget = DEFAULT_CONTEXT_BUDGET, deltaBudget = DEFAULT_DELTA_BUDGET, flag,
}) {
  const cwd = hook?.cwd || process.cwd();
  const project = await projectFor({ cwd, env, client, flag });
  let contextText = null;
  if (project) {
    const result = await budgetedContext(client, { project, query: '', budget: contextBudget, checkout });
    contextText = formatBudgetedContext(result);
  }
  let deltaText = null;
  if (client.agent) {
    try {
      const delta = await memoryDelta(client, { sinceLastSession: true, project: project || undefined, checkout });
      const planned = planDelta(delta, deltaBudget);
      deltaText = planned.text;
      // The marker is the end of what the agent has actually been shown.
      if (planned.advance) await recordDelta(client, delta, { project: project || undefined });
    } catch {
      deltaText = null; // an older Prax, or a transient failure: the briefing still goes out
    }
  }
  if (!contextText && !deltaText) return null;
  return composeBriefing({ vendor, project, contextText, deltaText });
}

// The command: never throws, never prints on failure, always exit 0.
export async function runSessionStart({
  flags, out, createClient, env = process.env, stdin = process.stdin, agent,
}) {
  const vendor = flags.hook;
  if (!isHookVendor(vendor)) {
    process.stderr.write(`prax: session-start needs --hook claude|codex|copilot (got "${vendor}").\n`);
    return 2;
  }
  const deadlineMs = Number(env.PRAX_SESSION_START_MS) > 0 ? Number(env.PRAX_SESSION_START_MS) : DEFAULT_DEADLINE_MS;
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve(null), deadlineMs); });
  const work = (async () => {
    const hook = parseHookInput(await readStdin({ stdin }));
    // The vendor is the agent id unless --agent or PRAX_AGENT names one (an
    // empty PRAX_AGENT means "unset", as everywhere else).
    const client = createClient({ agent: agent || env.PRAX_AGENT || vendor, timeoutMs: REQUEST_TIMEOUT_MS });
    const root = repoRoot(hook?.cwd || process.cwd());
    const checkout = root ? createCheckout(root) : null;
    const budget = Number(flags.budget) > 0 ? Number(flags.budget) : DEFAULT_CONTEXT_BUDGET;
    const text = await sessionStart({ vendor, hook, env, client, checkout, contextBudget: budget, flag: flags.project });
    return text ? JSON.stringify(envelope(vendor, text)) : null;
  })().catch(() => null);
  const text = await Promise.race([work, deadline]);
  clearTimeout(timer);
  if (text) out(text);
  return 0;
}
