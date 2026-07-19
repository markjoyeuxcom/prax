// Related-knowledge query shaping — the ONE tuning point for what a task
// "means" to the embedding search (2026-07-18 context-surface plan). Kept
// pure and pinned by tests so suggestion quality is adjusted here, never by
// sprinkling heuristics across surfaces. Task content is embedded
// TRANSIENTLY at request time (like a manual semantic search) — tasks are
// never written into the Library's embedding index.

const MAX_QUERY_CHARS = 400;

export function buildRelatedQuery(task) {
  if (!task || typeof task !== 'object') return null;
  const parts = [task.title, task.description]
    .filter((part) => typeof part === 'string' && part.trim());
  if (!parts.length) return null;
  const text = parts.join('\n')
    // Strip markdown structure so syntax does not dominate the embedding.
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~]|\[[x ]\]/gi, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > MAX_QUERY_CHARS ? text.slice(0, MAX_QUERY_CHARS) : text;
}
