#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { detectProject, detectRepoUrl } from './lib/detectProject.js';
import { matchProjectByRepoUrl, normalizeRepoUrl } from '../server/repoUrl.js';
import { DOCUMENT_TYPE_VALUES, isDocumentType } from '../public/js/documentTypes.js';
import { createClient } from './lib/apiClient.js';
import { formatSearchResults, formatDocument, trustLabel } from './lib/format.js';
import { recall, formatRecall } from './lib/recall.js';
import { memoryDelta, planDelta, recordDelta, parseSince } from './lib/delta.js';
import { budgetedContext, formatBudgetedContext, budgetedContextJson } from './lib/context.js';
import { buildBrief, formatBrief, briefJson } from './lib/brief.js';
import { remember } from './lib/remember.js';
import { projectOverview, overviewCaveat } from './lib/overview.js';
import { assertAttendedHuman, confirmDocumentVerification } from './lib/verify.js';
import { formatMove, moveRecord } from './lib/move.js';
import { createTriageClient, triage } from './lib/triage.js';
import { searchLibrary, describeRetrieval } from './lib/search.js';
import { createCheckout, createRepoReader, headSha } from './lib/repoFiles.js';
import { resolveCitation } from './lib/codeRefs.js';
import { checkCommand, CHECK_USAGE } from './lib/checkCommand.js';
import {
  CliUsageError, checkCommandArgs, flagValue, parseArgs, positiveIntFlag, repeatedValues,
} from './lib/cliArgs.js';
import { sanitizeAgentId } from './lib/apiClient.js';
import {
  buildTaskRecord, buildTaskPatch, createTask, updateTask, completeTask, setChecklistItem,
  formatTask, formatTaskList, isTaskId, selectListedTasks, TASK_PRIORITIES, TASK_STATUSES,
} from './lib/tasks.js';
import {
  MIRROR_BOOLEAN_FLAGS, MIRROR_COMMAND, MIRROR_HELP, MIRROR_VALUE_FLAGS, runMirror,
} from './lib/mirrorCommand.js';
import { runHarvest } from './lib/harvestCommand.js';
import { runSessionStart } from './lib/sessionStart.js';
import { repoUrlCheck } from './lib/librarian.js';
import {
  markUsed, doctorExitCode, formatDoctor, formatTelemetryStatus, DOCTOR_EXIT,
} from './lib/librarian.js';

// The declared flag grammar (cli/lib/cliArgs.js). Every flag any command
// takes is named here with its kind, so an unknown or mistyped flag is refused
// instead of stored and ignored, and a boolean flag never swallows the next
// word (`search --json postgres backup` searches for both words). Flags that
// accumulate when repeated (`--check a --check b`) are `repeatable`; every
// other flag is last-wins.
const REPEATABLE_FLAGS = ['check'];
const BOOLEAN_FLAGS = ['json', 'help', 'all', 'all-projects', 'memory', 'since-last-session', 'include-harvested', 'comment', 'strict', 'foreground', 'dry-run', 'handoff'];
// `--recent` takes a count only when the next word is one.
const OPTIONAL_FLAGS = { recent: (next) => /^\d+$/.test(next) };
const VALUE_FLAGS = [
  'project', 'url', 'agent', 'limit', 'body', 'type', 'tag', 'ref', 'cite', 'id', 'as', 'with', 'to',
  'priority', 'status', 'due', 'planned', 'label', 'description', 'notes', 'query', 'title', 'append-notes',
  ...MIRROR_VALUE_FLAGS,
  'diff', 'files',
  'transcript', 'hook', 'session', 'budget-ms', 'input',
  'budget', 'since',
];
// The prax-remember skill spells the tag flag --tags; an agent that learned
// that syntax keeps its tags here too (both spellings at once are refused).
const FLAG_ALIASES = { tags: 'tag' };

