#!/usr/bin/env node
// prax-remember — thin wrapper over the shared cli/lib remember operation. Writes
// agent memory (synthesized, memory-tagged) to the `memory` project by default.
// Zero-install: imports the repo's own lib by relative path; no global `prax`.
import { createClient } from '../../../cli/lib/apiClient.js';
import { remember } from '../../../cli/lib/remember.js';

function parseArgs(argv) {
  const out = { tags: [], type: 'note', project: 'memory' };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--tags') { out.tags = String(argv[++i] || '').split(',').map((t) => t.trim()).filter(Boolean); }
    else if (a === '--type') { out.type = argv[++i] || 'note'; }
    else if (a === '--project') { out.project = argv[++i] || 'memory'; }
    else rest.push(a);
  }
  out.title = (rest[0] || '').trim();
  out.body = (rest[1] || '').trim();
  return out;
}

async function main() {
  const { title, body, tags, type, project } = parseArgs(process.argv.slice(2));
  if (!title || !body) {
    console.error('Usage: node remember.mjs "<title>" "<body>" [--tags a,b] [--type note|runbook] [--project <slug>]');
    process.exit(1);
  }
  const { doc, action } = await remember(createClient(), {
    title, body, project, type, tags: ['memory', ...tags], kind: 'synthesized',
  });
  console.log(`Remembered "${title}" → ${doc.id} (${action})`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
