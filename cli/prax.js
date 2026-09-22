#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { detectProject, detectRepoUrl } from './lib/detectProject.js';
import { matchProjectByRepoUrl, normalizeRepoUrl } from '../server/repoUrl.js';
import { DOCUMENT_TYPE_VALUES, isDocumentType } from '../public/js/documentTypes.js';
import { createClient } from './lib/apiClient.js';
import { formatSearchResults, formatDocument } from './lib/format.js';
import { recall, formatRecall } from './lib/recall.js';
import { remember } from './lib/remember.js';
import { confirmDocumentVerification } from './lib/verify.js';
import { searchLibrary, describeRetrieval } from './lib/search.js';
import { createCheckout, createRepoReader, headSha } from './lib/repoFiles.js';
import { resolveCitation } from './lib/codeRefs.js';
import {
  CliUsageError, checkCommandArgs, flagValue, parseArgs, positiveIntFlag, repeatedValues,
} from './lib/cliArgs.js';
import { sanitizeAgentId } from './lib/apiClient.js';
import {
  buildTaskRecord, buildTaskPatch, createTask, updateTask, completeTask, setChecklistItem,
  formatTask, formatTaskList, isTaskId, selectListedTasks, TASK_PRIORITIES, TASK_STATUSES,
} from './lib/tasks.js';

// The declared flag grammar (cli/lib/cliArgs.js). Every flag any command
// takes is named here with its kind, so an unknown or mistyped flag is refused
// instead of stored and ignored, and a boolean flag never swallows the next
// word (`search --json postgres backup` searches for both words). Flags that
// accumulate when repeated (`--check a --check b`) are `repeatable`; every
// other flag is last-wins.
const REPEATABLE_FLAGS = ['check'];
const BOOLEAN_FLAGS = ['json', 'help', 'all', 'all-projects', 'memory'];
// `--recent` takes a count only when the next word is one.
const OPTIONAL_FLAGS = { recent: (next) => /^\d+$/.test(next) };
const VALUE_FLAGS = [
  'project', 'url', 'agent', 'limit', 'body', 'type', 'tag', 'ref', 'cite', 'id', 'as', 'with',
  'priority', 'status', 'due', 'planned', 'label', 'description', 'notes', 'query', 'title', 'append-notes',
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
  context: { flags: ['limit'], usage: 'prax context [query...] [--json] [--limit <n>]' },
  search: { flags: ['all'], usage: 'prax search <query> [--all] [--json]' },
  recall: { flags: ['limit', 'recent'], usage: 'prax recall [query...] [--project <slug>] [--limit <n>] [--recent [n]] [--json]' },
  get: { flags: [], max: 1, usage: 'prax get <id> [--json]' },
  remember: {
    flags: ['body', 'memory', 'type', 'tag', 'ref', 'cite', 'id'],
    max: 1,
    usage: 'prax remember "<title>" --body <text> [--memory] [--type <type>] [--tag a,b] [--ref <url>] [--cite <path[:start[-end]]>] [--id <uuid>]',
  },
  verify: { flags: ['as'], max: 1, usage: 'prax verify <id> --as <human-name>' },
  unverify: { flags: [], max: 1, usage: 'prax unverify <id>' },
  supersede: { flags: ['with'], max: 1, usage: 'prax supersede <oldId> --with <newId>' },
  task: { flags: [], max: Infinity, usage: 'prax task <add|list|show|update|done|check|uncheck> …' },
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
      repeatable: REPEATABLE_FLAGS,
      boolean: BOOLEAN_FLAGS,
      optional: OPTIONAL_FLAGS,
      known: VALUE_FLAGS,
      aliases: FLAG_ALIASES,
    });
  } catch (err) {
    if (err instanceof CliUsageError) err.message = `${err.message}\n${usageFor(argv)}`;
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
  checkCommandArgs(command, { flags, positionals: positionals.slice(1) }, {
    allowed: [...GLOBAL_FLAGS, ...spec.flags], max: spec.max, usage: spec.usage,
  });
  return parsed;
}