const GLOBAL_FLAGS = ['project', 'url', 'agent', 'json', 'help'];
const TASK_FIELD_FLAGS = ['priority', 'status', 'due', 'planned', 'label', 'description', 'notes'];
// Per command: the flags it takes beyond the global ones, and how many words
// may follow the command (`max: 1` = exactly one value, which must be quoted
// when it contains spaces).
const COMMANDS = {
  help: { flags: [], max: Infinity, usage: 'prax help' },
  init: { flags: [], max: 0, usage: 'prax init [--project <slug>]' },
  // --include-harvested: show unreviewed harvested candidates, which
  // retrieval leaves out by default (server/harvestedCandidates.js).
  context: { flags: ['limit', 'budget', 'include-harvested'], usage: 'prax context [query...] [--json] [--limit <n>] [--budget <tokens>] [--include-harvested]' },
  search: { flags: ['all', 'include-harvested'], usage: 'prax search <query> [--all] [--include-harvested] [--json]' },
  recall: {
    flags: ['limit', 'recent', 'budget', 'since', 'since-last-session', 'include-harvested'],
    usage: 'prax recall [query...] [--project <slug>] [--limit <n>] [--budget <tokens>] [--recent [n] | --since-last-session | --since <iso>] [--include-harvested] [--json]',
  },
  brief: { flags: ['budget', 'include-harvested'], max: 1, usage: 'prax brief <task-id> [--budget <tokens>] [--include-harvested] [--json]' },
  get: { flags: [], max: 1, usage: 'prax get <id> [--json]' },
  overview: { flags: [], max: 0, usage: 'prax overview [--project <slug>] [--json]' },
  remember: {
    flags: ['body', 'memory', 'type', 'tag', 'ref', 'cite', 'id'],
    max: 1,
    usage: 'prax remember "<title>" --body <text> [--memory] [--type <type>] [--tag a,b] [--ref <url>] [--cite <path[:start[-end]]>] [--id <uuid>]',
  },
  verify: { flags: ['as'], max: 1, usage: 'prax verify <id> --as <human-name>' },
  triage: { flags: ['as'], max: 0, usage: 'prax triage [--as <human-name>] [--project <slug>]' },
  unverify: { flags: [], max: 1, usage: 'prax unverify <id>' },
  supersede: { flags: ['with'], max: 1, usage: 'prax supersede <oldId> --with <newId>' },
  move: { flags: ['to'], max: 1, usage: 'prax move <id> --to <project-slug> [--json]' },
  task: { flags: [], max: Infinity, usage: 'prax task <add|list|show|update|done|check|uncheck> …' },
  mirror: MIRROR_COMMAND,
  check: { flags: ['diff', 'files', 'comment', 'strict'], max: 0, usage: CHECK_USAGE },
  // --input/--handoff are the hook worker's own (a detached child reads the
  // hook JSON its parent saved); a person uses --transcript or stdin.
  harvest: {
    flags: ['transcript', 'hook', 'session', 'budget-ms', 'foreground', 'dry-run', 'input', 'handoff'],
    max: 0,
    usage: 'prax harvest [--transcript <file>] [--session <id>] [--dry-run] [--budget-ms <n>] [--json]   (or --hook claude|codex|copilot, reading hook JSON on stdin)',
  },
  // Librarian (docs/design/librarian.md).
  'session-start': {
    flags: ['hook', 'budget'], max: 0,
    usage: 'prax session-start --hook claude|codex|copilot [--budget <tokens>]   (the SessionStart hook: reads hook JSON on stdin, prints a briefing as context)',
  },
  used: { flags: [], max: 1, usage: 'prax used <id> [--json]' },
  doctor: { flags: [], max: 0, usage: 'prax doctor [--project <slug>] [--json]' },
  telemetry: { flags: [], max: 1, usage: 'prax telemetry <status|clear> [--json]' },
};
const TASK_COMMANDS = {
  add: { flags: [...TASK_FIELD_FLAGS, 'check'], usage: 'prax task add <title> [--priority p] [--status s] [--due d] [--planned d] [--label a,b] [--description t] [--notes t] [--check <item>]...' },
  list: { flags: ['status', 'all-projects', 'query', 'all'], max: 0, usage: 'prax task list [--status <s>] [--all] [--all-projects] [--query <text>] [--json]' },
  show: { flags: [], max: 1, usage: 'prax task show <id> [--json]' },
  update: { flags: [...TASK_FIELD_FLAGS, 'title', 'append-notes'], max: 1, usage: 'prax task update <id> [--title t] [--status s] [--priority p] [--due d] [--planned d] [--label a,b] [--description t] [--notes t | --append-notes t]' },
  done: { flags: [], max: 1, usage: 'prax task done <id>' },
  check: { flags: [], usage: 'prax task check <id> <n|label>' },
  uncheck: { flags: [], usage: 'prax task uncheck <id> <n|label>' },
};

// Flag kinds are chosen per command. `--check <item>` is a repeatable
// checklist item for `task add`, while `mirror --check` is a boolean; one
// global grammar held both kinds, the boolean won, and every
// `task add --check` was refused (v0.39.0). A name with two kinds in one
// command's grammar is a programming error, so every grammar is checked when
// the CLI loads and a collision stops every command, not just the one hit.
function grammarFor(command) {
  const mirror = command === 'mirror';
  const repeatable = mirror ? [] : REPEATABLE_FLAGS;
  const boolean = [...BOOLEAN_FLAGS, ...MIRROR_BOOLEAN_FLAGS.filter((name) => mirror || !repeatable.includes(name))];
  const kindOf = new Map();
  for (const [kind, names] of [['repeatable', repeatable], ['boolean', boolean], ['value', VALUE_FLAGS], ['optional', Object.keys(OPTIONAL_FLAGS)]]) {
    for (const name of names) {
      if (kindOf.has(name) && kindOf.get(name) !== kind) {
        throw new Error(`prax: --${name} is declared both ${kindOf.get(name)} and ${kind} for ${command || 'the CLI'}`);
      }
      kindOf.set(name, kind);
    }
  }
  return { repeatable, boolean };
}
for (const command of [undefined, ...Object.keys(COMMANDS)]) grammarFor(command);

