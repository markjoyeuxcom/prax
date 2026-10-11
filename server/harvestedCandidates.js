// Unreviewed harvested candidates (docs/design/session-harvesting.md): session harvesting files an agent's proposed memory in
// the Inbox as an unverified document tagged `harvested`. Until a person
// verifies it (or refiles it without the tag), it is a proposal, not memory, so
// agent-facing retrieval leaves it out by default: semantic and hybrid search,
// keyword recall, both context packs, Ask, similar and task-related documents,
// and the memory-changes delta. A caller opts in with `includeHarvested=true`
// (the web UI's Library, Inbox and search do; `prax … --include-harvested`;
// the MCP tools' `includeHarvested`). A result that hid something says how
// many (QINV-08), so an empty or thin answer is never mistaken for a complete one.
//
// Shared by the server and the CLI (cli/ imports server/, never the reverse).

export const HARVEST_TAG = 'harvested';

// The response header that carries the hidden count on routes whose body is a
// bare array (the keyword listing, the legacy semantic array).
export const HIDDEN_HARVESTED_HEADER = 'x-prax-hidden-harvested';

function tagList(tags) {
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'string' && tags) {
    try {
      const parsed = JSON.parse(tags);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

// A document (normalised, or a raw row with JSON-text tags and 0/1 verified)
// that carries the harvest tag and that no person has verified.
export function isUnreviewedHarvested(doc) {
  if (!doc || doc.verified === true || Number(doc.verified) === 1) return false;
  return tagList(doc.tags).some((tag) => String(tag ?? '').trim().toLowerCase() === HARVEST_TAG);
}

// The opt-in from a query string or JSON body: only an explicit true counts.
export function includeHarvestedFrom(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === true || raw === 'true' || raw === '1';
}

// Split a list into what retrieval may show and the unreviewed candidates it
// hides. With `include`, nothing is hidden.
export function partitionHarvested(docs, { include = false } = {}) {
  const list = Array.isArray(docs) ? docs : [];
  if (include) return { kept: list, hidden: [] };
  const kept = [];
  const hidden = [];
  for (const doc of list) (isUnreviewedHarvested(doc) ? hidden : kept).push(doc);
  return { kept, hidden };
}

// SQL predicate for the same rule, over a markdown_documents alias. Tags are a
// JSON text column; an unparsable value counts as no tags rather than failing
// the query.
export function unreviewedHarvestedSql(alias = 'd') {
  return `(coalesce(${alias}.verified, 0) = 0 and exists (
    select 1 from json_each(case when json_valid(${alias}.tags) then ${alias}.tags else '[]' end) harvested_tag
    where lower(trim(harvested_tag.value)) = '${HARVEST_TAG}'
  ))`;
}

// The one-line disclosure, or '' when nothing was hidden. `hint` names the
// caller's opt-in (a CLI flag, an MCP argument or the query parameter).
export function hiddenHarvestedNote(count, { hint = '--include-harvested' } = {}) {
  const n = Number(count) || 0;
  if (n <= 0) return '';
  return `${n} unreviewed harvested candidate${n === 1 ? '' : 's'} hidden until a person triages ${n === 1 ? 'it' : 'them'}; ${hint} to show`;
}
