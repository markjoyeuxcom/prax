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
import { createRepoReader, headSha } from './lib/repoFiles.js';
import { resolveCitation } from './lib/codeRefs.js';
import { parseArgs, repeatedValues } from './lib/cliArgs.js';
import {
  buildTaskRecord, buildTaskPatch, createTask, updateTask, completeTask, setChecklistItem,
  formatTask, formatTaskList, isTaskId, TASK_PRIORITIES, TASK_STATUSES,
} from './lib/tasks.js';

// Flags that accumulate when repeated (`--check a --check b`); everything
// else is last-wins. See cli/lib/cliArgs.js for the `--flag=value` form.
const REPEATABLE_FLAGS = ['check'];

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
  prax remember <title> [--body <text>] [--memory] [--type note|runbook|decision|known-issue|reference|post-mortem|template] [--tag a,b] [--ref <url>]
  prax verify <id> --as <human-name>
  prax unverify <id>
  prax supersede <oldId> --with <newId>
  prax task add <title> [--priority high|medium|low] [--status planned|in-progress|...] [--due YYYY-MM-DD] [--planned YYYY-MM-DD] [--label a,b] [--description <text>] [--notes <text>] [--check <item>]...
  prax task list [--status <status>] [--all-projects] [--query <text>] [--json]
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
  const { positionals, flags } = parseArgs(argv, { repeatable: REPEATABLE_FLAGS });
  const command = positionals[0];
  const agent = flags.agent === undefined || flags.agent === true ? undefined : String(flags.agent);
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
    const pack = await client.contextPack(project, { query, format, limit: flags.limit });
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
    const project = flags.project;
    const recent = flags.recent !== undefined && flags.recent !== false;
    let limit = flags.limit ? Number(flags.limit) : 5;
    if (recent && typeof flags.recent === 'string') {
      const n = Number(flags.recent);
      if (Number.isFinite(n) && n > 0) limit = n;
    }
    const query = positionals.slice(1).join(' ');
    if (!recent && !query) throw new Error('recall requires a query (or use --recent).');
    const result = await recall(client, { query, project, limit, recent, readFile: createRepoReader() });
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
    const body = flags.body !== undefined && flags.body !== true ? String(flags.body) : '';
    // undefined = --type not given (create defaults to note; update keeps the
    // stored type). A given value is validated against the shared registry.
    const type = flags.type === undefined || flags.type === true ? undefined : String(flags.type);
    if (type !== undefined && !isDocumentType(type)) {
      throw new Error(`Unknown --type "${type}". Types: ${DOCUMENT_TYPE_VALUES.join(', ')}.`);
    }
    const project = flags.memory ? 'memory' : (await resolveProjectName(flags, client)).project;
    const userTags = flags.tag ? String(flags.tag).split(',').map((t) => t.trim()).filter(Boolean) : [];
    const tags = [...userTags, ...(flags.memory ? ['memory'] : [])];
    // --id targets one document wherever it lives; --memory without --project
    // refines a same-title document in its own project instead of duplicating
    // it into memory (the project-scoped `prax remember` is left alone: there
    // the project was chosen, by flag or by the checkout).
    const id = flags.id !== undefined && flags.id !== true ? String(flags.id) : undefined;
    if (id !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error(`--id must be a document uuid (got "${id}").`);
    }
    const crossProject = Boolean(flags.memory) && !flags.project && !id;
    // A --memory write is agent memory, so it carries the same provenance the
    // prax-remember skill stamps (kind: synthesized). A project-scoped write is
    // left alone: it is a note about this project, not synthesized memory.
    const kind = flags.memory ? 'synthesized' : undefined;
    const result = await remember(client, { title, body, project, type, tags, kind, id, crossProject });
    const { doc, action } = result;
    // Optional --ref <url> attaches an external reference to the memory. Best-
    // effort: a bad URL doesn't fail the remember (the doc is already saved).
    if (flags.ref && flags.ref !== true) {
      try { await client.addExternalRef(doc.id, { url: String(flags.ref) }); }
      catch (err) { process.stderr.write(`prax: could not attach --ref: ${err.message}\n`); }
    }
    // Optional --cite <path[:start[-end]]> pins the code this memory makes a
    // claim about, so a later recall can say the claim's ground has moved.
    // Best-effort for the same reason as --ref: the memory is already saved.
    if (flags.cite && flags.cite !== true) {
      try {
        const read = createRepoReader();
        if (!read) throw new Error('not inside a git repository');
        const citation = resolveCitation(String(flags.cite), { readFile: read, headSha: headSha() });
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
    const actor = flags.as === undefined || flags.as === true ? '' : String(flags.as).trim();
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
    const newId = flags.with;
    if (!oldId || !newId || newId === true) throw new Error('supersede requires <oldId> --with <newId>.');
    const doc = await client.supersede(oldId, String(newId));
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
      const status = flags.status === undefined || flags.status === true ? undefined : String(flags.status);
      if (status !== undefined && !TASK_STATUSES.includes(status)) {
        throw new Error(`Unknown --status "${status}". Values: ${TASK_STATUSES.join(', ')}.`);
      }
      const q = flags.query === undefined || flags.query === true ? undefined : String(flags.query);
      const allProjects = Boolean(flags['all-projects']);
      const project = allProjects ? undefined : (await resolveProjectName(flags, client)).project;
      const tasks = await client.listTasks({ project, status, q });
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
      const addition = flags['append-notes'] === undefined || flags['append-notes'] === true ? undefined : String(flags['append-notes']);
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