// The command word, read before its grammar is chosen: the first word that is
// neither a flag nor the value of a value-taking flag (`--project demo task`).
function commandWord(argv) {
  const takesValue = new Set([...VALUE_FLAGS, ...Object.keys(FLAG_ALIASES)]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') return argv[i + 1];
    if (!arg.startsWith('--')) return arg;
    if (!arg.includes('=') && takesValue.has(arg.slice(2))) i += 1;
  }
  return undefined;
}

// The usage line for whatever command argv names, for a refusal message.
function usageFor(argv) {
  const words = argv.filter((a) => !a.startsWith('--'));
  const command = COMMANDS[words[0]];
  if (!command) return 'Run `prax help` for usage.';
  if (words[0] === 'task' && TASK_COMMANDS[words[1]]) return `Usage: ${TASK_COMMANDS[words[1]].usage}`;
  return `Usage: ${command.usage}`;
}

function parseCommandLine(argv) {
  let parsed;
  try {
    parsed = parseArgs(argv, {
      ...grammarFor(commandWord(argv)),
      optional: OPTIONAL_FLAGS,
      known: VALUE_FLAGS,
      aliases: FLAG_ALIASES,
    });
  } catch (err) {
    if (err instanceof CliUsageError) err.message = `${err.message}\n${usageFor(argv)}`;
    // prax check keeps exit 1 for drift alone; a usage error is exit 2.
    if (argv.find((a) => !a.startsWith('--')) === 'check') err.exitCode = 2;
    throw err;
  }
  const { positionals, flags } = parsed;
  const command = positionals[0];
  if (!command || flags.help) return parsed;
  const spec = COMMANDS[command];
  if (!spec) return parsed; // reported as an unknown command by main
  if (command === 'task' && TASK_COMMANDS[positionals[1]]) {
    const sub = TASK_COMMANDS[positionals[1]];
    checkCommandArgs(`task ${positionals[1]}`, { flags, positionals: positionals.slice(2) }, {
      allowed: [...GLOBAL_FLAGS, ...sub.flags], max: sub.max, usage: sub.usage,
    });
    return parsed;
  }
  try {
    checkCommandArgs(command, { flags, positionals: positionals.slice(1) }, {
      allowed: [...GLOBAL_FLAGS, ...spec.flags], max: spec.max, usage: spec.usage,
    });
  } catch (err) {
    if (command === 'check') err.exitCode = 2; // exit 1 means drift
    throw err;
  }
  return parsed;
}

// `write`: the command creates the project when it does not exist (remember,
// task add), so a folder-name guess that names no existing project is said
// out loud on stderr instead of silently becoming a new project.
async function resolveProjectName(flags, client, { write = false } = {}) {
  // MOOMORA_PROJECT is the pre-rename env var; still honoured so existing setups keep working.
  const detected = detectProject({ flag: flags.project, env: process.env.PRAX_PROJECT || process.env.MOOMORA_PROJECT });
  // Explicit intent (flag/env/a marker inside this repository) always wins.
  // A git-remote match upgrades only the weaker signals — the folder-name
  // guess and a marker found above the repository root — so recall/remember
  // land in the registered project from any checkout or worktree, even one
  // that sits inside a folder carrying another project's marker.
  let projects = null;
  if (['folder', 'none', 'outer-file'].includes(detected.source)) {
    const repoUrl = detectRepoUrl({});
    if (repoUrl && client) {
      try {
        projects = await client.listProjects();
        const match = matchProjectByRepoUrl(projects, repoUrl);
        if (match) return { project: match.slug, source: 'git' };
      } catch {
        // API unreachable — fall back to the local guess (callers surface
        // connection errors on their own requests).
      }
    }
  }
  if (!detected.project) {
    throw new Error('No project detected. Pass --project <slug>, set PRAX_PROJECT, or run `prax init`.');
  }
  if (write && detected.source === 'folder' && client) {
    try {
      projects ??= await client.listProjects();
      const name = detected.project.toLowerCase();
      const exists = (Array.isArray(projects) ? projects : [])
        .some((p) => p.slug === detected.project || (p.name && p.name.toLowerCase() === name));
      if (!exists) {
        process.stderr.write(`prax: no project matches this directory; "${detected.project}" (the folder name) will be created. Pass --project <slug> or run \`prax init\` to choose one.\n`);
      }
    } catch {
      // unreachable — the write itself reports it
    }
  }
  return detected;
}

