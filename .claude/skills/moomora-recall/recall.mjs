#!/usr/bin/env node
// moomora-recall — pull relevant prior context from Moomora memory by MEANING,
// returning a distilled summary instead of raw refs. Bulk data (the ranked ref
// list + the full document) is processed here in the script; only a compact
// block is printed for the agent to read. Zero dependencies (Node 20+ fetch).
//
// Usage: node recall.mjs "<query>" [--project <slug>] [--limit <n>]
//   MOOMORA_API_URL  base URL of the running app (default http://127.0.0.1:3000)

const BASE = (process.env.MOOMORA_API_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const BODY_CHARS = 800;
const RELATED_MAX = 5;

function parseArgs(argv) {
  const out = { query: '', project: '', limit: 5 };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--project') { out.project = argv[++i] || ''; }
    else if (a === '--limit') { out.limit = Number(argv[++i]) || 5; }
    else rest.push(a);
  }
  out.query = rest.join(' ').trim();
  return out;
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

async function getJson(path) {
  let res;
  try {
    res = await fetch(BASE + path);
  } catch (err) {
    fail(`Moomora not reachable at ${BASE} — is the app running? (${err.message})`);
  }
  return res;
}

function trimBody(body) {
  const text = String(body || '').trim();
  if (text.length <= BODY_CHARS) return text;
  return `${text.slice(0, BODY_CHARS).trimEnd()}…`;
}

function printResult({ top, related, note }) {
  const lines = [];
  if (note) lines.push(`(${note})`);
  lines.push(`## ${top.title || 'Untitled'}  (${top.documentType || 'note'} · ${top.id})`);
  lines.push('');
  lines.push(trimBody(top.body));
  if (related.length) {
    lines.push('');
    lines.push('Related:');
    for (const r of related.slice(0, RELATED_MAX)) {
      lines.push(`- ${r.title || 'Untitled'} — ${r.id}`);
    }
  }
  console.log(lines.join('\n'));
}

async function main() {
  const { query, project, limit } = parseArgs(process.argv.slice(2));
  if (!query) fail('Usage: node recall.mjs "<query>" [--project <slug>] [--limit <n>]');

  const scope = project && project !== 'all' ? `&project=${encodeURIComponent(project)}` : '';

  // Primary path: semantic search (already relevance-cutoff filtered server-side).
  const semRes = await getJson(`/api/library/documents/semantic-search?q=${encodeURIComponent(query)}${scope}`);

  if (semRes.ok) {
    const refs = await semRes.json();
    if (!Array.isArray(refs) || refs.length === 0) {
      console.log(`No relevant memory found for: "${query}"`);
      return;
    }
    const kept = refs.slice(0, limit);
    // Refs are bodyless — fetch the top hit's full record for the summary body.
    const topRes = await getJson(`/api/library/documents/${kept[0].id}`);
    const topDoc = topRes.ok ? await topRes.json() : kept[0];
    printResult({ top: { ...kept[0], body: topDoc.body }, related: kept.slice(1) });
    return;
  }

  if (semRes.status === 409) {
    // Semantic search disabled/unconfigured — fall back to keyword (full docs).
    const kwRes = await getJson(`/api/library/documents?q=${encodeURIComponent(query)}${scope}`);
    if (!kwRes.ok) fail(`Keyword search failed (HTTP ${kwRes.status}).`);
    const docs = await kwRes.json();
    if (!Array.isArray(docs) || docs.length === 0) {
      console.log(`No relevant memory found for: "${query}" (keyword; semantic search is disabled)`);
      return;
    }
    const kept = docs.slice(0, limit);
    printResult({ top: kept[0], related: kept.slice(1), note: 'semantic search disabled — keyword results' });
    return;
  }

  fail(`Semantic search failed (HTTP ${semRes.status}).`);
}

main();
