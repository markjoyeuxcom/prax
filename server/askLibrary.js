// Pure helpers for the "Ask Prax" grounded answer: turn a retrieved context pack
// into an LLM prompt, and extract the cited source list. Kept pure and testable —
// all IO (retrieval + the chat call) lives in the route.

// The system prompt encodes the trust contract: answer only from the provided
// context, cite by title, prefer verified docs and flag unverified ones, and
// refuse rather than guess when the library doesn't cover the question.
const SYSTEM_PROMPT = [
  'You are Prax, a knowledge assistant for platform engineers and SREs.',
  'Answer the question using ONLY the CONTEXT documents provided below — do not use outside knowledge.',
  'Cite the documents you draw on by their exact title in square brackets, e.g. [Postgres failover].',
  'When the context gives ordered steps or commands, reproduce them exactly (verbatim), in order.',
  'Prefer documents that are verified. If you rely on one marked UNVERIFIED, say so explicitly.',
  'If the context does not contain the answer, say you do not have enough in the library to answer it, and suggest what to add — do not guess.',
  'Be concise and use Markdown.',
].join(' ');

export function buildAskMessages(question, context) {
  const q = String(question ?? '').trim();
  const body = String(context ?? '').trim() || '(no matching documents)';
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `CONTEXT:\n\n${body}\n\n---\n\nQUESTION: ${q}` },
  ];
}

// Budget for the generation context (a char proxy for tokens): the whole
// context, and a per-document cap so one large doc can't crowd out the rest.
export const ANSWER_CONTEXT_CHARS = 12000;
export const ANSWER_DOC_CHARS = 3000;
export const ANSWER_DOC_LIMIT = 6;

// The context fed to the model for a written answer — the FULL body of the top
// retrieved docs (not the browsing snippets the pack shows), verified first and
// unverified clearly marked, bounded by a total + per-doc char budget. Empty
// docs are skipped. Pure. This is what makes runbook / how-to answers correct:
// the model sees the actual steps, not just a title.
export function buildAnswerContext(docs, { limit = ANSWER_DOC_LIMIT, totalChars = ANSWER_CONTEXT_CHARS, docChars = ANSWER_DOC_CHARS } = {}) {
  const active = (Array.isArray(docs) ? docs : []).filter((d) => d && (d.status || 'active') === 'active');
  // Trust-aware ordering; retrieval order preserved within each group.
  const ordered = [...active.filter((d) => d.verified), ...active.filter((d) => !d.verified)].slice(0, limit);
  let remaining = totalChars;
  const blocks = [];
  for (const doc of ordered) {
    if (remaining <= 200) break;
    const bodyText = String(doc.body ?? '').trim();
    if (!bodyText) continue; // skip empty docs — nothing to answer from
    const title = String(doc.title || 'Untitled').trim();
    const trust = doc.verified ? 'verified' : 'UNVERIFIED — pending human review';
    const header = `## ${title} (${doc.documentType || 'note'} · ${trust})`;
    const cap = Math.min(docChars, remaining - header.length - 8);
    const text = bodyText.length > cap ? `${bodyText.slice(0, Math.max(0, cap))}\n…(truncated)` : bodyText;
    const block = `${header}\n\n${text}`;
    blocks.push(block);
    remaining -= block.length + 5; // account for the joiner
  }
  return blocks.join('\n\n---\n\n');
}

// The de-duplicated documents behind a pack, in section order — what the UI lists
// under "Sources" and the trust badge reads from.
export function collectSources(pack) {
  const seen = new Set();
  const out = [];
  for (const section of pack?.sections ?? []) {
    for (const item of section.items ?? []) {
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push({
        id: item.id,
        title: item.title,
        documentType: item.documentType,
        verified: Boolean(item.verified),
      });
    }
  }
  return out;
}
