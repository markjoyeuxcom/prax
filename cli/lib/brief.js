// cli/lib/brief.js — `prax brief <task-id>`: everything an agent needs to
// start a task, in one read-only composition over existing routes: the task
// header, its numbered checklist, the latest handoff paragraph, linked and
// related documents with their trust, and the top recall matches for the task
// — through the same fill order, compaction and trust chips as
// `recall --budget` (cli/lib/budget.js), so there is one ranking, not two.
// See docs/superpowers/specs/2026-09-23-budgeted-context-and-brief-design.md.
import { compactLine, fillOrder, oneLine, trustChip } from './budget.js';
import { hiddenHarvestedNote } from '../../server/harvestedCandidates.js';
import {
  budgetSummary, coverageOf, coverageNote, enrichCandidates, formatRecall, memoryEntryFull,
  projectLabel, renderBudgeted, searchCandidates, trustLabel,
} from './recall.js';

export const BRIEF_MEMORY_HITS = 3;
// Linked documents read one by one for their trust; beyond this they are
// listed as `[trust unknown]` and counted, never given a guessed label.
export const LINKED_READ_MAX = 20;
const QUERY_CHARS = 500;
const SEARCH_MAX = 50;

// The last non-blank paragraph of the notes (paragraphs split on a blank line).
export function latestHandoff(notes) {
  const paragraphs = String(notes || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return { paragraph: paragraphs.length ? paragraphs[paragraphs.length - 1] : null, paragraphs: paragraphs.length };
}

// What the memory section searches for: the title and description, bounded.
export function briefQuery(task) {
  const text = [task?.title, task?.description].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return text.length <= QUERY_CHARS ? text : text.slice(0, QUERY_CHARS).trimEnd();
}

const TRUST_FIELDS = [
  'title', 'documentType', 'projectId', 'verified', 'verifiedBy', 'status', 'updatedAt', 'updatedBy',
  'updatedByAgent', 'archivedAt',
];

// A reference joined with its full record's trust, or marked unknown.
function withTrust(ref, doc, slugOf) {
  if (!doc) return { ...ref, trustKnown: false, projectSlug: slugOf(ref.projectId) };
  const out = { ...ref, trustKnown: true };
  for (const key of TRUST_FIELDS) if (doc[key] !== undefined) out[key] = doc[key];
  out.projectSlug = slugOf(out.projectId);
  return out;
}

// Split the related suggestions against the memory section AS RENDERED: a
// suggestion is left out of Related only when the memory section prints it
// (in full or compact). One the budget left out of Memory stays in Related,
// so a document is never dropped from both. `underMemory` lists every
// suggestion that is also a memory match, whatever the budget did; `memory.items`
// carry the full record, so a suggestion moved back keeps its trust. Idempotent,
// so a brief built at one time can be re-split when rendered at another.
function splitRelated(brief, now) {
  const rendered = renderedMemoryIds(brief, now);
  const underMemory = new Set(brief.related.underMemory || []);
  const base = brief.related.items.filter((item) => !underMemory.has(item.id));
  const back = brief.memory.items
    .filter((item) => underMemory.has(item.id) && !rendered.has(item.id))
    .map((item) => ({ ...item, trustKnown: true }));
  return {
    ...brief.related,
    items: [...base, ...back],
    alsoUnderMemory: [...underMemory].filter((id) => rendered.has(id)).length,
  };
}

function renderedMemoryIds(brief, now) {
  const { summary } = planBriefMemory(brief, now);
  if (!summary) return new Set(brief.memory.items.map((item) => item.id));
  return new Set(summary.entries.filter((entry) => entry.form !== 'omitted').map((entry) => entry.id));
}

// Unreviewed harvested candidates stay out of the memory and related sections
// unless `includeHarvested` (server/harvestedCandidates.js); each section says
// how many it hid. Linked documents are the task's own and are always listed.
export async function buildBrief(client, {
  taskId, budget, checkout, memoryHits = BRIEF_MEMORY_HITS, includeHarvested = false, now = new Date(),
} = {}) {
  const task = await client.getTask(taskId);
  const checklist = await client.listChecklist(taskId);
  const projects = await client.listProjects().catch(() => null);
  const slugById = new Map((Array.isArray(projects) ? projects : []).filter((p) => p && p.id).map((p) => [p.id, p.slug]));
  const slugOf = (projectId) => (projectId ? slugById.get(projectId) ?? null : null);
  const linkedRefs = await client.listTaskDocuments(taskId);
  let related;
  try {
    related = await client.relatedTaskDocuments(taskId, { includeHarvested });
  } catch (err) {
    // An older server without the route, or a failure: say so, never guess.
    related = { suggestions: [], degraded: true, reason: err && err.status === 404 ? 'not-supported' : 'unavailable' };
  }

  // Memory: the top matches for the task, skipping documents already linked
  // to it (they are listed above in full), every citation checked.
  const linkedIds = new Set((linkedRefs || []).map((d) => d.id));
  const query = briefQuery(task);
  let memory;
  if (query) {
    const found = await searchCandidates(client, {
      query, limit: Math.min(memoryHits + linkedIds.size, SEARCH_MAX), includeHarvested,
    });
    const hits = found.items.filter((d) => !linkedIds.has(d.id)).slice(0, memoryHits);
    const items = fillOrder(await enrichCandidates(client, hits, checkout, { fetch: !found.keyword }));
    memory = {
      query,
      keyword: found.keyword,
      note: found.keyword ? 'semantic search disabled — keyword results' : null,
      ...coverageOf(found),
      items,
    };
  } else {
    memory = { query: '', keyword: false, note: null, degraded: false, reason: null, index: null, page: null, items: [] };
  }

  const memoryIds = new Set(memory.items.map((d) => d.id));
  const read = (id) => client.getDocument(id).catch(() => null);
  const linked = await Promise.all((linkedRefs || []).map(async (ref, i) => withTrust(
    ref, i < LINKED_READ_MAX ? await read(ref.id) : null, slugOf,
  )));
  const suggestions = Array.isArray(related?.suggestions) ? related.suggestions : [];
  const relatedItems = await Promise.all(suggestions
    .filter((s) => !memoryIds.has(s.id))
    .map(async (ref) => withTrust(ref, await read(ref.id), slugOf)));

  const brief = {
    schemaVersion: 1,
    task,
    project: task?.projectId ? { id: task.projectId, slug: slugOf(task.projectId) } : null,
    checklist: Array.isArray(checklist) ? checklist : [],
    handoff: latestHandoff(task?.notes),
    linked,
    related: {
      items: relatedItems,
      // Suggestions that are also memory matches, before the budget decides
      // which of them the memory section prints (splitRelated).
      underMemory: suggestions.filter((s) => memoryIds.has(s.id)).map((s) => s.id),
      alsoUnderMemory: 0,
      degraded: Boolean(related?.degraded),
      reason: related?.reason ?? null,
      hiddenHarvested: Number(related?.hiddenHarvested) || 0,
    },
    memory: { ...memory, budget: budget ?? null },
  };
  return { ...brief, related: splitRelated(brief, now) };
}

function docLine(doc, now) {
  if (!doc.trustKnown) {
    return `- [trust unknown] ${oneLine(doc.title) || 'Untitled'} (${doc.documentType || 'note'} · ${doc.id})`;
  }
  const trust = [projectLabel(doc), trustLabel(doc, now)].filter(Boolean).join(' · ');
  const similarity = Number.isFinite(doc.similarity) ? ` · similarity ${doc.similarity}` : '';
  return `- ${trustChip(doc)} ${oneLine(doc.title) || 'Untitled'} (${doc.documentType || 'note'} · ${doc.id}${trust ? ` · ${trust}` : ''}${similarity})`;
}

// The memory section, planned and rendered through the shared budget planner.
export function planBriefMemory(brief, now = new Date()) {
  const memory = brief.memory;
  if (!memory.query) return { text: 'No title or description to search memory with.', summary: null };
  if (!memory.items.length) {
    return {
      text: formatRecall({ ...memory, kind: 'empty', query: memory.query, note: memory.keyword ? 'keyword' : null }),
      summary: null,
    };
  }
  const fixedLines = [];
  if (memory.note) fixedLines.push(`(${memory.note})`);
  const coverage = coverageNote(memory);
  if (coverage) fixedLines.push(`(${coverage} — results may be missing)`);
  const hidden = hiddenHarvestedNote(memory.hiddenHarvested);
  if (hidden) fixedLines.push(`(${hidden})`);
  const entries = memory.items.map((item, i) => ({
    full: memoryEntryFull(item, i, now, { heading: '###' }),
    compact: compactLine(item),
    unverified: !item.verified,
  }));
  const budget = Number.isFinite(memory.budget) ? memory.budget : Infinity;
  const { text, used, plan } = renderBudgeted({ fixedLines, entries, budget });
  return { text, summary: Number.isFinite(budget) ? budgetSummary(memory.items, budget, used, plan) : null };
}

export function formatBrief(given, now = new Date()) {
  // Related is re-split against the memory section as rendered at this `now`.
  const brief = { ...given, related: splitRelated(given, now) };
  const { task } = brief;
  const lines = [`# Brief: ${oneLine(task.title) || 'Untitled'}`];
  const meta = [task.status, task.priority];
  if (brief.project?.slug) meta.push(`in ${brief.project.slug}`);
  if (task.plannedFor) meta.push(`planned ${task.plannedFor}`);
  if (task.dueDate) meta.push(`due ${task.dueDate}${task.dueTime ? ` ${task.dueTime}` : ''}`);
  if (Array.isArray(task.labels) && task.labels.length) meta.push(task.labels.map((l) => `@${l}`).join(' '));
  meta.push(task.id);
  lines.push(meta.filter(Boolean).join(' · '));
  if (task.description) lines.push('', task.description.trim());

  const done = brief.checklist.filter((item) => item.completed).length;
  lines.push('', brief.checklist.length ? `## Checklist (${done} of ${brief.checklist.length} done)` : '## Checklist');
  if (brief.checklist.length) {
    brief.checklist.forEach((item, i) => lines.push(`  ${i + 1}. [${item.completed ? 'x' : ' '}] ${oneLine(item.label)}`));
  } else {
    lines.push('No checklist items.');
  }

  const { paragraph, paragraphs } = brief.handoff;
  if (paragraph) {
    const more = paragraphs > 1 ? ` (latest of ${paragraphs} paragraphs — prax task show ${task.id} for all)` : '';
    lines.push('', `## Latest handoff${more}`, paragraph);
  } else {
    lines.push('', '## Latest handoff', 'No handoff notes.');
  }

  lines.push('', '## Linked documents');
  if (brief.linked.length) {
    for (const doc of brief.linked) lines.push(docLine(doc, now));
    const unread = brief.linked.filter((d) => !d.trustKnown).length;
    if (unread) lines.push(`(${unread} linked document${unread === 1 ? '' : 's'} not read for trust — prax get <id>)`);
  } else {
    lines.push('None linked.');
  }

  lines.push('', '## Related documents');
  if (brief.related.degraded && !brief.related.items.length) {
    lines.push(`(related documents unavailable: ${brief.related.reason || 'unknown'})`);
  } else if (brief.related.items.length) {
    for (const doc of brief.related.items) lines.push(docLine(doc, now));
  } else {
    lines.push('None suggested.');
  }
  if (brief.related.alsoUnderMemory > 0) {
    lines.push(`(${brief.related.alsoUnderMemory} more shown under Memory)`);
  }
  const hiddenRelated = hiddenHarvestedNote(brief.related.hiddenHarvested);
  if (hiddenRelated) lines.push(`(${hiddenRelated})`);

  const shown = oneLine(brief.memory.query);
  const label = shown.length > 80 ? `${shown.slice(0, 80).trimEnd()}…` : shown;
  lines.push('', `## Memory — top ${BRIEF_MEMORY_HITS} for "${label}"`, planBriefMemory(brief, now).text);
  return lines.join('\n');
}

// The --json shape: the brief plus the memory section's fill decisions.
export function briefJson(brief, now = new Date()) {
  const { summary } = planBriefMemory(brief, now);
  return { ...brief, related: splitRelated(brief, now), memory: { ...brief.memory, budget: summary } };
}
