// Librarian clustering at scale (spec 2026-09-23-librarian-design.md): the
// pair finders filter candidates (a rare-shingle inverted index; a
// Cauchy-Schwarz bound on blocks of the cosine), and must find exactly what an
// unfiltered pass finds. The reference implementations below are the
// pre-filtering code, kept here only to hold the new code to their answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clusterPairs, findDuplicatePairs, findEmbeddingPairs, findShinglePairs, jaccard, MAX_CLUSTER_DOCS,
  SHINGLE_MAX_DF, SHINGLE_MIN_JACCARD, EMBEDDING_MIN_SIM, shingleSet,
} from '../../server/librarian.js';
import { cosineSimilarity } from '../../server/libraryRepository.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A synthetic library: topics with shared vocabulary and a shared embedding
// direction (real embeddings sit in a cone, not spread evenly), a common
// footer as boilerplate, and one near-duplicate for every tenth document.
function syntheticLibrary({ count, dim = 768, projects = 1, seed = 7, withoutVectorEvery = 0 }) {
  const random = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(random() || 1e-12)) * Math.cos(2 * Math.PI * random());
  const vocab = Array.from({ length: 4000 }, (_, i) => `w${i.toString(36)}`);
  const common = Array.from({ length: dim }, gauss);
  const topics = Array.from({ length: 40 }, () => ({
    words: Array.from({ length: 300 }, () => vocab[Math.floor(random() * vocab.length)]),
    centre: Array.from({ length: dim }, gauss),
  }));
  const docs = [];
  for (let i = 0; i < count; i += 1) {
    const topic = topics[i % topics.length];
    let body;
    let vector;
    const original = docs[i - 1];
    if (i % 10 === 1 && original) {
      const words = original.body.split(' ');
      words[Math.floor(random() * words.length)] = 'edited';
      body = `${words.join(' ')} plus one more closing sentence`;
      vector = original.vector ? original.vector.map((x) => x + gauss() * 0.02) : null;
    } else {
      body = `${Array.from({ length: 120 }, () => (random() < 0.7
        ? topic.words[Math.floor(random() * topic.words.length)]
        : vocab[Math.floor(random() * vocab.length)])).join(' ')} see the team handbook for the review policy`;
      vector = Array.from({ length: dim }, (_, d) => common[d] * 1.2 + topic.centre[d] * 0.8 + gauss());
    }
    docs.push({
      id: `doc-${String(i).padStart(5, '0')}`,
      projectId: `p${Math.floor(i / 10) % projects}`,
      title: `Note ${i}`,
      body,
      vector: withoutVectorEvery && i % withoutVectorEvery === 3 ? undefined : vector,
    });
  }
  return docs;
}

function byProject(docs) {
  const groups = new Map();
  for (const doc of docs) {
    const key = doc.projectId || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(doc);
  }
  return [...groups.values()];
}

// The all-pairs cosine pass the librarian shipped with.
function referenceEmbeddingPairs(docs, threshold = EMBEDDING_MIN_SIM) {
  const pairs = [];
  for (const group of byProject(docs.filter((d) => Array.isArray(d.vector)))) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const similarity = cosineSimilarity(group[i].vector, group[j].vector);
        if (similarity !== null && Number.isFinite(similarity) && similarity >= threshold) {
          pairs.push({ a: group[i].id, b: group[j].id, similarity, method: 'embedding' });
        }
      }
    }
  }
  return pairs;
}

// The string-keyed inverted-index pass the librarian shipped with.
function referenceShinglePairs(docs, { threshold = SHINGLE_MIN_JACCARD, maxDf = SHINGLE_MAX_DF, eligible = () => true } = {}) {
  const pairs = [];
  for (const group of byProject(docs)) {
    const sets = group.map((doc) => shingleSet(`${doc.title || ''}\n${doc.body || ''}`));
    const index = new Map();
    sets.forEach((set, i) => { for (const s of set) { if (!index.has(s)) index.set(s, []); index.get(s).push(i); } });
    const seen = new Set();
    for (const holders of index.values()) {
      if (holders.length < 2 || holders.length > maxDf) continue;
      for (let x = 0; x < holders.length; x += 1) {
        for (let y = x + 1; y < holders.length; y += 1) {
          const [i, j] = [holders[x], holders[y]].sort((p, q) => p - q);
          if (seen.has(`${i}|${j}`)) continue;
          seen.add(`${i}|${j}`);
          if (!eligible(group[i], group[j])) continue;
          const similarity = jaccard(sets[i], sets[j]);
          if (similarity >= threshold) pairs.push({ a: group[i].id, b: group[j].id, similarity, method: 'shingle' });
        }
      }
    }
  }
  return pairs;
}

