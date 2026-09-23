// Verification is the one trust-raising act in Prax, so it stays with a person
// at a terminal. Both entry points — `prax verify` and `prax triage` — run
// assertAttendedHuman before their first request. Not bundled into the skills
// (scripts/build-skills.mjs): agents have no verify path to learn.
import { createInterface } from 'node:readline/promises';
import { detectAgent } from '../../server/instanceDiscovery.js';

// The environment variables that identify an agent CLI's shell: PRAX_AGENT
// (any tool writing as an agent) and the vendor markers detectAgent knows.
// tests/cli/verify.test.js holds this list to detectAgent, so an agent added
// there cannot slip past the guard.
export const AGENT_ENV_MARKERS = [
  { variable: 'PRAX_AGENT', agent: null },
  { variable: 'CLAUDECODE', agent: 'claude' },
  { variable: 'CODEX_THREAD_ID', agent: 'codex' },
  { variable: 'CODEX_SESSION_ID', agent: 'codex' },
  { variable: 'COPILOT_CLI', agent: 'copilot' },
  { variable: 'COPILOT_AGENT_SESSION_ID', agent: 'copilot' },
  { variable: 'ANTIGRAVITY_AGENT', agent: 'antigravity' },
  { variable: 'ANTIGRAVITY_CONVERSATION_ID', agent: 'antigravity' },
];

// Which agent this environment belongs to, and the variables that say so, or
// null for a plain shell. An empty value counts as unset, as detectAgent reads it.
export function agentEnvironment(env = process.env) {
  const variables = AGENT_ENV_MARKERS.filter(({ variable }) => Boolean(env?.[variable])).map((m) => m.variable);
  if (!variables.length) return null;
  return { agent: detectAgent(env) || 'agent', variables };
}

export class AttendedHumanRequired extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'AttendedHumanRequired';
    this.reason = reason;
  }
}

// Refuse unless a person is plausibly at the keyboard: no agent CLI marker in
// the environment, and an interactive terminal on both ends. There is
// deliberately no override flag — an agent reads the remedy in an error and
// types it — so the message names only routes an agent cannot take.
export function assertAttendedHuman({ input, output, env = process.env, command = 'verify', raw = false } = {}) {
  const found = agentEnvironment(env);
  if (found) {
    throw new AttendedHumanRequired(
      `${command} is for a person, and this shell belongs to an agent CLI (${found.agent}: ${found.variables.join(', ')} set). `
      + 'Agents cannot verify memory. Run it from a terminal no agent CLI started, or use the Library review queue.',
      'agent-environment',
    );
  }
  if (!input?.isTTY || !output?.isTTY || (raw && typeof input.setRawMode !== 'function')) {
    throw new AttendedHumanRequired(
      `${command} requires an attended interactive terminal; use the Library review queue otherwise.`,
      'not-a-terminal',
    );
  }
}

export function verificationPhrase(documentId) {
  return `VERIFY ${String(documentId).slice(0, 8)}`;
}

export async function confirmDocumentVerification({ document, actor, input, output }) {
  if (!input?.isTTY || !output?.isTTY) {
    throw new Error('verify requires an attended interactive terminal; use the Library UI otherwise.');
  }
  if (typeof actor !== 'string' || !actor.trim()) {
    throw new Error('verify requires --as <human-name> for attribution.');
  }
  const phrase = verificationPhrase(document.id);
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`Type "${phrase}" to verify this exact document as ${actor.trim()}: `);
    if (answer.trim() !== phrase) {
      throw new Error('verification cancelled; the document was not changed.');
    }
  } finally {
    rl.close();
  }
}
