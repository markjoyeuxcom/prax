import { createDb } from '../../server/db.js';
import { runMigrations } from '../../server/migrate.js';
import { createLibraryRepository } from '../../server/libraryRepository.js';
import { buildContextPack } from '../../server/contextPack.js';
import { createDocumentCodeRefsRepository } from '../../server/documentCodeRefsRepository.js';
import { createDocumentLinksRepository } from '../../server/documentLinksRepository.js';
import { createMemoryChangesRepository } from '../../server/memoryChangesRepository.js';
import { resolveCitation } from '../../cli/lib/codeRefs.js';
import { fillOrder } from '../../cli/lib/budget.js';
import { budgetedContext, planContext } from '../../cli/lib/context.js';

const SILENT = { info() {}, error() {}, warn() {}, debug() {} };

// Seed the fixture docs into a fresh in-memory DB (real schema + FTS triggers)
// and return the repository plus an id→key map for scoring.
export async function seedFixtures(docs) {
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT });
  const projectId = (await db.query('select id from projects limit 1')).rows[0].id;
  const repo = createLibraryRepository(db);
  const keyById = new Map();
  for (const d of docs) {
    const created = await repo.createDocument({
      title: d.title,
      body: d.body,
      documentType: d.documentType,
      projectId,
      tags: d.tags || [],
      kind: 'source',
      // verified is derived from updatedBy (agent → unverified) in the repo.
      updatedBy: d.verified === false ? 'agent' : 'user',
    });
    keyById.set(created.id, d.key);
  }
  return { db, repo, projectId, keyById };
}

// Run one case through the keyword retrieval + context pack — the same path Ask
// Prax uses when semantic search is off — and score recall/precision against the
// expected keys. `retrieved` is the set of doc keys that made it into the pack.
export async function evalCase(repo, keyById, testCase) {
  const docs = await repo.listDocuments({ q: testCase.query, status: 'active' });
  const pack = buildContextPack(docs, { query: testCase.query, limit: 20 });
  const retrieved = new Set(
    pack.sections.flatMap((s) => s.items.map((it) => keyById.get(it.id))).filter(Boolean),
  );
  const expect = testCase.expect || [];
  const notExpect = testCase.notExpect || [];
  const hits = expect.filter((k) => retrieved.has(k));
  const missing = expect.filter((k) => !retrieved.has(k));
  const unexpected = notExpect.filter((k) => retrieved.has(k));
  return {
    name: testCase.name,
    query: testCase.query,
    retrieved: [...retrieved],
    hits, missing, unexpected,
    pass: missing.length === 0 && unexpected.length === 0,
  };
}

// Run all cases; return per-case results + aggregate recall (hits / expected)
// and the count of clean passes.
export async function runRetrievalEval(docs, cases) {
  const { db, repo, keyById } = await seedFixtures(docs);
  try {
    const results = [];
    for (const c of cases) results.push(await evalCase(repo, keyById, c));
    const totalExpect = results.reduce((n, r, i) => n + (cases[i].expect?.length || 0), 0);
    const totalHits = results.reduce((n, r) => n + r.hits.length, 0);
    return {
      results,
      recall: totalExpect ? totalHits / totalExpect : 1,
      passed: results.filter((r) => r.pass).length,
      total: results.length,
    };
  } finally {
    await db.close();
  }
}

// ---- Budgeted context and the since-last-session delta -------------------
// Keyword mode (no embedder): the fixture memory is found through FTS, filled
// by the code behind `prax context --budget` (cli/lib/context.js, shared fill
// order in cli/lib/budget.js), and the delta runs through the real changes
// repository and the CLI's fill order.

// Seed MEMORY_DOCS with pinned timestamps and their code citations; return
// the repositories, an id↔key map, and the fake checkout holding `current`.
export async function seedMemoryFixtures(docs, { t0 = null } = {}) {
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT });
  const projectId = (await db.query("select id from projects where slug = 'homelab'")).rows[0].id;
  const repo = createLibraryRepository(db);
  const codeRefs = createDocumentCodeRefsRepository(db);
  const keyById = new Map();
  const idByKey = new Map();
  const files = new Map();
  for (const d of docs) {
    const created = await repo.createDocument({
      title: d.title, body: d.body, documentType: d.documentType || 'note', projectId, tags: [], kind: 'source',
      updatedBy: d.verified === false ? 'agent' : 'user',
    });
    const stamp = t0 || d.updatedAt;
    await db.query('update markdown_documents set created_at = $2, updated_at = $2, verified_at = case when verified = 1 then $2 end where id = $1', [created.id, stamp]);
    keyById.set(created.id, d.key);
    idByKey.set(d.key, created.id);
    if (d.cite) {
      const citation = resolveCitation(`${d.cite.path}:1-1`, { readFile: () => d.cite.pinned });
      await codeRefs.addCodeRef(created.id, citation);
      files.set(d.cite.path, d.cite.current);
    }
  }
  const checkout = { readFile: (path) => (files.has(path) ? files.get(path) : null) };
  // The slice of the API client the fill needs, answered by the repositories.
  const client = {
    listCodeRefs: (id) => codeRefs.listCodeRefs(id),
    listProjects: async () => [],
    contextPack: async (_project, { query, limit }) => buildContextPack(
      await repo.listDocuments({ q: query, status: 'active' }), { query, limit },
    ),
  };
  return { db, repo, projectId, keyById, idByKey, checkout, client };
}