const pairKey = (p) => `${p.a}|${p.b}|${p.similarity}|${p.method}`;
const sortedKeys = (pairs) => pairs.map(pairKey).sort();
const clusterIds = (pairs) => clusterPairs(pairs).map((c) => c.ids.join(',')).sort();

test('filtered pair finders match the unfiltered passes exactly', () => {
  const docs = syntheticLibrary({ count: 500, dim: 96, projects: 3, withoutVectorEvery: 7 });
  // Vectors cosine refuses never pair: a non-finite entry, a zero vector, another length.
  docs[20].vector = docs[20].vector.map((x, i) => (i === 5 ? Number.NaN : x));
  docs[40].vector = docs[40].vector.map(() => 0);
  docs[60].vector = docs[60].vector.slice(0, 48);
  docs[61].vector = docs[60].vector.map((x) => x * 2);

  const embedding = findEmbeddingPairs(docs);
  const reference = referenceEmbeddingPairs(docs);
  assert.ok(reference.length > 20, `the fixture has near-duplicates (${reference.length})`);
  assert.deepEqual(embedding, reference, 'same pairs, similarities and order as the all-pairs cosine');
  for (const threshold of [0.5, 0.8, 0.95, 0.999]) {
    assert.deepEqual(findEmbeddingPairs(docs, { threshold }), referenceEmbeddingPairs(docs, threshold), `threshold ${threshold}`);
  }

  const shingle = findShinglePairs(docs);
  const shingleReference = referenceShinglePairs(docs);
  assert.ok(shingleReference.length > 20);
  assert.deepEqual(sortedKeys(shingle), sortedKeys(shingleReference), 'same shingle pairs and similarities');
  for (const threshold of [0.2, 0.5, 0.9]) {
    assert.deepEqual(sortedKeys(findShinglePairs(docs, { threshold })), sortedKeys(referenceShinglePairs(docs, { threshold })));
  }

  const mixed = findDuplicatePairs(docs, { embeddings: true });
  const mixedReference = [...reference, ...referenceShinglePairs(docs, {
    eligible: (a, b) => !Array.isArray(a.vector) || !Array.isArray(b.vector),
  })];
  assert.deepEqual(sortedKeys(mixed), sortedKeys(mixedReference));
  assert.deepEqual(clusterIds(mixed), clusterIds(mixedReference), 'the same clusters');
  assert.deepEqual(clusterIds(findDuplicatePairs(docs)), clusterIds(shingleReference));
});

test(`clustering ${MAX_CLUSTER_DOCS} documents in one project stays fast and skips most of the work`, () => {
  const docs = syntheticLibrary({ count: MAX_CLUSTER_DOCS, dim: 768, withoutVectorEvery: 25 });
  const stats = {};
  const started = performance.now();
  const pairs = findDuplicatePairs(docs, { embeddings: true, stats });
  const clusters = clusterPairs(pairs);
  const elapsed = performance.now() - started;
  const allPairs = (MAX_CLUSTER_DOCS * (MAX_CLUSTER_DOCS - 1)) / 2;

  assert.ok(clusters.length >= 150, `near-duplicates cluster (${clusters.length})`);
  assert.ok(stats.embeddingPairsScored < stats.embeddingPairsVisited / 50,
    `the bound drops most cosine pairs before a full score (${stats.embeddingPairsScored} of ${stats.embeddingPairsVisited})`);
  assert.ok(stats.shingleCandidates < allPairs / 10,
    `rare shingles nominate a small share of all pairs (${stats.shingleCandidates} of ${allPairs})`);
  // Generous: about 0.5 s on a laptop; the unfiltered cosine pass took about 2.5 s.
  assert.ok(elapsed < 8000, `clustered in ${Math.round(elapsed)} ms`);
});
