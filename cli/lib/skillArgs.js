// cli/lib/skillArgs.js — argument parsing for the prax-recall / prax-remember
// skill scripts. Each script is one command, declared below as a spec for the
// same engine the prax CLI uses (cli/lib/cliArgs.js), so the two grammars
// cannot drift: `--flag value` and `--flag=value` are equivalent, a lone `--`
// ends the flags, and an alias given together with its canonical spelling is
// refused. Strict on purpose: an unknown option is an error, never silently
// dropped (the old wrappers swallowed `--ref`, so a memory lost its reference
// without any warning). The skills keep their own positional syntax
// (`remember "<title>" "<body>"`) and their own wording.
import { DOCUMENT_TYPE_VALUES, isDocumentType } from '../../public/js/documentTypes.js';
import { sanitizeAgentId } from '../../server/instanceDiscovery.js';
import { parseCommand } from './cliArgs.js';

export const RECALL_USAGE = 'Usage: recall "<query>" [--project <slug>] [--limit <n>] [--budget <tokens>] [--include-harvested] [--agent <id>]\n'
  + '       recall --recent [n] [--project <slug>] [--include-harvested]\n'
  + '       recall --since-last-session | --since <iso> [--project <slug>] [--limit <n>] [--budget <tokens>] [--include-harvested] [--agent <id>]';
export const REMEMBER_USAGE = `Usage: remember "<title>" "<body>" [--tags a,b] [--type ${DOCUMENT_TYPE_VALUES.join('|')}]`
  + ' [--project <slug>] [--id <uuid>] [--ref <url>] [--cite <path[:start[-end]]>] [--agent <id>]';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class UsageError extends Error {
  constructor(message, usage) {
    super(`${message}\n${usage}`);
    this.name = 'UsageError';
  }
}

// The skills' wording for the engine's refusals.
const SKILL_MESSAGES = {
  unknownFlag: (raw) => `Unknown option "--${raw}"`,
  sameFlag: (earlier, raw) => `--${earlier} and --${raw} are the same option; give it once`,
  takesNoValue: (key) => `--${key} takes no value`,
  needsValue: (key) => `--${key} needs a value`,
};

// The declared commands. `--recent` takes the next word as its count unless
// it is another flag; a word that is not a positive count is then refused.
export const RECALL_SPEC = {
  usage: RECALL_USAGE,
  value: ['project', 'limit', 'agent', 'budget', 'since'],
  // --include-harvested shows unreviewed harvested candidates, which recall
  // leaves out by default (server/harvestedCandidates.js).
  boolean: ['since-last-session', 'include-harvested'],
  optional: { recent: (next) => !next.startsWith('--') },
};
// `prax remember` spells the tag flag --tag; an agent that learned that
// syntax keeps its tags here too.
export const REMEMBER_SPEC = {
  usage: REMEMBER_USAGE,
  value: ['tags', 'type', 'project', 'id', 'cite', 'ref', 'agent'],
  aliases: { tag: 'tags' },
  max: 2,
  unexpected: (word) => `Unexpected argument "${word}" — quote the title and the body`,
};

function parseSkillCommand(argv, spec) {
  const fail = (message) => new UsageError(message, spec.usage);
  const parsed = parseCommand(argv, {
    ...spec, messages: { ...SKILL_MESSAGES, ...(spec.unexpected ? { unexpected: spec.unexpected } : {}) }, fail,
  });
  return { ...parsed, fail };
}

function parseAgent(value, fail) {
  if (value === undefined) return undefined;
  const agent = sanitizeAgentId(value);
  if (!agent) throw fail(`--agent must be a short id like "claude" or "codex" (got "${value}")`);
  return agent;
}

const positiveCount = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : null;
};