const ENTRY_LINE = /^(### |- )/;
const CHIP_LINE = /^(### |- )\[(verified|unverified|superseded|deprecated|archived)\] /;

export async function evalBudgetCase(seeded, testCase) {
  const { client, checkout, keyById } = seeded;
  const result = await budgetedContext(client, { project: 'homelab', query: testCase.query, budget: testCase.budget, checkout });
  const { text, summary } = planContext(result);
  const order = summary.entries.map((e) => keyById.get(e.id));
  const forms = Object.fromEntries(summary.entries.map((e) => [keyById.get(e.id), e.form]));
  const problems = [];
  if (testCase.expectOrder && JSON.stringify(order) !== JSON.stringify(testCase.expectOrder)) {
    problems.push(`order ${order.join(' > ')} (expected ${testCase.expectOrder.join(' > ')})`);
  }
  for (const [key, form] of Object.entries(testCase.expectForms || {})) {
    if (forms[key] !== form) problems.push(`${key} printed ${forms[key]} (expected ${form})`);
  }
  if (testCase.expectCompacted && !Object.values(forms).includes('compact')) problems.push('nothing was compacted');
  const unlabelled = text.split('\n').filter((line) => ENTRY_LINE.test(line) && !CHIP_LINE.test(line));
  if (unlabelled.length) problems.push(`entry lines without a trust chip: ${unlabelled.join(' | ')}`);
  if (summary.omitted.total > 0 && summary.used > testCase.budget) problems.push(`used ${summary.used} of ${testCase.budget}`);
  return {
    name: testCase.name, query: testCase.query, budget: testCase.budget, order, forms, used: summary.used, problems, pass: problems.length === 0,
  };
}

export async function runBudgetEval(docs, cases) {
  const seeded = await seedMemoryFixtures(docs);
  try {
    const results = [];
    for (const c of cases) results.push(await evalBudgetCase(seeded, c));
    return { results, passed: results.filter((r) => r.pass).length, total: results.length };
  } finally {
    await seeded.db.close();
  }
}

// Seed at T0, apply the events (each at its own pinned time), then run every
// delta case through the changes repository and the CLI's fill order.
export async function runDeltaEval(docs, events, cases, { t0 }) {
  const seeded = await seedMemoryFixtures(docs, { t0 });
  const {
    db, repo, projectId, keyById, idByKey,
  } = seeded;
  const links = createDocumentLinksRepository(db);
  try {
    for (const event of events) {
      if (event.create) {
        const d = event.create;
        const created = await repo.createDocument({
          title: d.title, body: d.body, documentType: 'note', projectId, tags: [], kind: 'source', updatedBy: d.verified === false ? 'agent' : 'user',
        });
        await db.query('update markdown_documents set created_at = $2, updated_at = $2 where id = $1', [created.id, event.at]);
        keyById.set(created.id, d.key);
        idByKey.set(d.key, created.id);
      } else if (event.update) {
        const id = idByKey.get(event.update);
        await repo.updateDocument(id, { body: event.body }, { updatedBy: 'agent' });
        await db.query('update markdown_documents set updated_at = $2 where id = $1', [id, event.at]);
      } else if (event.verify) {
        const id = idByKey.get(event.verify);
        await db.query("update markdown_documents set verified = 1, verified_by = 'mark', verified_at = $2 where id = $1", [id, event.at]);
      } else if (event.supersede) {
        const id = idByKey.get(event.supersede);
        await links.linkDocuments(idByKey.get(event.by), id, 'supersedes');
        await db.query('update markdown_documents set updated_at = $2 where id = $1', [id, event.at]);
      }
    }
    const changes = createMemoryChangesRepository(db);
    const results = [];
    for (const c of cases) {
      const page = await changes.listChanges({ since: c.since });
      const byKey = Object.fromEntries(page.items.map((item) => [keyById.get(item.id), item.changes]));
      const newestFirst = page.items.slice().sort((a, b) => String(b.changedAt).localeCompare(String(a.changedAt)));
      const ordered = fillOrder(newestFirst, { recencyOf: (item) => item.changedAt }).map((item) => keyById.get(item.id));
      const problems = [];
      for (const [key, kinds] of Object.entries(c.expect || {})) {
        if (!byKey[key]) problems.push(`MISSING ${key}`);
        else if (JSON.stringify(byKey[key]) !== JSON.stringify(kinds)) problems.push(`${key} changed ${byKey[key].join(',')} (expected ${kinds.join(',')})`);
      }
      for (const key of c.notExpect || []) if (byKey[key]) problems.push(`UNEXPECTED ${key}`);
      if (c.expectFirst && ordered[0] !== c.expectFirst) problems.push(`first ${ordered[0]} (expected ${c.expectFirst})`);
      results.push({
        name: c.name, since: c.since, retrieved: Object.keys(byKey), ordered, problems, pass: problems.length === 0,
      });
    }
    return { results, passed: results.filter((r) => r.pass).length, total: results.length };
  } finally {
    await db.close();
  }
}
