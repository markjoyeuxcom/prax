// cli/lib/skillArgs.js — argument parsing for the prax-recall / prax-remember
// skill scripts. Strict on purpose: an unknown option is an error, never
// silently dropped (the old wrappers swallowed `--ref`, so a memory lost its
// reference without any warning).
import { DOCUMENT_TYPE_VALUES, isDocumentType } from '../../public/js/documentTypes.js';
import { sanitizeAgentId } from './apiClient.js';

export const RECALL_USAGE = 'Usage: recall "<query>" [--project <slug>] [--limit <n>] [--agent <id>]\n'
  + '       recall --recent [n] [--project <slug>]';
export const REMEMBER_USAGE = `Usage: remember "<title>" "<body>" [--tags a,b] [--type ${DOCUMENT_TYPE_VALUES.join('|')}]`
  + ' [--project <slug>] [--id <uuid>] [--ref <url>] [--cite <path[:start[-end]]>] [--agent <id>]';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class UsageError extends Error {
  constructor(message, usage) {
    super(`${message}\n${usage}`);
    this.name = 'UsageError';
  }
}

function takeValue(argv, index, usage) {
  const flag = argv[index];
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} needs a value`, usage);
  return value;
}

function parseAgent(value, usage) {
  const agent = sanitizeAgentId(value);
  if (!agent) throw new UsageError(`--agent must be a short id like "claude" or "codex" (got "${value}")`, usage);
  return agent;
}

export function parseRecallArgs(argv) {
  const out = { query: '', project: '', limit: 5, recent: false, agent: undefined };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project') { out.project = takeValue(argv, i, RECALL_USAGE); i += 1; }
    else if (arg === '--limit') {
      const n = Number(takeValue(argv, i, RECALL_USAGE));
      if (!Number.isInteger(n) || n < 1) throw new UsageError('--limit must be a positive integer', RECALL_USAGE);
      out.limit = n; i += 1;
    } else if (arg === '--recent') {
      out.recent = true;
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        const n = Number(next);
        if (!Number.isInteger(n) || n < 1) throw new UsageError('--recent takes an optional positive count', RECALL_USAGE);
        out.limit = n; i += 1;
      }
    } else if (arg === '--agent') { out.agent = parseAgent(takeValue(argv, i, RECALL_USAGE), RECALL_USAGE); i += 1; }
    else if (arg.startsWith('--')) throw new UsageError(`Unknown option "${arg}"`, RECALL_USAGE);
    else rest.push(arg);
  }
  out.query = rest.join(' ').trim();
  if (!out.recent && !out.query) throw new UsageError('recall needs a query, or --recent for a chronological list', RECALL_USAGE);
  // --recent is chronological; a query next to it would be silently ignored.
  if (out.recent && out.query) throw new UsageError(`--recent lists the newest documents and takes no query (got "${out.query}")`, RECALL_USAGE);
  return out;
}

export function parseRememberArgs(argv) {
  // `projectExplicit` is what lets remember tell "the agent chose memory" from
  // "the agent said nothing": only the latter may update a same-title document
  // that lives in another project instead of duplicating it into memory.
  const out = { title: '', body: '', tags: [], type: undefined, project: 'memory', projectExplicit: false, id: undefined, ref: undefined, cite: undefined, agent: undefined };
  const rest = [];
  let tagSpelling = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tags' || arg === '--tag') {
      // `prax remember` spells it --tag; an agent that learned that syntax
      // keeps its tags here too. Both spellings in one call are refused.
      if (tagSpelling && tagSpelling !== arg) throw new UsageError(`${tagSpelling} and ${arg} are the same option; give it once`, REMEMBER_USAGE);
      tagSpelling = arg;
      out.tags = takeValue(argv, i, REMEMBER_USAGE).split(',').map((t) => t.trim()).filter(Boolean); i += 1;
    } else if (arg === '--type') {
      const type = takeValue(argv, i, REMEMBER_USAGE); i += 1;
      if (!isDocumentType(type)) throw new UsageError(`Unknown --type "${type}". Types: ${DOCUMENT_TYPE_VALUES.join(', ')}.`, REMEMBER_USAGE);
      out.type = type;
    } else if (arg === '--project') { out.project = takeValue(argv, i, REMEMBER_USAGE) || 'memory'; out.projectExplicit = true; i += 1; }
    else if (arg === '--id') {
      // Target one document outright, wherever it lives (recall prints the id).
      const id = takeValue(argv, i, REMEMBER_USAGE); i += 1;
      if (!UUID_RE.test(id)) throw new UsageError(`--id must be a document uuid (got "${id}")`, REMEMBER_USAGE);
      out.id = id.toLowerCase();
    }
    else if (arg === '--cite') {
      // Pin the code this memory makes a claim about. Validated where it is
      // resolved (against a working tree), not here.
      out.cite = takeValue(argv, i, REMEMBER_USAGE); i += 1;
    }
    else if (arg === '--ref') {
      const ref = takeValue(argv, i, REMEMBER_USAGE); i += 1;
      if (!/^https?:\/\/\S+$/i.test(ref)) throw new UsageError(`--ref must be an http(s) URL (got "${ref}")`, REMEMBER_USAGE);
      out.ref = ref;
    } else if (arg === '--agent') { out.agent = parseAgent(takeValue(argv, i, REMEMBER_USAGE), REMEMBER_USAGE); i += 1; }
    else if (arg.startsWith('--')) throw new UsageError(`Unknown option "${arg}"`, REMEMBER_USAGE);
    else rest.push(arg);
  }
  if (rest.length > 2) throw new UsageError(`Unexpected argument "${rest[2]}" — quote the title and the body`, REMEMBER_USAGE);
  out.title = (rest[0] || '').trim();
  out.body = (rest[1] || '').trim();
  if (!out.title || !out.body) throw new UsageError('remember needs a title and a body', REMEMBER_USAGE);
  return out;
}
