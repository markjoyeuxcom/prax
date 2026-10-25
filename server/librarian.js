// Librarian — pure parts of the consolidation pass (spec:
// the Prax Library document "Prax design: librarian"). Near-duplicate
// detection (embedding cosine, with a title/body shingle fallback), clustering,
// and the proposal document's shape. No IO here: the routes read documents
// and vectors, and write proposals. Nothing in this module can retire a
// document; the proposal it drafts only DESCRIBES the supersede links a person
// may approve.
import { createHash } from 'node:crypto';
import { foldCase } from './db.js';
import { cosineSimilarity } from './libraryRepository.js';
import { normalizeTitle } from './documentTitle.js';

export const EMBEDDING_MIN_SIM = 0.92;
export const SHINGLE_MIN_JACCARD = 0.5;
export const SHINGLE_SIZE = 3;
export const SHINGLE_MAX_DF = 50;
export const MAX_CLUSTER_DOCS = 2000;
export const MAX_CLUSTER_SIZE = 8;
export const PROPOSAL_TAG = 'librarian-proposal';
export const LIBRARIAN_AGENT = 'librarian';
const EXCLUDED_TAGS = new Set(['weekly-review', PROPOSAL_TAG]);
const EXCLUDED_TYPES = new Set(['template']);

function hasTag(doc, tag) {
  return Array.isArray(doc?.tags) && doc.tags.some((t) => String(t).toLowerCase() === tag);
}

// Documents worth comparing: active, non-archived, with a body, and not a
// template, a weekly review or an earlier proposal (those are alike by design).
export function isClusterCandidate(doc) {
  if (!doc || doc.archivedAt || (doc.status || 'active') !== 'active') return false;
  if (!String(doc.body || '').trim()) return false;
  if (EXCLUDED_TYPES.has(doc.documentType)) return false;
  return ![...EXCLUDED_TAGS].some((tag) => hasTag(doc, tag));
}

// Most recently updated first, capped; `truncated` says the cap bit.
export function selectCandidates(docs, { max = MAX_CLUSTER_DOCS } = {}) {
  const eligible = (Array.isArray(docs) ? docs : []).filter(isClusterCandidate)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return { candidates: eligible.slice(0, max), truncated: eligible.length > max, eligible: eligible.length };
}

// k-word shingles over the title and body; a text shorter than k words is
// one shingle of its words, so two identical short notes still match.
export function shingleSet(text, k = SHINGLE_SIZE) {
  const words = foldCase(String(text ?? '')).match(/[\p{L}\p{N}]+/gu) || [];
  const set = new Set();
  if (words.length === 0) return set;
  if (words.length < k) { set.add(words.join(' ')); return set; }
  for (let i = 0; i + k <= words.length; i += 1) set.add(words.slice(i, i + k).join(' '));
  return set;
}

