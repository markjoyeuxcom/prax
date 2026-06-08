#!/usr/bin/env node
// moomora-recall — thin wrapper over the shared cli/lib recall operation, so the
// skill and the `moomora` CLI share one code path. Zero-install: imports the repo's
// own lib by relative path; no global `moomora` needed.
import { createClient } from '../../../cli/lib/apiClient.js';
import { recall, formatRecall } from '../../../cli/lib/recall.js';

function parseArgs(argv) {
  const out = { query: '', project: '', limit: 5, recent: false };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--project') { out.project = argv[++i] || ''; }
    else if (a === '--limit') { const n = Number(argv[++i]); out.limit = Number.isFinite(n) && n > 0 ? n : 5; }
    else if (a === '--recent') {
      out.recent = true;
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) { out.limit = n; i += 1; }
    } else rest.push(a);
  }
  out.query = rest.join(' ').trim();
  return out;
}

async function main() {
  const { query, project, limit, recent } = parseArgs(process.argv.slice(2));
  if (!recent && !query) {
    console.error('Usage: node recall.mjs "<query>" [--project <slug>] [--limit <n>]  |  node recall.mjs --recent [n] [--project <slug>]');
    process.exit(1);
  }
  const result = await recall(createClient(), { query, project, limit, recent });
  console.log(formatRecall(result));
}

main().catch((err) => { console.error(err.message); process.exit(1); });
