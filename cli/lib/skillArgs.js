// cli/lib/skillArgs.js — argument parsing for the prax-recall / prax-remember
// skill scripts. Strict on purpose: an unknown option is an error, never
// silently dropped (the old wrappers swallowed `--ref`, so a memory lost its
// reference without any warning).
import { DOCUMENT_TYPE_VALUES, isDocumentType } from '../../public/js/documentTypes.js';
import { sanitizeAgentId } from './apiClient.js';

export const RECALL_USAGE = 'Usage: recall "<query>" [--project <slug>] [--limit <n>] [--agent <id>]\n'
  + '       recall --recent [n] [--project <slug>]';
export const REMEMBER_USAGE = `Usage: remember "<title>" "<body>" [--tags a,b] [--type ${DOCUMENT_TYPE_VALUES.join('|')}]`
  + ' [--project <slug>] [--ref <url>] [--cite <path[:start[-end]]>] [--agent <id>]';

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
  return out;
}

export function parseRememberArgs(argv) {
  const out = { title: '', body: '', tags: [], type: undefined, project: 'memory', ref: undefined, cite: undefined, agent: undefined };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tags') {
      out.tags = takeValue(argv, i, REMEMBER_USAGE).split(',').map((t) => t.trim()).filter(Boolean); i += 1;
    } else if (arg === '--type') {
      const type = takeValue(argv, i, REMEMBER_USAGE); i += 1;
      if (!isDocumentType(type)) throw new UsageError(`Unknown --type "${type}". Types: ${DOCUMENT_TYPE_VALUES.join(', ')}.`, REMEMBER_USAGE);
      out.type = type;
    } else if (arg === '--project') { out.project = takeValue(argv, i, REMEMBER_USAGE) || 'memory'; i += 1; }
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