export function jaccard(a, b) {
  if (!a?.size || !b?.size) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const s of small) if (large.has(s)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function docText(doc) {
  return `${doc.title || ''}\n${doc.body || ''}`;
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

// Shingle-Jaccard pairs within each project. Candidate pairs come from an
// inverted index: two documents are compared only when they share a shingle
// held by at most `maxDf` documents (a shingle held by more is boilerplate and
// nominates nothing). Candidates are gathered per document with an integer
// stamp array, so the work is bounded by the sum of C(df, 2) over the rare
// shingles (at most maxDf / 2 partner visits per shingle occurrence), never all
// pairs, and each nominated pair gets one exact Jaccard. Pairs come out in
// (i, j) input order. `eligible(a, b)` narrows which pairs count; `stats`
// (optional) receives the candidate and compared pair counts.
export function findShinglePairs(docs, {
  threshold = SHINGLE_MIN_JACCARD, k = SHINGLE_SIZE, maxDf = SHINGLE_MAX_DF, eligible = () => true, stats = null,
} = {}) {
  const pairs = [];
  let candidates = 0;
  let compared = 0;
  for (const group of byProject(Array.isArray(docs) ? docs : [])) {
    const sets = group.map((doc) => shingleSet(docText(doc), k));
    const index = new Map();
    sets.forEach((set, i) => {
      for (const s of set) {
        const holders = index.get(s);
        if (holders) holders.push(i); else index.set(s, [i]);
      }
    });
    const stamp = new Int32Array(group.length).fill(-1);
    for (let i = 0; i < group.length; i += 1) {
      const found = [];
      for (const s of sets[i]) {
        const holders = index.get(s);
        if (holders.length < 2 || holders.length > maxDf) continue;
        // Holders are ascending: walk back over the partners after i only, so
        // each pair is nominated from its lower index once.
        for (let h = holders.length - 1; h >= 0 && holders[h] > i; h -= 1) {
          const j = holders[h];
          if (stamp[j] === i) continue;
          stamp[j] = i;
          found.push(j);
        }
      }
      candidates += found.length;
      found.sort((x, y) => x - y);
      for (const j of found) {
        const a = group[i];
        const b = group[j];
        if (!eligible(a, b)) continue;
        compared += 1;
        const similarity = jaccard(sets[i], sets[j]);
        if (similarity >= threshold) pairs.push({ a: a.id, b: b.id, similarity, method: 'shingle' });
      }
    }
  }
  if (stats) Object.assign(stats, { shingleCandidates: candidates, shingleCompared: compared });
  return pairs;
}

// Cosine pairs within each project over documents that carry a `vector`.
//
// Exact, with a cheap bound that drops most pairs early. Each vector is
// normalised once. A pair's dot product is summed in blocks of
// EMBEDDING_BLOCK dimensions, and after each block Cauchy-Schwarz bounds what
// the remaining dimensions can add (|rest of u| x |rest of v|). Once the
// partial dot plus that bound is below the threshold (less a rounding margin
// far above float error), the pair cannot match and is dropped; an unrelated
// pair is usually dropped after a fraction of its dimensions. A pair that
// survives is scored with cosineSimilarity exactly as before, so the pairs
// and similarities are identical to the all-pairs pass, in the same (i, j)
// order. Vectors cosineSimilarity refuses (a non-finite entry, a zero norm, a
// different length) never pair, as before. The pair loop itself stays
// quadratic within a project; the candidate cap (MAX_CLUSTER_DOCS) bounds it,
// and tests/backend/librarianScale.test.js holds the time at that cap.
// `stats` (optional) receives the pairs visited and the pairs scored in full.
const EMBEDDING_BLOCK = 16;
const BOUND_MARGIN = 1e-9;

function unitVector(vector) {
  const n = vector.length;
  if (!n) return null;
  let norm = 0;
  for (let i = 0; i < n; i += 1) {
    const x = vector[i];
    if (typeof x !== 'number' || !Number.isFinite(x)) return null;
    norm += x * x;
  }
  norm = Math.sqrt(norm);
  if (!norm || !Number.isFinite(norm)) return null;
  const unit = new Float64Array(n);
  for (let i = 0; i < n; i += 1) unit[i] = vector[i] / norm;
  // tails[c]: the norm of the unit vector from block c on (tails[blocks] = 0).
  const blocks = Math.ceil(n / EMBEDDING_BLOCK);
  const tails = new Float64Array(blocks + 1);
  let rest = 0;
  for (let c = blocks - 1; c >= 0; c -= 1) {
    for (let i = c * EMBEDDING_BLOCK; i < Math.min(n, (c + 1) * EMBEDDING_BLOCK); i += 1) rest += unit[i] * unit[i];
    tails[c] = Math.sqrt(rest);
  }
  return { unit, tails };
}

function mayReach(u, v, floor) {
  const a = u.unit;
  const b = v.unit;
  const n = a.length;
  let dot = 0;
  for (let c = 0, i = 0; i < n; c += 1) {
    const stop = Math.min(n, i + EMBEDDING_BLOCK);
    for (; i < stop; i += 1) dot += a[i] * b[i];
    if (dot + u.tails[c + 1] * v.tails[c + 1] < floor) return false;
  }
  return true;
}

export function findEmbeddingPairs(docs, { threshold = EMBEDDING_MIN_SIM, stats = null } = {}) {
  const pairs = [];
  let visited = 0;
  let scored = 0;
  const floor = threshold - BOUND_MARGIN;
  for (const group of byProject((Array.isArray(docs) ? docs : []).filter((d) => Array.isArray(d.vector)))) {
    const prepared = group.map((doc) => unitVector(doc.vector));
    for (let i = 0; i < group.length; i += 1) {
      const u = prepared[i];
      if (!u) continue;
      for (let j = i + 1; j < group.length; j += 1) {
        const v = prepared[j];
        if (!v || v.unit.length !== u.unit.length) continue;
        visited += 1;
        if (!mayReach(u, v, floor)) continue;
        scored += 1;
        const similarity = cosineSimilarity(group[i].vector, group[j].vector);
        if (similarity !== null && Number.isFinite(similarity) && similarity >= threshold) {
          pairs.push({ a: group[i].id, b: group[j].id, similarity, method: 'embedding' });
        }
      }
    }
  }
  if (stats) Object.assign(stats, { embeddingPairsVisited: visited, embeddingPairsScored: scored });
  return pairs;
}

// Embedding edges between documents that both have a current vector; shingle
// edges for any pair where either side has none (or for every pair when no
// embedder is available).
export function findDuplicatePairs(docs, {
  embeddings = false, embeddingThreshold, shingleThreshold, stats = null,
} = {}) {
  const list = Array.isArray(docs) ? docs : [];
  if (!embeddings) return findShinglePairs(list, { threshold: shingleThreshold, stats });
  const vectorPairs = findEmbeddingPairs(list, { threshold: embeddingThreshold, stats });
  const shinglePairs = findShinglePairs(list, {
    threshold: shingleThreshold,
    stats,
    eligible: (a, b) => !Array.isArray(a.vector) || !Array.isArray(b.vector),
  });
  return [...vectorPairs, ...shinglePairs];
}

// A fingerprint of everything clustering reads: the settings, and for each
// candidate in order its id, project, revision (the token over title and body)
// and the exact bytes of its vector. Equal fingerprints give equal clusters, so
// a caller can reuse the last result (the report behind `prax doctor` does).
export function clusteringFingerprint(candidates, {
  embeddings = false, embeddingThreshold = EMBEDDING_MIN_SIM, shingleThreshold = SHINGLE_MIN_JACCARD,
} = {}) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify(['librarian-clusters-v1', Boolean(embeddings), embeddingThreshold, shingleThreshold,
    SHINGLE_SIZE, SHINGLE_MAX_DF, MAX_CLUSTER_SIZE]));
  for (const doc of Array.isArray(candidates) ? candidates : []) {
    const content = doc.revision ? { revision: doc.revision } : { title: doc.title ?? '', body: doc.body ?? '' };
    hash.update(`\n${JSON.stringify([doc.id, doc.projectId ?? null, content])}`);
    if (Array.isArray(doc.vector)) {
      const bytes = Float64Array.from(doc.vector, (x) => (typeof x === 'number' ? x : Number.NaN));
      hash.update(`|v${doc.vector.length}|`);
      hash.update(new Uint8Array(bytes.buffer));
    } else {
      hash.update('|none');
    }
  }
  return hash.digest('hex');
}

