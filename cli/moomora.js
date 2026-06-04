#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { detectProject } from './lib/detectProject.js';
import { createClient } from './lib/apiClient.js';
import { formatSearchResults, formatDocument } from './lib/format.js';

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
  const { project, source } = detectProject({ flag: flags.project, env: process.env.MOOMORA_PROJECT });
  if (!project) {
    throw new Error('No project detected. Pass --project <slug>, set MOOMORA_PROJECT, or run `moomora init`.');
  }
  return { project, source };
}

const HELP = `moomora — shared project memory CLI

Usage:
  moomora init [--project <slug>]
  moomora context [query...] [--json] [--limit <n>]
  moomora search <query> [--all] [--json]
  moomora get <id> [--json]
  moomora remember <title> [--body <text>] [--type runbook|note] [--tag <t>]
  moomora verify <id> [--as <name>]
  moomora unverify <id>
  moomora supersede <oldId> --with <newId>

Global flags: --project <slug>  --url <baseUrl>  --json
Env: MOOMORA_API_URL  MOOMORA_PROJECT  MOOMORA_TOKEN`;

async function main(argv) {
  const { positionals, flags } = parseArgs(argv);
  const command = positionals[0];
  const client = createClient({ baseUrl: flags.url, token: process.env.MOOMORA_TOKEN });
  const out = (text) => process.stdout.write(`${typeof text === 'string' ? text : JSON.stringify(text, null, 2)}\n`);

  if (!command || command === 'help' || flags.help) { out(HELP); return; }

  if (command === 'init') {
    const project = flags.project || detectProject({}).project;
    if (!project) throw new Error('Cannot infer a project name; pass --project <slug>.');
    mkdirSync('.moomora', { recursive: true });
    writeFileSync(join('.moomora', 'project.json'), `${JSON.stringify({ project }, null, 2)}\n`);
    out(`Wrote .moomora/project.json (project: ${project}).`);
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

  if (command === 'get') {
    const id = positionals[1];
    if (!id) throw new Error('get requires a document id.');
    const doc = await client.getDocument(id);
    out(flags.json ? doc : formatDocument(doc));
    return;
  }

  if (command === 'remember') {
    const { project } = resolveProjectName(flags);
    const title = positionals[1];
    if (!title) throw new Error('remember requires a title.');
    const body = flags.body !== undefined && flags.body !== true ? String(flags.body) : '';
    const documentType = flags.type === 'runbook' ? 'runbook' : 'note';
    const tags = flags.tag ? [String(flags.tag)] : [];
    const existing = (await client.findByTitle(project, title)).find((d) => d.title === title);
    const saved = existing
      ? await client.updateMemory(existing.id, { title, body, documentType, tags })
      : await client.createMemory({ title, body, documentType, project, tags });
    out(flags.json ? saved : `${existing ? 'Updated' : 'Remembered'} "${saved.title}" (${saved.id}) — unverified.`);
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
  process.stderr.write(`moomora: ${err.message}\n`);
  process.exit(1);
});
