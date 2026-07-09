import { createDb } from '../../server/db.js';
import { runMigrations } from '../../server/migrate.js';
import { createLibraryRepository } from '../../server/libraryRepository.js';
import { buildContextPack } from '../../server/contextPack.js';

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
