// Librarian — pure parts of the consolidation pass (spec:
// docs/superpowers/specs/2026-09-23-librarian-design.md). Near-duplicate
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
// inverted index; a shingle held by more than `maxDf` documents is boilerplate
// and does not nominate pairs. `eligible(a, b)` narrows which pairs count.
export function findShinglePairs(docs, {
  threshold = SHINGLE_MIN_JACCARD, k = SHINGLE_SIZE, maxDf = SHINGLE_MAX_DF, eligible = () => true,
} = {}) {
  const pairs = [];
  for (const group of byProject(Array.isArray(docs) ? docs : [])) {
    const sets = group.map((doc) => shingleSet(docText(doc), k));
    const index = new Map();
    sets.forEach((set, i) => {
      for (const s of set) {
        if (!index.has(s)) index.set(s, []);
        index.get(s).push(i);
      }
    });
    const seen = new Set();
    for (const holders of index.values()) {
      if (holders.length < 2 || holders.length > maxDf) continue;
      for (let x = 0; x < holders.length; x += 1) {
        for (let y = x + 1; y < holders.length; y += 1) {
          const i = holders[x];
          const j = holders[y];
          const key = i < j ? `${i}|${j}` : `${j}|${i}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const a = group[i];
          const b = group[j];
          if (!eligible(a, b)) continue;
          const similarity = jaccard(sets[i], sets[j]);
          if (similarity >= threshold) pairs.push({ a: a.id, b: b.id, similarity, method: 'shingle' });
        }
      }
    }
  }
  return pairs;
}

// Cosine pairs within each project over documents that carry a `vector`.
export function findEmbeddingPairs(docs, { threshold = EMBEDDING_MIN_SIM } = {}) {
  const pairs = [];
  for (const group of byProject((Array.isArray(docs) ? docs : []).filter((d) => Array.isArray(d.vector)))) {
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

// Embedding edges between documents that both have a current vector; shingle
// edges for any pair where either side has none (or for every pair when no
// embedder is available).
export function findDuplicatePairs(docs, { embeddings = false, embeddingThreshold, shingleThreshold } = {}) {
  const list = Array.isArray(docs) ? docs : [];
  if (!embeddings) return findShinglePairs(list, { threshold: shingleThreshold });
  const vectorPairs = findEmbeddingPairs(list, { threshold: embeddingThreshold });
  const shinglePairs = findShinglePairs(list, {
    threshold: shingleThreshold,
    eligible: (a, b) => !Array.isArray(a.vector) || !Array.isArray(b.vector),
  });
  return [...vectorPairs, ...shinglePairs];
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
