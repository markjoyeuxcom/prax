// Library ▸ Tags (Console redesign, 2026-10): every tag with its usage, the
// spellings that look like one subject, and one-click merges. Pure state →
// HTML; merges dispatch `merge-tags` (main.js confirms, then re-tags each
// affected document through the ordinary human PATCH, so verification and
// revision rules apply exactly as for a hand edit).

import { escapeHtml } from './html.js';
import { tagStats, tagMergeSuggestions, filterTagStats, TAG_FILTERS } from './tagStats.js';

export const TAG_TABLE_LIMIT = 60;

function shortDate(iso) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function buildTagsManagerModel(state) {
  const documents = (state.documents || []).filter((doc) => doc && !doc.archivedAt);
  const stats = tagStats(documents);
  const suggestions = tagMergeSuggestions(stats);
  const filter = TAG_FILTERS.some(([key]) => key === state.tagsFilter) ? state.tagsFilter : 'all';
  const query = String(state.tagsQuery || '').trim().toLowerCase().replace(/^#/, '');
  const filtered = filterTagStats(stats, filter, suggestions).filter((row) => !query || row.tag.includes(query));
  const max = stats.reduce((top, row) => Math.max(top, row.count), 0) || 1;
  // How many tags it takes to cover 80% of tag uses: the head worth curating.
  const uses = stats.reduce((sum, row) => sum + row.count, 0);
  let covered = 0;
  let head = 0;
  for (const row of stats) { if (covered >= uses * 0.8) break; covered += row.count; head += 1; }
  return {
    total: stats.length,
    head,
    usedOnce: stats.filter((row) => row.count === 1).length,
    agentOnly: stats.filter((row) => row.addedBy === 'agents').length,
    duplicateTags: new Set(suggestions.flatMap((s) => s.from)).size,
    suggestions,
    filter,
    query,
    rows: filtered.slice(0, state.tagsShowAll ? filtered.length : TAG_TABLE_LIMIT),
    hiddenRows: state.tagsShowAll ? 0 : Math.max(0, filtered.length - TAG_TABLE_LIMIT),
    max,
    counts: {
      all: stats.length,
      duplicates: filterTagStats(stats, 'duplicates', suggestions).length,
      once: stats.filter((row) => row.count === 1).length,
      agents: stats.filter((row) => row.addedBy === 'agents').length,
    },
  };
}

function renderSuggestion(suggestion) {
  const from = suggestion.from.map((tag) => `<span class="tagx tagx--from">#${escapeHtml(tag)}</span>`).join('');
  const why = suggestion.agentOnly
    ? `${escapeHtml(suggestion.documents)} document${suggestion.documents === 1 ? '' : 's'}, all tagged by agents.`
    : `${escapeHtml(suggestion.documents)} document${suggestion.documents === 1 ? '' : 's'} would move.`;
  return '<div class="tag-merge">'
    + `<div class="tag-merge__tags">${from}<span class="tag-merge__arrow" aria-hidden="true">→</span><span class="tagx tagx--into">#${escapeHtml(suggestion.into)}</span></div>`
    + `<p class="tag-merge__why">${why}</p>`
    + `<button type="button" class="btn-ghost tag-merge__go" data-action="merge-tags" data-into="${escapeHtml(suggestion.into)}" data-from="${escapeHtml(suggestion.from.join(','))}">Merge into #${escapeHtml(suggestion.into)}</button>`
    + '</div>';
}

function renderRow(row, max) {
  const width = Math.max(4, Math.round((row.count / max) * 100));
  const by = row.addedBy === 'agents' ? '◌ agents' : (row.addedBy === 'both' ? 'people + agents' : 'people');
  return '<tr class="tag-table__row">'
    + `<td><button type="button" class="tagx tagx--link" data-action="filter-by-tag" data-tag="${escapeHtml(row.tag)}" title="Show documents tagged #${escapeHtml(row.tag)}">#${escapeHtml(row.tag)}</button></td>`
    + `<td><div class="tag-table__count"><span>${escapeHtml(row.count)}</span><span class="tag-table__bar" aria-hidden="true"><span style="width:${width}%"></span></span></div></td>`
    + `<td class="tag-table__dim">${escapeHtml(shortDate(row.lastUsed))}</td>`
    + `<td class="tag-table__dim${row.addedBy === 'agents' ? ' tag-table__agent' : ''}">${escapeHtml(by)}</td>`
    + `<td class="tag-table__dim">${row.oftenWith.map((tag) => `#${escapeHtml(tag)}`).join(' ')}</td>`
    + '</tr>';
}

export function renderTagsManagerHtml(state) {
  const model = buildTagsManagerModel(state);
  const filters = TAG_FILTERS.map(([key, label]) => {
    const active = model.filter === key;
    return `<button type="button" class="filter-chip tag-filter${active ? ' is-active' : ''}" data-action="set-tags-filter" data-filter="${key}" aria-pressed="${active}">${escapeHtml(label)} <span class="tag-filter__n">${escapeHtml(model.counts[key])}</span></button>`;
  }).join('');
  const suggestions = model.suggestions.length
    ? '<section class="tags-page__section" aria-label="Suggested merges">'
      + `<div class="group-label">Suggested merges <span class="group-label__count">${escapeHtml(model.suggestions.length)}</span></div>`
      + `<div class="tag-merges">${model.suggestions.map(renderSuggestion).join('')}</div>`
      + '</section>'
    : '';
  const table = model.rows.length
    ? '<div class="tag-table-wrap"><table class="tag-table">'
      + '<thead><tr><th scope="col">Tag</th><th scope="col">Documents</th><th scope="col">Last used</th><th scope="col">Added by</th><th scope="col">Often with</th></tr></thead>'
      + `<tbody>${model.rows.map((row) => renderRow(row, model.max)).join('')}</tbody></table>`
      + (model.hiddenRows ? `<button type="button" class="tag-table__more" data-action="tags-show-all">Show ${escapeHtml(model.hiddenRows)} more</button>` : '')
      + '</div>'
    : `<p class="view-hint">${model.total ? 'No tags match.' : 'No tags yet. Tags you or your agents add to documents show up here.'}</p>`;
  return '<div class="page tags-page">'
    + '<div class="page-head"><div class="page-head__title-wrap">'
    + '<h1 class="page-head__title">Tags</h1>'
    + `<div class="tags-page__facts"><span><b>${escapeHtml(model.total)}</b> tags</span><span><b>${escapeHtml(model.head)}</b> cover 80% of uses</span>`
    + (model.duplicateTags ? `<span class="tags-page__warn"><b>${escapeHtml(model.duplicateTags)}</b> look like duplicates</span>` : '')
    + `<span><b>${escapeHtml(model.usedOnce)}</b> used once</span></div>`
    + '</div></div>'
    + '<p class="tags-page__rule">New tags are normalised on save: lowercase, no leading #, spaces become hyphens.</p>'
    + suggestions
    + '<section class="tags-page__section" aria-label="All tags">'
    + `<div class="tags-page__toolbar">${filters}<input class="panel__filter tags-page__find" type="text" data-tags-query placeholder="Find among ${escapeHtml(model.total)} tags…" value="${escapeHtml(state.tagsQuery || '')}" autocomplete="off" aria-label="Find a tag"></div>`
    + table
    + '</section>'
    + '</div>';
}