export function clusterKey(ids) {
  return createHash('sha256').update([...ids].sort().join('|')).digest('hex').slice(0, 32);
}

// Union-find over the pair edges → clusters of two or more, each with its own
// edges, largest first. A cluster lists at most `maxSize` documents (the most
// connected ones), so a long chain never becomes one giant proposal.
export function clusterPairs(pairs, { maxSize = MAX_CLUSTER_SIZE } = {}) {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(x) !== root) { const next = parent.get(x); parent.set(x, root); x = next; }
    return root;
  };
  for (const p of Array.isArray(pairs) ? pairs : []) {
    const ra = find(p.a);
    const rb = find(p.b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const groups = new Map();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    const root = find(p.a);
    if (!groups.has(root)) groups.set(root, { ids: new Set(), edges: [] });
    const g = groups.get(root);
    g.ids.add(p.a); g.ids.add(p.b); g.edges.push(p);
  }
  const clusters = [];
  for (const g of groups.values()) {
    let ids = [...g.ids];
    if (ids.length > maxSize) {
      const degree = new Map(ids.map((id) => [id, 0]));
      for (const e of g.edges) { degree.set(e.a, degree.get(e.a) + 1); degree.set(e.b, degree.get(e.b) + 1); }
      ids = ids.sort((x, y) => degree.get(y) - degree.get(x) || x.localeCompare(y)).slice(0, maxSize);
    }
    const keep = new Set(ids);
    const edges = g.edges.filter((e) => keep.has(e.a) && keep.has(e.b))
      .sort((x, y) => y.similarity - x.similarity);
    const methods = new Set(edges.map((e) => e.method));
    clusters.push({
      key: clusterKey(ids),
      ids: ids.sort(),
      edges,
      method: methods.size > 1 ? 'mixed' : ([...methods][0] || 'shingle'),
      truncatedFrom: g.ids.size > ids.length ? g.ids.size : null,
    });
  }
  return clusters.sort((a, b) => b.ids.length - a.ids.length || a.key.localeCompare(b.key));
}

// The canonical source: verified first (a person already vouched for it),
// then the longest body, then the newest.
export function chooseCanonical(docs) {
  return [...(Array.isArray(docs) ? docs : [])].sort((a, b) => (
    Number(Boolean(b.verified)) - Number(Boolean(a.verified))
    || String(b.body || '').length - String(a.body || '').length
    || String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    || String(a.id).localeCompare(String(b.id))
  ))[0] || null;
}