const HELP = `prax — shared project memory CLI

Usage:
  prax init [--project <slug>]
  prax context [query...] [--json] [--limit <n>] [--budget <tokens>] [--include-harvested]
  prax search <query> [--all] [--include-harvested] [--json]
  prax recall [query...] [--project <slug>] [--limit <n>] [--budget <tokens>] [--recent [n]] [--include-harvested] [--json]
  prax recall --since-last-session | --since <iso> [--project <slug>] [--limit <n>] [--budget <tokens>] [--include-harvested] [--json]
  prax brief <task-id> [--budget <tokens>] [--include-harvested] [--json]
  prax get <id> [--json]
  prax overview [--project <slug>] [--json]
  prax remember "<title>" --body <text> [--memory] [--type note|runbook|decision|known-issue|reference|post-mortem|template] [--tag a,b] [--ref <url>] [--cite <path[:start[-end]]>] [--id <uuid>]
  prax verify <id> --as <human-name>
  prax triage [--as <human-name>] [--project <slug>]    (interactive review queue; people only)
  prax unverify <id>
  prax supersede <oldId> --with <newId>
  prax move <id> --to <project-slug> [--json]    (refile one document or task under another project)
  prax task add <title> [--priority high|medium|low] [--status planned|in-progress|...] [--due YYYY-MM-DD] [--planned YYYY-MM-DD] [--label a,b] [--description <text>] [--notes <text>] [--check <item>]...
  prax task list [--status <status>] [--all] [--all-projects] [--query <text>] [--json]
  prax task show <id> [--json]
  prax task update <id> [--title <t>] [--status <s>] [--priority <p>] [--due <d>] [--planned <d>] [--label a,b] [--description <text>] [--notes <text> | --append-notes <text>]
  prax task done <id>
  prax task check <id> <n|label>      prax task uncheck <id> <n|label>
${MIRROR_HELP}
  prax check [--diff <range> | --files <a,b,…>] [--project <slug>] [--comment] [--strict] [--json]
  prax harvest [--transcript <file>] [--session <id>] [--dry-run] [--budget-ms <n>] [--json]
  prax session-start --hook claude|codex|copilot [--budget <tokens>]    (the SessionStart hook: hook JSON on stdin, a briefing as context)
  prax harvest --hook claude|codex|copilot      (agent CLI hook: hook JSON on stdin; always exits 0)
  prax used <id>                      (after acting on a recalled memory)
  prax doctor [--project <slug>] [--json]   (exit 0 ok, 2 warnings, 1 could not run)
  prax telemetry <status|clear> [--json]

Global flags: --project <slug>  --url <baseUrl>  --agent <id>  --json
Retrieval (context, search, recall, brief) leaves out unreviewed harvested candidates (unverified, tagged harvested) and says how many; --include-harvested shows them.
Env: PRAX_API_URL  PRAX_PROJECT  PRAX_API_TOKEN (or PRAX_TOKEN)  PRAX_AGENT  PRAX_TIMEOUT_MS (default 30000)
App discovery: --url > PRAX_API_URL > the desktop app's saved port (webview-port) > http://127.0.0.1:3000
Project detection: --project > PRAX_PROJECT > .prax/project.json in this repository > git remote match > .prax/project.json above the repository > repository folder name
Provenance: writes are stamped updatedBy=agent plus the agent id (--agent, PRAX_AGENT, or auto: claude / codex / copilot / antigravity); --memory writes also carry kind=synthesized`;

