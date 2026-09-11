// Hybrid ranking — fuse the vector ranking with the full-text ranking, then
// weight the result by how much the memory deserves to be believed.
//
// Pure: no database, no embedder, no clock of its own. The repository supplies
// two already-ordered candidate lists and this module decides the final order,
// which keeps the ranking policy unit-testable and keeps SQL out of it.
//
// Why fuse at all. Cosine-only ranking has two defects that matter more for a
// memory library than for a document search:
//
//   1. A document whose vector is missing, stale, or from another model is not
//      ranked at all (C10) — it is invisible, not merely demoted. Recall
//      discloses that ("index incomplete: N of M"), but an honest miss is still
//      a miss. The FTS ranking re-admits exactly those documents.
//   2. An exact term — an error code, a flag, a file name — is the query shape
//      embeddings are worst at and BM25 is best at.
//
// Reciprocal Rank Fusion combines the two without needing their scores to be
// commensurable (a cosine and a BM25 score are not): each list contributes
// 1/(k + rank). k dampens the top-rank advantage; 60 is the conventional value
// from the original RRF work and behaves well on short lists.

export const RRF_K = 60;

// A verified memory is worth more than an unverified one, and an unverified one
// gets less trustworthy with age. Both effects are deliberately mild: this
// re-orders near-ties, it does not let a stale exact match outrank a good one.
const VERIFIED_BOOST = 1.25;
const DEFAULT_HALF_LIFE_DAYS = 365;
const DAY_MS = 86400000;

// Verification ARRESTS decay rather than resetting it: a human blessing is a
// statement that the claim was true when checked, and nothing about the passage
// of time alone falsifies it. Unverified memory is a machine's guess, and a
// guess does get less believable as the system it describes moves on.
export function trustWeight(doc, { now = new Date(), unverifiedHalfLifeDays = DEFAULT_HALF_LIFE_DAYS } = {}) {
  if (!doc) return 1;
  if (doc.verified) return VERIFIED_BOOST;
  const stamped = doc.updatedAt ? Date.parse(doc.updatedAt) : NaN;
  if (!Number.isFinite(stamped)) return 1; // undated: neither boosted nor punished
  const days = Math.max(0, (now.getTime() - stamped) / DAY_MS);
  return Math.pow(0.5, days / unverifiedHalfLifeDays);
}

// `semantic` and `keyword` are candidate lists already in their own best-first
// order. Returns one list, best-first, each hit carrying a `match` that says
// why it placed where it did — ranking an agent cannot inspect is ranking it
// cannot discount.
export function fuseHybrid({ semantic = [], keyword = [] } = {}, options = {}) {
  const { k = RRF_K, now = new Date(), trust = true, unverifiedHalfLifeDays } = options;
  const entries = new Map();

  const contribute = (list, field) => {
    list.forEach((doc, index) => {
      if (!doc || doc.id === undefined || doc.id === null) return;
      const rank = index + 1;
      const existing = entries.get(doc.id);
      if (!existing) {
        entries.set(doc.id, { doc, order: entries.size, semanticRank: null, keywordRank: null, [field]: rank });
        return;
      }
      // A duplicate inside one list keeps the better (lower) rank; a hit in the
      // other list fills that list's slot. Never double-count one list.
      if (existing[field] === null || rank < existing[field]) existing[field] = rank;
      // Prefer whichever copy carries a cosine, so `similarity` survives fusion.
      if (existing.doc.similarity === undefined && doc.similarity !== undefined) existing.doc = doc;
    });
  };

  contribute(semantic, 'semanticRank');
  contribute(keyword, 'keywordRank');

  const scored = [...entries.values()].map((entry) => {
    const rrf = (entry.semanticRank ? 1 / (k + entry.semanticRank) : 0)
      + (entry.keywordRank ? 1 / (k + entry.keywordRank) : 0);
    const weight = trust ? trustWeight(entry.doc, { now, unverifiedHalfLifeDays }) : 1;
    return { entry, rrf, weight, score: rrf * weight };
  });

  // Ties break on first-seen order, so the same inputs always produce the same
  // output — a ranking that shuffles between identical calls is unreviewable.
  scored.sort((a, b) => (b.score - a.score) || (a.entry.order - b.entry.order));

  return scored.map(({ entry, rrf, weight, score }) => ({
    ...entry.doc,
    match: {
      semanticRank: entry.semanticRank,
      keywordRank: entry.keywordRank,
      rrf,
      trust: weight,
      score,
    },
  }));
}