async function resolveProjectName(flags, client) {
  // MOOMORA_PROJECT is the pre-rename env var; still honoured so existing setups keep working.
  const detected = detectProject({ flag: flags.project, env: process.env.PRAX_PROJECT || process.env.MOOMORA_PROJECT });
  // Explicit intent (flag/env/.prax marker) always wins. Only the folder-name
  // GUESS is upgraded by a git-remote match: if the repo's origin URL matches a
  // project's registered repoUrl, that project wins over the folder name — so
  // recall/remember land in the right project from any checkout or worktree.
  if (detected.source === 'folder' || detected.source === 'none') {
    const repoUrl = detectRepoUrl({});
    if (repoUrl && client) {
      try {
        const match = matchProjectByRepoUrl(await client.listProjects(), repoUrl);
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
  return detected;
}

const HELP = `prax — shared project memory CLI

Usage:
  prax init [--project <slug>]
  prax context [query...] [--json] [--limit <n>]
  prax search <query> [--all] [--json]
  prax recall [query...] [--project <slug>] [--limit <n>] [--recent [n]] [--json]
  prax get <id> [--json]
  prax remember "<title>" --body <text> [--memory] [--type note|runbook|decision|known-issue|reference|post-mortem|template] [--tag a,b] [--ref <url>] [--cite <path[:start[-end]]>] [--id <uuid>]
  prax verify <id> --as <human-name>
  prax unverify <id>
  prax supersede <oldId> --with <newId>
  prax task add <title> [--priority high|medium|low] [--status planned|in-progress|...] [--due YYYY-MM-DD] [--planned YYYY-MM-DD] [--label a,b] [--description <text>] [--notes <text>] [--check <item>]...
  prax task list [--status <status>] [--all] [--all-projects] [--query <text>] [--json]
  prax task show <id> [--json]
  prax task update <id> [--title <t>] [--status <s>] [--priority <p>] [--due <d>] [--planned <d>] [--label a,b] [--description <text>] [--notes <text> | --append-notes <text>]
  prax task done <id>
  prax task check <id> <n|label>      prax task uncheck <id> <n|label>

Global flags: --project <slug>  --url <baseUrl>  --agent <id>  --json
Env: PRAX_API_URL  PRAX_PROJECT  PRAX_TOKEN  PRAX_AGENT
App discovery: --url > PRAX_API_URL > the desktop app's saved port (webview-port) > http://127.0.0.1:3000
Project detection: --project > PRAX_PROJECT > .prax/project.json > git remote match > folder name
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
  const client = createClient({ baseUrl: flags.url, token: process.env.PRAX_TOKEN, agent });
  const out = (text) => process.stdout.write(`${typeof text === 'string' ? text : JSON.stringify(text, null, 2)}\n`);

  if (!command || command === 'help' || flags.help) { out(HELP); return; }

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

  if (command === 'context') {
    const { project } = await resolveProjectName(flags, client);
    const query = positionals.slice(1).join(' ');
    const format = flags.json ? 'json' : 'md';
    const limit = positiveIntFlag(flags, 'limit');
    const pack = await client.contextPack(project, { query, format, limit });
    out(pack);
    return;
  }

  if (command === 'search') {
    const { project } = await resolveProjectName(flags, client);
    const query = positionals.slice(1).join(' ');
    if (!query) throw new Error('search requires a query.');
    const envelope = await searchLibrary(client, {
      project, query, all: Boolean(flags.all),
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
    const limit = recentCount ?? limitFlag ?? 5;
    const query = positionals.slice(1).join(' ');
    if (!recent && !query) throw new CliUsageError('recall requires a query (or use --recent).');
    // --recent is a chronological list; a query would be silently ignored.
    if (recent && query) throw new CliUsageError(`recall --recent lists the newest documents and takes no query (got "${query}").`);
    const result = await recall(client, { query, project, limit, recent, checkout: createCheckout() });
    out(flags.json ? result : formatRecall(result));
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
    const project = flags.memory ? 'memory' : (await resolveProjectName(flags, client)).project;
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
    const where = result.project && result.project !== project ? ` in ${result.project}` : '';
    out(flags.json ? doc : `${action === 'updated' ? 'Updated' : 'Remembered'} "${doc.title}" (${doc.id})${where} — unverified, at ${client.base}.`);
    return;
  }

  if (command === 'verify') {
    const id = positionals[1];
    if (!id) throw new Error('verify requires a document id.');
    if (flags.json) throw new Error('verify is interactive and does not support --json.');
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

  if (command === 'task') {
    const sub = positionals[1];
    const TASK_HELP = 'task subcommands: add, list, show, update, done, check, uncheck';
    if (!sub || sub === 'help') { out(TASK_HELP); return; }

    if (sub === 'add') {
      const title = positionals.slice(2).join(' ');
      const checks = repeatedValues(flags, 'check');
      const record = buildTaskRecord({ title, flags, checks });
      const { project } = await resolveProjectName(flags, client);
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

  throw new Error(`Unknown command: ${command}\n\n${HELP}`);
}

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`prax: ${err.message}\n`);
  process.exit(1);
});
