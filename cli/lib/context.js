// cli/lib/context.js — `prax context --budget <tokens>`: the server's JSON
// context pack, filled client-side in the shared fill order (verified, then
// cited-and-unchanged, then recent) because only this machine's checkout can
// say whether cited code still matches. Sections keep their meaning and order
// (unverified quarantined last); which entries print, and in which form, is
// decided in fill order. Without --budget the server's Markdown is printed
// unchanged and this module is not used.
// See docs/design/budgeted-context-and-brief.md.
import { compactLine, fillOrder, oneLine, trustChip } from './budget.js';
import { hiddenHarvestedNote } from '../../server/harvestedCandidates.js';
import {
  budgetSummary, checkCitations, citationNotes, createRepoUrlLookup, renderBudgeted,
} from './recall.js';

// Candidates asked of the server when --budget is given without --limit: the
// budget, not a document count, bounds what prints.
export const BUDGET_CANDIDATES = 50;

export async function budgetedContext(client, {
  project, query, limit, budget, checkout, includeHarvested = false,
} = {}) {
  const pack = await client.contextPack(project, {
    query, format: 'json', limit: limit ?? BUDGET_CANDIDATES, source: 'context', ...(includeHarvested ? { includeHarvested } : {}),
  });
  const repoUrlOf = createRepoUrlLookup(client);
  const projectId = pack?.project?.id ?? null;
  const items = [];
  for (const section of pack?.sections || []) {
    for (const item of section.items || []) items.push({ ...item, projectId: item.projectId ?? projectId, section: section.kind });
  }
  const checked = await Promise.all(items.map(async (item) => {
    const { citations, citationCheck } = await checkCitations(client, item, checkout, repoUrlOf);
    return { ...item, citations, citationCheck };
  }));
  return { pack, items: fillOrder(checked), budget };
}

function packHeader(pack) {
  const lines = [];
  const p = pack.project;
  lines.push(`# Context: ${p ? p.name : 'Library'}${p && p.status ? ` (${p.status})` : ''}`);
  if (pack.query) lines.push('', `_Query: ${oneLine(pack.query)}_`);
  if (pack.retrieval) {
    const suffix = pack.retrieval.fallback ? ` fallback (${pack.retrieval.reason || 'unspecified'})` : '';
    lines.push('', `_Retrieval: ${pack.retrieval.mode}${suffix}_`);
    const index = pack.retrieval.index;
    if (index && Number(index.pending) > 0) {
      lines.push(`(index incomplete: ${index.pending} of ${index.total} documents have no current embedding — results may be missing)`);
    }
  }
  const hidden = hiddenHarvestedNote(pack.hiddenHarvested);
  if (hidden) lines.push(`(${hidden})`);
  return lines;
}

// Plan and render. Entries are planned in fill order; each is printed under
// its section heading, sections in the pack's order.
export function planContext(result) {
  const { pack, items, budget } = result;
  const sectionTitle = new Map((pack.sections || []).map((s) => [s.kind, s.title]));
  const sectionOrder = (pack.sections || []).map((s) => s.kind);
  const entries = items.map((item) => {
    const labels = `${item.stale ? ' — _stale_' : ''}`;
    const notes = citationNotes(item);
    const head = `### ${trustChip(item)} ${oneLine(item.title) || 'Untitled'}${labels}  (${item.documentType || 'note'} · ${item.id}${notes.length ? ` · ${notes.join(' · ')}` : ''})`;
    return {
      full: item.text ? `${head}\n\n${String(item.text).trim()}\n` : `${head}\n`,
      compact: compactLine(item),
      unverified: !item.verified,
      group: item.section,
      header: `## ${sectionTitle.get(item.section) || item.section}\n`,
    };
  });
  const serverOmitted = pack.omitted && pack.omitted.total > 0
    ? [`_${pack.omitted.total} more document${pack.omitted.total === 1 ? '' : 's'}${pack.omitted.unverified > 0 ? ` (${pack.omitted.unverified} unverified)` : ''} left out by the document limit._`]
    : [];
  // Render sections in pack order, the planner's decisions per entry.
  const bySection = (plan) => {
    const out = [];
    for (const kind of sectionOrder) {
      const shown = entries.map((entry, i) => ({ entry, form: plan.forms[i] })).filter((x) => x.entry.group === kind && x.form);
      if (!shown.length) continue;
      out.push(shown[0].entry.header);
      for (const { entry, form } of shown) out.push(form === 'full' ? entry.full : entry.compact);
    }
    return out;
  };
  const rendered = renderBudgeted({
    fixedLines: packHeader(pack), entries, budget, footerLines: serverOmitted, order: bySection,
  });
  return { text: rendered.text, summary: budgetSummary(items, budget, rendered.used, rendered.plan) };
}

export function formatBudgetedContext(result) {
  return planContext(result).text;
}

export function budgetedContextJson(result) {
  const { pack, items } = result;
  const { summary } = planContext(result);
  const formById = new Map(summary.entries.map((e) => [e.id, e.form]));
  return {
    ...pack,
    sections: (pack.sections || []).map((section) => ({
      ...section,
      items: items.filter((item) => item.section === section.kind && formById.get(item.id) !== 'omitted')
        .map(({ section: _section, ...item }) => ({ ...item, form: formById.get(item.id) })),
    })).filter((section) => section.items.length > 0),
    budget: summary,
  };
}