export function parseRecallArgs(argv) {
  const { positionals, flags, fail } = parseSkillCommand(argv, RECALL_SPEC);
  // `budget`, `since` and `sinceLastSession` appear only when given, so a
  // plain recall parses to the same shape it always had.
  const out = { query: '', project: flags.project ?? '', limit: 5, recent: false, agent: undefined };
  if (flags.limit !== undefined) {
    out.limit = positiveCount(flags.limit);
    if (out.limit === null) throw fail('--limit must be a positive integer');
  }
  if (flags.budget !== undefined) {
    out.budget = positiveCount(flags.budget);
    if (out.budget === null) throw fail('--budget must be a positive number of tokens');
    // A budget bounds the printed block, not the match count.
    if (flags.limit === undefined) out.limit = 20;
  }
  if (flags['since-last-session']) out.sinceLastSession = true;
  if (flags['include-harvested']) out.includeHarvested = true;
  if (flags.since !== undefined) {
    out.since = flags.since;
    if (out.sinceLastSession) throw fail('give one of --since <iso> or --since-last-session');
  }
  if (flags.recent !== undefined) {
    out.recent = true;
    if (flags.recent !== true) {
      out.limit = positiveCount(flags.recent);
      if (out.limit === null) throw fail('--recent takes an optional positive count');
    }
  }
  out.agent = parseAgent(flags.agent, fail);
  out.query = positionals.join(' ').trim();
  const delta = out.sinceLastSession || out.since !== undefined;
  if (delta) {
    if (out.recent) throw fail('--recent and a delta (--since / --since-last-session) are different lists; give one');
    if (out.query) throw fail(`a delta lists changed memory and takes no query (got "${out.query}")`);
    // A delta page defaults to the server's size unless --limit says otherwise.
    if (flags.limit === undefined) out.limit = undefined;
    return out;
  }
  if (out.recent && out.budget !== undefined) throw fail('--budget does not apply to --recent');
  if (!out.recent && !out.query) throw fail('recall needs a query, --recent for a chronological list, or --since-last-session for what changed');
  // --recent is chronological; a query next to it would be silently ignored.
  if (out.recent && out.query) throw fail(`--recent lists the newest documents and takes no query (got "${out.query}")`);
  return out;
}

export function parseRememberArgs(argv) {
  const { positionals, flags, fail } = parseSkillCommand(argv, REMEMBER_SPEC);
  // `projectExplicit` is what lets remember tell "the agent chose memory" from
  // "the agent said nothing": only the latter may update a same-title document
  // that lives in another project instead of duplicating it into memory.
  const out = {
    title: '', body: '', tags: [], type: undefined, project: 'memory', projectExplicit: false,
    id: undefined, ref: undefined, cite: undefined, agent: undefined,
  };
  if (flags.tags !== undefined) out.tags = flags.tags.split(',').map((t) => t.trim()).filter(Boolean);
  if (flags.type !== undefined) {
    if (!isDocumentType(flags.type)) throw fail(`Unknown --type "${flags.type}". Types: ${DOCUMENT_TYPE_VALUES.join(', ')}.`);
    out.type = flags.type;
  }
  if (flags.project !== undefined) { out.project = flags.project || 'memory'; out.projectExplicit = true; }
  if (flags.id !== undefined) {
    // Target one document outright, wherever it lives (recall prints the id).
    if (!UUID_RE.test(flags.id)) throw fail(`--id must be a document uuid (got "${flags.id}")`);
    out.id = flags.id.toLowerCase();
  }
  // --cite pins the code this memory makes a claim about. Validated where it
  // is resolved (against a working tree), not here.
  out.cite = flags.cite;
  if (flags.ref !== undefined) {
    if (!/^https?:\/\/\S+$/i.test(flags.ref)) throw fail(`--ref must be an http(s) URL (got "${flags.ref}")`);
    out.ref = flags.ref;
  }
  out.agent = parseAgent(flags.agent, fail);
  out.title = (positionals[0] || '').trim();
  out.body = (positionals[1] || '').trim();
  if (!out.title || !out.body) throw fail('remember needs a title and a body');
  return out;
}
