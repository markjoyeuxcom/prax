#!/usr/bin/env node
// moomora-remember — persist a durable finding/decision/procedure into Moomora
// memory so future sessions can recall it. Writes to a dedicated `memory`
// project (created on first use), de-duplicates by exact title (updates in
// place rather than creating a second copy), and stamps agent provenance.
// Zero dependencies (Node 20+ fetch).
//
// Usage: node remember.mjs "<title>" "<body>" [--tags a,b] [--type note|runbook] [--project <slug>]
//   MOOMORA_API_URL  base URL of the running app (default http://127.0.0.1:3000)

const BASE = (process.env.MOOMORA_API_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const AGENT_HEADERS = { 'content-type': 'application/json', 'x-moomora-origin': 'agent' };
const DOC_TYPES = new Set(['note', 'runbook']);

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

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: AGENT_HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    fail(`Moomora not reachable at ${BASE} — is the app running? (${err.message})`);
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j && j.message) detail = j.message; } catch { /* ignore */ }
    fail(`${method} ${path} failed: ${detail}`);
  }
  return res.status === 204 ? null : res.json();
}

// Resolve the target project's slug, creating it on first use.
async function ensureProjectSlug(target) {
  const projects = await request('GET', '/api/projects');
  const match = (Array.isArray(projects) ? projects : []).find(
    (p) => p.slug === target || (p.name && p.name.toLowerCase() === target.toLowerCase()),
  );
  if (match) return match.slug;
  const created = await request('POST', '/api/projects', { name: target });
  return created.slug;
}

async function main() {
  const { title, body, tags, type, project } = parseArgs(process.argv.slice(2));
  if (!title || !body) {
    fail('Usage: node remember.mjs "<title>" "<body>" [--tags a,b] [--type note|runbook] [--project <slug>]');
  }
  const documentType = DOC_TYPES.has(type) ? type : 'note';
  const allTags = Array.from(new Set(['memory', ...tags]));

  const slug = await ensureProjectSlug(project);

  // De-dup by exact title within the project: update in place if it exists.
  const existing = await request('GET', `/api/library/documents?project=${encodeURIComponent(slug)}`);
  const dup = (Array.isArray(existing) ? existing : []).find((d) => d.title === title);

  if (dup) {
    const updated = await request('PATCH', `/api/library/documents/${dup.id}`, { body, tags: allTags });
    console.log(`Remembered "${title}" → ${updated.id} (updated)`);
    return;
  }

  const created = await request('POST', '/api/library/documents', {
    title,
    body,
    documentType,
    project: slug,
    tags: allTags,
    kind: 'synthesized',
  });
  console.log(`Remembered "${title}" → ${created.id} (created)`);
}

main();