function paragraphs(body) {
  return String(body || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

const paragraphKey = (p) => (foldCase(p).match(/[\p{L}\p{N}]+/gu) || []).join(' ');

// Deterministic draft: the canonical body, then each other source's paragraphs
// the canonical body (or an earlier source) does not already carry.
export function draftCanonicalBody(canonical, others) {
  const seen = new Set(paragraphs(canonical?.body).map(paragraphKey));
  const parts = [String(canonical?.body || '').trim()];
  for (const doc of Array.isArray(others) ? others : []) {
    const extra = paragraphs(doc.body).filter((p) => {
      const key = paragraphKey(p);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (extra.length) parts.push(`### Also from “${normalizeTitle(doc.title) || 'Untitled'}”\n\n${extra.join('\n\n')}`);
  }
  return parts.filter(Boolean).join('\n\n');
}

function trustText(doc) {
  if (doc.verified) return doc.verifiedBy ? `verified by ${doc.verifiedBy}` : 'verified';
  return 'unverified';
}

function dateText(value) {
  return value ? String(value).slice(0, 10) : 'undated';
}

// The proposal document for one cluster: an unverified, agent-written
// synthesized note that lands in the review queue. It names the supersede
// links a person may approve; it records none.
export function buildProposalDocument(cluster, docsById) {
  const docs = cluster.ids.map((id) => docsById.get(id)).filter(Boolean);
  const canonical = chooseCanonical(docs);
  const others = docs.filter((d) => d.id !== canonical.id)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const title = normalizeTitle(`Proposal: consolidate “${normalizeTitle(canonical.title) || 'Untitled'}” (+${others.length})`);
  const titleOf = (id) => normalizeTitle(docsById.get(id)?.title) || id;
  const sourceLines = [canonical, ...others].map((d) => (
    `- [[${normalizeTitle(d.title) || 'Untitled'}]] — \`${d.id}\` · ${d.documentType || 'note'} · ${trustText(d)} · updated ${dateText(d.updatedAt)}${d.id === canonical.id ? ' · canonical base' : ''}`
  ));
  const linkLines = [canonical, ...others].map((d) => `- this document \`supersedes\` \`${d.id}\` (${normalizeTitle(d.title) || 'Untitled'})`);
  const whyLines = cluster.edges.map((e) => (
    `- ${titleOf(e.a)} ↔ ${titleOf(e.b)}: ${e.method === 'embedding' ? 'cosine' : 'shingle Jaccard'} ${e.similarity.toFixed(3)}`
  ));
  const body = [
    '> **Librarian proposal — unverified.** Nothing has been merged or retired. The sources below stay active.',
    '> Review the draft, edit it if needed and verify it; then approve it in Library health to record the',
    '> `supersedes` links listed here. Dismiss it there if these documents should stay separate.',
    '',
    '## Draft canonical body',
    '',
    draftCanonicalBody(canonical, others),
    '',
    '## Sources',
    '',
    ...sourceLines,
    '',
    '## Proposed supersede links (applied only on approval)',
    '',
    ...linkLines,
    '',
    '## Why these were grouped',
    '',
    ...whyLines,
    ...(cluster.truncatedFrom ? ['', `_The cluster had ${cluster.truncatedFrom} documents; the ${cluster.ids.length} most connected are listed._`] : []),
  ].join('\n');
  return {
    title,
    body,
    documentType: canonical.documentType || 'note',
    projectId: canonical.projectId,
    tags: [PROPOSAL_TAG],
    kind: 'synthesized',
    updatedBy: 'agent',
    updatedByAgent: LIBRARIAN_AGENT,
    verified: false,
    canonicalId: canonical.id,
    sourceIds: [canonical.id, ...others.map((d) => d.id)],
  };
}

// Decide what a run does with each cluster, given the proposals on record
// ({ clusterKey, status, sourceIds }). A key already proposed (open, approved
// or dismissed) is skipped, as is a cluster wholly inside one open proposal.
export function classifyClusters(clusters, proposals) {
  const byKey = new Map();
  for (const p of Array.isArray(proposals) ? proposals : []) byKey.set(p.clusterKey, p);
  const openSources = (Array.isArray(proposals) ? proposals : [])
    .filter((p) => p.status === 'open').map((p) => new Set(p.sourceIds || []));
  return (Array.isArray(clusters) ? clusters : []).map((cluster) => {
    const existing = byKey.get(cluster.key);
    if (existing) return { ...cluster, status: existing.status === 'open' ? 'proposed' : existing.status, proposalId: existing.documentId };
    if (openSources.some((set) => cluster.ids.every((id) => set.has(id)))) return { ...cluster, status: 'covered' };
    return { ...cluster, status: 'new' };
  });
}