async function main(argv) {
  const { positionals, flags } = parseCommandLine(argv);
  const command = positionals[0];
  // An invalid --agent is refused: turning it into "no agent" would also
  // switch off the auto-detected id and write the memory anonymously.
  const agentFlag = flagValue(flags, 'agent');
  const agent = agentFlag === undefined ? undefined : sanitizeAgentId(agentFlag);
  if (agentFlag !== undefined && !agent) {
    throw new CliUsageError(`--agent must be a short id like "claude" or "codex" (got "${agentFlag}").`);
  }
  const client = createClient({ baseUrl: flags.url, agent });
  const out = (text) => process.stdout.write(`${typeof text === 'string' ? text : JSON.stringify(text, null, 2)}\n`);

  if (!command || command === 'help' || flags.help) { out(HELP); return; }

  if (command === 'harvest') {
    return runHarvest({ flags, agent, out, createClient: (options) => createClient({ ...options, agent: options.agent ?? agent }) });
  }

  if (command === 'session-start') {
    process.exitCode = await runSessionStart({
      flags, agent, out, createClient: (options) => createClient({ ...options, baseUrl: flags.url, agent: options.agent ?? agent }),
    });
    return;
  }

  if (command === 'init') {
    const repoUrl = detectRepoUrl({});
    // --project > PRAX_PROJECT > git-remote match > an existing .prax/project.json
    // (detectProject below re-adopts it) > folder name — the documented order.
    let project = flags.project || process.env.PRAX_PROJECT || undefined;
    // A repo already registered to a project ADOPTS that project — a second
    // checkout must not auto-create a folder-named duplicate and split memory
    // between two projects.
    if (!project && repoUrl) {
      try {
        const match = matchProjectByRepoUrl(await client.listProjects(), repoUrl);
        if (match) {
          project = match.slug;
          out(`Matched this repo to existing project "${match.name}".`);
        }
      } catch {
        // API unreachable — fall through to the local guess
      }
    }
    if (!project) project = detectProject({}).project;
    if (!project) throw new Error('Cannot infer a project name; pass --project <slug>.');
    mkdirSync('.prax', { recursive: true });
    writeFileSync(join('.prax', 'project.json'), `${JSON.stringify({ project }, null, 2)}\n`);
    out(`Wrote .prax/project.json (project: ${project}).`);
    // Register the repo URL on the project (best-effort) so other checkouts and
    // worktrees of this repo auto-detect it without their own `prax init`.
    if (repoUrl) {
      try {
        const slug = await client.ensureProject(project);
        const record = (await client.listProjects()).find((p) => p.slug === slug);
        if (record && !record.repoUrl) {
          await client.updateProject(record.id, { repoUrl });
          out(`Registered repo ${repoUrl} on project "${record.name}".`);
        } else if (record?.repoUrl && normalizeRepoUrl(record.repoUrl) !== normalizeRepoUrl(repoUrl)) {
          // Normalized compare — a different SPELLING of the same repo is not
          // a conflict, only a genuinely different repository is.
          out(`Note: project "${record.name}" is registered to ${record.repoUrl} — left unchanged.`);
        }
      } catch {
        out('Note: could not register the repo URL (is the app running?) — detection will use the folder name.');
      }
    }
    return;
  }

  const includeHarvested = Boolean(flags['include-harvested']);

  if (command === 'context') {
    const { project } = await resolveProjectName(flags, client);
    const query = positionals.slice(1).join(' ');
    const format = flags.json ? 'json' : 'md';
    const limit = positiveIntFlag(flags, 'limit');
    const budget = positiveIntFlag(flags, 'budget');
    if (budget !== undefined) {
      // Filled here, not on the server: only this checkout can say whether
      // cited code still matches (the fill order's second tier).
      const result = await budgetedContext(client, {
        project, query, limit, budget, checkout: createCheckout(), includeHarvested,
      });
      out(flags.json ? budgetedContextJson(result) : formatBudgetedContext(result));
      return;
    }
    const pack = await client.contextPack(project, {
      query, format, limit, source: 'context', includeHarvested,
    });
    out(pack);
    return;
  }

  if (command === 'search') {
    const { project } = await resolveProjectName(flags, client);
    const query = positionals.slice(1).join(' ');
    if (!query) throw new Error('search requires a query.');
    const envelope = await searchLibrary(client, {
      project, query, all: Boolean(flags.all), includeHarvested,
    });
    out(flags.json
      ? envelope
      : `${describeRetrieval(envelope.retrieval) ? `${describeRetrieval(envelope.retrieval)}\n\n` : ''}${formatSearchResults(envelope.items)}`);
    return;
  }

  if (command === 'recall') {
    const project = flagValue(flags, 'project');
    const recent = flags.recent !== undefined;
    const recentCount = positiveIntFlag(flags, 'recent');
    const limitFlag = positiveIntFlag(flags, 'limit');
    if (recentCount !== undefined && limitFlag !== undefined) {
      throw new CliUsageError('give the count once: --recent <n> or --limit <n>.');
    }
    const budget = positiveIntFlag(flags, 'budget');
    const query = positionals.slice(1).join(' ');
    const sinceFlag = flagValue(flags, 'since');
    const sinceLastSession = Boolean(flags['since-last-session']);
    if (sinceFlag !== undefined || sinceLastSession) {
      // The delta: what changed in memory since this agent's last delta (or
      // since --since), instead of a search.
      if (sinceFlag !== undefined && sinceLastSession) throw new CliUsageError('give one of --since <iso> or --since-last-session.');
      if (recent) throw new CliUsageError('--recent and a delta (--since / --since-last-session) are different lists; give one.');
      if (query) throw new CliUsageError(`a delta lists changed memory and takes no query (got "${query}").`);
      const since = sinceFlag === undefined ? undefined : parseSince(sinceFlag);
      if (sinceFlag !== undefined && !since) throw new CliUsageError(`--since must be an ISO-8601 date or date-time (got "${sinceFlag}").`);
      if (sinceLastSession && !client.agent) {
        throw new CliUsageError('--since-last-session needs an agent id: pass --agent <id> or set PRAX_AGENT.');
      }
      const result = await memoryDelta(client, {
        since, sinceLastSession, project, limit: limitFlag, checkout: createCheckout(), includeHarvested,
      });
      const planned = planDelta(result, budget ?? Infinity);
      out(flags.json ? { ...result, budget: planned.summary, advance: sinceLastSession && planned.advance } : planned.text);
      // Only after the block is out, and only when nothing was left out: the
      // marker is the end of what this agent has actually read.
      let marked = false;
      if (sinceLastSession && planned.advance) {
        const recorded = await recordDelta(client, result, { project });
        marked = recorded.marked;
        if (recorded.error) process.stderr.write(`prax: could not record the delta marker (${recorded.error.message}); the next --since-last-session repeats these changes.\n`);
      }
      if (flags.json && sinceLastSession) process.stderr.write(`prax: delta marker ${marked ? `recorded at ${result.until}` : 'not advanced'}.\n`);
      return;
    }
    if (budget !== undefined && recent) throw new CliUsageError('--budget does not apply to --recent (a chronological list bounded by its count).');
    // A budget bounds the printed block, not the match count: without --limit
    // it considers up to 20 matches.
    const limit = recentCount ?? limitFlag ?? (budget !== undefined ? 20 : 5);
    if (!recent && !query) throw new CliUsageError('recall requires a query (or use --recent).');
    // --recent is a chronological list; a query would be silently ignored.
    if (recent && query) throw new CliUsageError(`recall --recent lists the newest documents and takes no query (got "${query}").`);
    const result = await recall(client, {
      query, project, limit, recent, budget, checkout: createCheckout(), includeHarvested,
    });
    out(flags.json ? result : formatRecall(result));
    return;
  }

  if (command === 'overview') {
    const { project } = await resolveProjectName(flags, client);
    const result = await projectOverview(client, project);
    if (flags.json) { out(result); return; }
    if (!result.found) {
      out(`No project overview for "${result.project.slug}". Create one from Library ▸ New doc ▸ Templates & guides ▸ Project overview and tag it project-card.`);
      return;
    }
    out(`${overviewCaveat(result)}\n\n${formatDocument(result.doc)}`);
    return;
  }

  if (command === 'brief') {
    const id = positionals[1];
    if (!isTaskId(id)) throw new CliUsageError('brief requires a task uuid (prax task list shows them).');
    const budget = positiveIntFlag(flags, 'budget');
    const brief = await buildBrief(client, {
      taskId: id, budget, checkout: createCheckout(), includeHarvested,
    });
    out(flags.json ? briefJson(brief) : formatBrief(brief));
    return;
  }

  if (command === 'get') {
    const id = positionals[1];
    if (!id) throw new Error('get requires a document id.');
    const doc = await client.getDocument(id);
    out(flags.json ? doc : formatDocument(doc));
    return;
  }

  if (command === 'remember') {
    const title = positionals[1];
    if (!title) throw new Error('remember requires a title.');
    // A remember always carries a body: an update writes it over the stored
    // document, so a missing or blank one would erase the memory (QINV-01).
    const body = flagValue(flags, 'body');
    if (body === undefined || !body.trim()) {
      throw new Error('remember needs a non-empty --body; it replaces the stored body of a same-title document.');
    }
    // undefined = --type not given (create defaults to note; update keeps the
    // stored type). A given value is validated against the shared registry.
    const type = flagValue(flags, 'type');
    if (type !== undefined && !isDocumentType(type)) {
      throw new Error(`Unknown --type "${type}". Types: ${DOCUMENT_TYPE_VALUES.join(', ')}.`);
    }
    // No --tag = keep the stored tags on update (every path); --tag replaces
    // them on a same-title update and is merged on --id / cross-project.
    const tagFlag = flagValue(flags, 'tag');
    const userTags = tagFlag === undefined ? [] : tagFlag.split(',').map((t) => t.trim()).filter(Boolean);
    const tags = tagFlag === undefined && !flags.memory ? undefined : [...userTags, ...(flags.memory ? ['memory'] : [])];
    // --id targets one document wherever it lives; --memory without --project
    // refines a same-title document in its own project instead of duplicating
    // it into memory (the project-scoped `prax remember` is left alone: there
    // the project was chosen, by flag or by the checkout).
    const id = flagValue(flags, 'id');
    if (id !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error(`--id must be a document uuid (got "${id}").`);
    }
    const ref = flagValue(flags, 'ref');
    const cite = flagValue(flags, 'cite');
    const crossProject = Boolean(flags.memory) && !flags.project && !id;
    // Every flag is validated before this first network call.
    const project = flags.memory ? 'memory' : (await resolveProjectName(flags, client, { write: true })).project;
    // A --memory write is agent memory, so it carries the same provenance the
    // prax-remember skill stamps (kind: synthesized). A project-scoped write is
    // left alone: it is a note about this project, not synthesized memory.
    const kind = flags.memory ? 'synthesized' : undefined;
    const result = await remember(client, { title, body, project, type, tags, kind, id, crossProject });
    const { doc, action } = result;
    // Optional --ref <url> attaches an external reference to the memory. Best-
    // effort: a bad URL doesn't fail the remember (the doc is already saved).
    if (ref !== undefined) {
      try { await client.addExternalRef(doc.id, { url: ref }); }
      catch (err) { process.stderr.write(`prax: could not attach --ref: ${err.message}\n`); }
    }
    // Optional --cite <path[:start[-end]]> pins the code this memory makes a
    // claim about, so a later recall can say the claim's ground has moved.
    // Best-effort for the same reason as --ref: the memory is already saved.
    if (cite !== undefined) {
      try {
        const read = createRepoReader();
        if (!read) throw new Error('not inside a git repository');
        const citation = resolveCitation(cite, { readFile: read, headSha: headSha() });
        await client.addCodeRef(doc.id, citation);
      } catch (err) { process.stderr.write(`prax: could not attach --cite: ${err.message}\n`); }
    }
    // Always name the project the write landed in, and the trust it now has:
    // an update that leaves the title and body unchanged keeps a verification.
    const where = result.project || project;
    out(flags.json ? doc : `${action === 'updated' ? 'Updated' : 'Remembered'} "${doc.title}" (${doc.id}) in ${where} — ${trustLabel(doc)}, at ${client.base}.`);
    return;
  }

  if (command === 'verify') {
    const id = positionals[1];
    if (!id) throw new Error('verify requires a document id.');
    if (flags.json) throw new Error('verify is interactive and does not support --json.');
    // People only: refused in an agent CLI's shell (or with --agent) and
    // without a terminal, before anything is read (cli/lib/verify.js).
    assertAttendedHuman({
      input: process.stdin, output: process.stdout, command: 'verify',
      env: agent ? { ...process.env, PRAX_AGENT: agent } : process.env,
    });
    const actor = (flagValue(flags, 'as') ?? '').trim();
    if (!actor) throw new Error('verify requires --as <human-name> for attribution.');
    const current = await client.getDocument(id);
    // The reviewed revision covers the title AND body the person is shown; an
    // older server ignores it and still checks the body hash sent alongside.
    if (!/^[0-9a-f]{64}$/i.test(current?.revision || '')) {
      throw new Error('the document has no valid revision token and cannot be verified safely.');
    }
    if (!/^[0-9a-f]{64}$/i.test(current?.contentHash || '')) {
      throw new Error('the document has no valid content hash and cannot be verified safely.');
    }
    out(formatDocument(current));
    await confirmDocumentVerification({
      document: current, actor, input: process.stdin, output: process.stdout,
    });
    const doc = await client.verify(id, {
      verified: true, as: actor, revision: current.revision, contentHash: current.contentHash,
    });
    out(`Verified ${doc.id} as ${actor}.`);
    return;
  }

  // Interactive review-queue pass (cli/lib/triage.js). The guard runs before
  // any request; --project narrows the queue and is never guessed from the
  // checkout, since the queue is library-wide like the UI's.
  if (command === 'triage') {
    if (flags.json) throw new CliUsageError('triage is interactive and does not support --json.');
    const env = agent ? { ...process.env, PRAX_AGENT: agent } : process.env;
    assertAttendedHuman({
      input: process.stdin, output: process.stdout, env, command: 'triage', raw: true,
    });
    await triage({
      input: process.stdin,
      output: process.stdout,
      env,
      client: createTriageClient({ baseUrl: flags.url }),
      as: flagValue(flags, 'as'),
      project: flagValue(flags, 'project'),
      checkout: createCheckout(),
    });
    return;
  }

  if (command === 'unverify') {
    const id = positionals[1];
    if (!id) throw new Error('unverify requires a document id.');
    const doc = await client.verify(id, { verified: false });
    out(flags.json ? doc : `Unverified ${id}.`);
    return;
  }

  if (command === 'supersede') {
    const oldId = positionals[1];
    const newId = flagValue(flags, 'with');
    if (!oldId || !newId) throw new Error('supersede requires <oldId> --with <newId>.');
    const doc = await client.supersede(oldId, newId);
    out(flags.json ? doc : `Superseded ${oldId} with ${newId}.`);
    return;
  }

  if (command === 'move') {
    const result = await moveRecord(client, positionals[1], flagValue(flags, 'to'));
    out(flags.json ? { kind: result.kind, id: result.id, title: result.title, from: result.from, to: result.to, record: result.record } : formatMove(result));
    return;
  }

  if (command === 'mirror') {
    await runMirror({ positionals, flags, client, out, resolveProject: (options) => resolveProjectName(flags, client, options) });
    return;
  }

  if (command === 'check') {
    // Cite-drift gate (cli/lib/checkCommand.js). Read-only; exit 0 clean or
    // skipped fail-open, 1 drift, 2 could not check.
    process.exitCode = await checkCommand({ flags, client });
    return;
  }

  if (command === 'task') {
    const sub = positionals[1];
    const TASK_HELP = 'task subcommands: add, list, show, update, done, check, uncheck';
    if (!sub || sub === 'help') { out(TASK_HELP); return; }

    if (sub === 'add') {
      const title = positionals.slice(2).join(' ');
      const checks = repeatedValues(flags, 'check');
      const record = buildTaskRecord({ title, flags, checks });
      const { project } = await resolveProjectName(flags, client, { write: true });
      const { task, replayed, project: slug } = await createTask(client, { project, record });
      out(flags.json ? task : `${replayed ? 'Already added' : 'Added'} "${task.title}" (${task.id}) in ${slug}${record.checklist ? ` with ${record.checklist.length} checklist item${record.checklist.length === 1 ? '' : 's'}` : ''} — at ${client.base}.`);
      return;
    }

    if (sub === 'list') {
      const status = flagValue(flags, 'status');
      if (status !== undefined && !TASK_STATUSES.includes(status)) {
        throw new Error(`Unknown --status "${status}". Values: ${TASK_STATUSES.join(', ')}.`);
      }
      const q = flagValue(flags, 'query');
      const allProjects = Boolean(flags['all-projects']);
      const project = allProjects ? undefined : (await resolveProjectName(flags, client)).project;
      // Open tasks by default, as documented; --all (or an explicit --status)
      // includes completed ones.
      const tasks = selectListedTasks(await client.listTasks({ project, status, q }), {
        status, all: Boolean(flags.all),
      });
      if (flags.json) { out(tasks); return; }
      let projectNames;
      if (allProjects) {
        try { projectNames = new Map((await client.listProjects()).map((p) => [p.id, p.slug])); } catch { /* names are a nicety */ }
      }
      out(formatTaskList(tasks, { projectNames }));
      return;
    }

    if (sub === 'show') {
      const id = positionals[2];
      if (!isTaskId(id)) throw new Error('task show requires a task uuid.');
      const task = await client.getTask(id);
      const checklist = await client.listChecklist(id);
      out(flags.json ? { ...task, checklist } : formatTask(task, checklist));
      return;
    }

    if (sub === 'update') {
      const id = positionals[2];
      const patch = buildTaskPatch(flags);
      const addition = flagValue(flags, 'append-notes');
      const task = await updateTask(client, id, { patch, appendNotes: addition });
      out(flags.json ? task : `Updated "${task.title}" (${task.id}) — status ${task.status}, at ${client.base}.`);
      return;
    }

    if (sub === 'done') {
      const id = positionals[2];
      const task = await completeTask(client, id);
      out(flags.json ? task : `Completed "${task.title}" (${task.id})${task.nextOccurrenceTaskId ? `; next occurrence ${task.nextOccurrenceTaskId}` : ''}.`);
      return;
    }

    if (sub === 'check' || sub === 'uncheck') {
      const id = positionals[2];
      const selector = positionals.slice(3).join(' ');
      const { item, index } = await setChecklistItem(client, id, selector, sub === 'check');
      out(flags.json ? item : `${sub === 'check' ? 'Checked' : 'Unchecked'} ${index}. ${item.label}`);
      return;
    }

    throw new Error(`Unknown task subcommand: ${sub}\n\n${TASK_HELP}\nPriorities: ${TASK_PRIORITIES.join(', ')}. Statuses: ${TASK_STATUSES.join(', ')}.`);
  }

  if (command === 'used') {
    const id = positionals[1];
    const use = await markUsed(client, id);
    out(flags.json ? use : `Noted: used "${use.title || id}" (${id}).`);
    return;
  }

  if (command === 'doctor') {
    const project = flagValue(flags, 'project');
    let report;
    try {
      report = await client.librarianReport(project);
    } catch (err) {
      process.stderr.write(`prax: doctor could not run: ${err.message}\n`);
      process.exitCode = DOCTOR_EXIT.failed;
      return;
    }
    // A CLI-side check: only this checkout can say whether the project's
    // registered repo URL still matches the origin here.
    const drift = await repoUrlCheck({ client, project, repoUrl: detectRepoUrl({}), detected: detectProject({ flag: project, env: process.env.PRAX_PROJECT }) });
    if (drift) report = { ...report, checks: [...(report.checks || []), drift], status: drift.level === 'warn' ? 'warn' : report.status };
    out(flags.json ? report : formatDoctor(report, { base: client.base }));
    process.exitCode = doctorExitCode(report);
    return;
  }

  if (command === 'telemetry') {
    const sub = positionals[1] || 'status';
    if (sub === 'status') {
      const stats = await client.telemetryStatus();
      out(flags.json ? stats : formatTelemetryStatus(stats));
      return;
    }
    if (sub === 'clear') {
      const result = await client.clearTelemetry();
      out(flags.json ? result : `Cleared ${result.cleared.queries} recorded queries and ${result.cleared.uses} used signals at ${client.base}.`);
      return;
    }
    throw new CliUsageError(`Unknown telemetry subcommand: ${sub}\nUsage: ${COMMANDS.telemetry.usage}`);
  }

  throw new Error(`Unknown command: ${command}\n\n${HELP}`);
}

// harvest settles its own exit (a budget may leave a request in flight), and a
// harvest hook never fails the agent that ran it, not even on a usage error.
const argv = process.argv.slice(2);
const harvestHook = argv[0] === 'harvest' && argv.some((a) => a === '--hook' || a.startsWith('--hook='));
main(argv).then((code) => {
  if (typeof code === 'number') process.exit(code);
}).catch((err) => {
  if (harvestHook) process.exit(0);
  process.stderr.write(`prax: ${err.message}\n`);
  process.exit(Number.isInteger(err?.exitCode) ? err.exitCode : 1);
});
