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
  'Prefer documents that are verified. If you rely on one shown under "Unverified", say so explicitly.',
  'If the context does not contain the answer, say you do not have enough in the library to answer it, and suggest what to add — do not guess.',
  'Be concise and use Markdown.',
].join(' ');

export function buildAskMessages(question, packMarkdown) {
  const q = String(question ?? '').trim();
  const context = String(packMarkdown ?? '').trim() || '(no matching documents)';
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `CONTEXT:\n\n${context}\n\n---\n\nQUESTION: ${q}` },
  ];
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
