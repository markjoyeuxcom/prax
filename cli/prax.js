#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { detectProject } from './lib/detectProject.js';
import { createClient } from './lib/apiClient.js';
import { formatSearchResults, formatDocument } from './lib/format.js';
import { recall, formatRecall } from './lib/recall.js';
import { remember } from './lib/remember.js';

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

function resolveProjectName(flags) {
  // MOOMORA_PROJECT is the pre-rename env var; still honoured so existing setups keep working.
  const { project, source } = detectProject({ flag: flags.project, env: process.env.PRAX_PROJECT || process.env.MOOMORA_PROJECT });
  if (!project) {
    throw new Error('No project detected. Pass --project <slug>, set PRAX_PROJECT, or run `prax init`.');
  }
  return { project, source };
}

const HELP = `prax — shared project memory CLI

Usage:
  prax init [--project <slug>]
  prax context [query...] [--json] [--limit <n>]
  prax search <query> [--all] [--json]
  prax recall [query...] [--project <slug>] [--limit <n>] [--recent [n]] [--json]
  prax get <id> [--json]
  prax remember <title> [--body <text>] [--memory] [--type runbook|note] [--tag a,b]
  prax verify <id> [--as <name>]
  prax unverify <id>
  prax supersede <oldId> --with <newId>

Global flags: --project <slug>  --url <baseUrl>  --json
Env: PRAX_API_URL  PRAX_PROJECT  PRAX_TOKEN`;

async function main(argv) {
  const { positionals, flags } = parseArgs(argv);
  const command = positionals[0];
  const client = createClient({ baseUrl: flags.url, token: process.env.PRAX_TOKEN });
  const out = (text) => process.stdout.write(`${typeof text === 'string' ? text : JSON.stringify(text, null, 2)}\n`);

  if (!command || command === 'help' || flags.help) { out(HELP); return; }

  if (command === 'init') {
    const project = flags.project || detectProject({}).project;
    if (!project) throw new Error('Cannot infer a project name; pass --project <slug>.');
    mkdirSync('.prax', { recursive: true });
    writeFileSync(join('.prax', 'project.json'), `${JSON.stringify({ project }, null, 2)}\n`);
    out(`Wrote .prax/project.json (project: ${project}).`);
    return;
  }

  if (command === 'context') {
    const { project } = resolveProjectName(flags);
    const query = positionals.slice(1).join(' ');
    const format = flags.json ? 'json' : 'md';
    const pack = await client.contextPack(project, { query, format, limit: flags.limit });
    out(pack);
    return;
  }

  if (command === 'search') {
    const { project } = resolveProjectName(flags);
    const query = positionals.slice(1).join(' ');
    if (!query) throw new Error('search requires a query.');
    let results;
    try {
      results = await client.semanticSearch(project, query, { all: Boolean(flags.all) });
    } catch {
      results = await client.keywordSearch(project, query, { all: Boolean(flags.all) });
    }
    out(flags.json ? results : formatSearchResults(results));
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
    const result = await recall(client, { query, project, limit, recent });
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
    const type = flags.type === 'runbook' ? 'runbook' : 'note';
    const project = flags.memory ? 'memory' : resolveProjectName(flags).project;
    const userTags = flags.tag ? String(flags.tag).split(',').map((t) => t.trim()).filter(Boolean) : [];
    const tags = [...userTags, ...(flags.memory ? ['memory'] : [])];
    const { doc, action } = await remember(client, { title, body, project, type, tags });
    out(flags.json ? doc : `${action === 'updated' ? 'Updated' : 'Remembered'} "${doc.title}" (${doc.id}) — unverified.`);
    return;
  }

  if (command === 'verify' || command === 'unverify') {
    const id = positionals[1];
    if (!id) throw new Error(`${command} requires a document id.`);
    const doc = await client.verify(id, { verified: command === 'verify', as: flags.as || 'cli' });
    out(flags.json ? doc : `${command === 'verify' ? 'Verified' : 'Unverified'} ${id}.`);
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

  throw new Error(`Unknown command: ${command}\n\n${HELP}`);
}

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`prax: ${err.message}\n`);
  process.exit(1);
});
