import { escapeHtml } from './renderHelpers.js';
import { icon, logo } from './icons.js';
import { BUILT_IN_SMART_VIEWS } from './taskSmartViews.js';
import { isPinned } from './pinned.js';

// Command palette (⌘K, design-handoff §10) — Commands always (filtered by the
// query); Projects/Views/Tasks/Documents groups only while a query is typed.
// Items carry a string action id; main.js maps ids to behavior and runs
// flat[data-palette-index]. Projects and views rank ABOVE content search:
// with the rail+panel shell they are the lists that outgrow scrolling, and a
// short query usually means "take me there".

const COMMANDS = [
  { title: 'New task', sub: 'N', icon: 'plus', action: 'new-task' },
  { title: 'New document', sub: '', icon: 'doc', action: 'new-document' },
  { title: 'Toggle dark mode', sub: '⌘J', icon: 'cmd', action: 'toggle-theme' },
  { title: 'Go to board', sub: '', icon: 'grid', action: 'go-board' },
  { title: 'Open library', sub: '', icon: 'book', action: 'go-library' },
  { title: 'All projects', sub: '', icon: 'grid', action: 'go-all' },
  { title: 'Focus writing', sub: '', icon: 'doc', action: 'focus-writing' },
  { title: 'Open settings', sub: '', icon: 'sliders', action: 'go-settings' },
];

const MAX_SEARCH_ITEMS = 5;

// Scopes (year-one shell spec, item 6): "All" keeps the mixed list with a
// five-per-group cap and a "+N more" row per overflowing group; a single
// scope lists that group alone, much deeper. A scope with an empty query
// browses the whole group (every project, every view…), which "All" never
// does — with no query it stays a command list.
export const PALETTE_SCOPES = Object.freeze([
  ['all', 'All'], ['commands', 'Commands'], ['projects', 'Projects'],
  ['views', 'Views'], ['tasks', 'Tasks'], ['docs', 'Docs'],
]);
export const MAX_SCOPED_ITEMS = 40;

export function normalizePaletteScope(value) {
  return PALETTE_SCOPES.some(([key]) => key === value) ? value : 'all';
}

// The next scope in the bar (Tab) or the previous (Shift+Tab).
export function cyclePaletteScope(current, direction = 1) {
  const keys = PALETTE_SCOPES.map(([key]) => key);
  const index = keys.indexOf(normalizePaletteScope(current));
  return keys[(index + (direction < 0 ? -1 : 1) + keys.length) % keys.length];
}

// Pure. Returns { groups, flat }: groups in Commands → Tasks → Documents order
// (empty groups dropped); flat is the ordered flattened item list whose indices
// match the rendered data-palette-index values.
export function buildPaletteGroups(state, { tasks = [], documents = [], projects = [] } = {}) {
  const query = String(state?.paletteQuery ?? '').trim().toLowerCase();
  const scope = normalizePaletteScope(state?.paletteScope);
  const matches = (text) => !query || String(text ?? '').toLowerCase().includes(query);
  // Every group is built in full so the scope bar can show honest counts;
  // capping happens once at the end, per scope.
  const full = [];

  const commandItems = COMMANDS.filter((command) => matches(command.title)).map((command) => ({ ...command }));
  if (commandItems.length) full.push({ key: 'commands', label: 'Commands', items: commandItems, icon: 'cmd' });

  if (query || scope !== 'all') {
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));

    const pinnedFirst = (kind, keyOf) => (a, b) => (
      Number(isPinned(state?.pinned, kind, keyOf(b))) - Number(isPinned(state?.pinned, kind, keyOf(a)))
    );
    const projectItems = projects
      .filter((project) => (project?.status === 'active' || project?.status === 'on-hold' || project?.slug === 'inbox')
        && matches(project.name))
      .sort(pinnedFirst('projects', (project) => project.id))
      .map((project) => ({
        title: project.name,
        sub: ['Project', project.area || null, project.status === 'on-hold' ? 'on hold' : null]
          .filter(Boolean).join(' · '),
        icon: project.slug === 'inbox' ? 'inbox' : 'grid',
        action: 'go-project',
        id: project.id,
      }));
    if (projectItems.length) full.push({ key: 'projects', label: 'Projects', items: projectItems, icon: 'grid' });

    const smartViewItems = [...(state?.taskSmartViews || []), ...BUILT_IN_SMART_VIEWS]
      .filter((view) => matches(view.label))
      .map((view) => ({
        title: view.label, sub: 'Smart view', icon: 'filter', action: 'go-smart-view', id: view.id,
      }));
    // delete/select for library views is index-addressed; carry the index.
    const libraryViewItems = (state?.librarySavedViews || [])
      .map((view, index) => ({ view, index }))
      .filter(({ view }) => matches(view?.label))
      .map(({ view, index }) => ({
        title: view.label, sub: 'Library view', icon: 'tag', action: 'go-library-view', index,
      }));
    const viewItems = [...smartViewItems, ...libraryViewItems]
      .sort((a, b) => {
        const pin = (item) => (item.action === 'go-smart-view'
          ? isPinned(state?.pinned, 'smartViews', item.id)
          : isPinned(state?.pinned, 'libraryViews', item.title));
        return Number(pin(b)) - Number(pin(a));
      });
    if (viewItems.length) full.push({ key: 'views', label: 'Views', items: viewItems, icon: 'filter' });

    const taskItems = tasks
      .filter((task) => !task.archivedAt && matches(task.title))
      .map((task) => ({
        title: task.title,
        sub: projectNames.get(task.projectId) || '',
        icon: 'check',
        action: 'open-task',
        id: task.id,
      }));
    if (taskItems.length) full.push({ key: 'tasks', label: 'Tasks', items: taskItems, icon: 'check' });

    const docItems = documents
      // Match title, tags, AND body so ⌘K finds a doc by a phrase inside it,
      // not just its title — the cheap half of a doc quick-switcher.
      .filter((doc) => matches(`${doc.title} ${(doc.tags || []).join(' ')} ${doc.body || ''}`))
      .map((doc) => ({
        title: doc.title,
        sub: doc.documentType || '',
        icon: 'doc',
        action: 'open-doc',
        id: doc.id,
      }));
    if (docItems.length) full.push({ key: 'docs', label: 'Documents', items: docItems, icon: 'doc' });
  }

  const countOf = (key) => full.find((group) => group.key === key)?.items.length || 0;
  const scopes = PALETTE_SCOPES.map(([key, label]) => ({
    key, label, count: key === 'all' ? full.reduce((sum, group) => sum + group.items.length, 0) : countOf(key),
  }));

  let groups;
  if (scope === 'all') {
    // Commands were never capped (there are eight); search groups cap at
    // five and hand the rest to their scope via a "+N more" row.
    groups = full.map((group) => {
      if (group.key === 'commands' || group.items.length <= MAX_SEARCH_ITEMS) return { label: group.label, items: group.items };
      const hidden = group.items.length - MAX_SEARCH_ITEMS;
      return {
        label: group.label,
        items: [...group.items.slice(0, MAX_SEARCH_ITEMS), {
          title: `${hidden} more in ${group.label}`, sub: '⇥', icon: group.icon, action: 'palette-scope', scope: group.key, more: true,
        }],
      };
    });
  } else {
    groups = full
      .filter((group) => group.key === scope)
      .map((group) => ({
        label: group.label,
        items: group.items.slice(0, MAX_SCOPED_ITEMS),
        truncated: Math.max(0, group.items.length - MAX_SCOPED_ITEMS),
      }));
  }

  const flat = groups.flatMap((group) => group.items);
  return { groups, flat, scope, scopes };
}

function renderItem(item, index, selectedIndex) {
  const selected = index === selectedIndex;
  // The selected task row carries an inline Done — a SIBLING of the run
  // button (a button inside a button loses the inner control), reached by
  // click or ⌘↵.
  const action = selected && item.action === 'open-task'
    ? `<button class="palette__action" type="button" data-action="palette-task-done" data-task-id="${escapeHtml(item.id)}" title="Mark done (⌘↵)">Done</button>`
    : '';
  return `
        <div class="palette__row${selected ? ' is-selected' : ''}">
        <button class="palette__item${item.more ? ' palette__item--more' : ''}${selected ? ' is-selected' : ''}" type="button" data-action="palette-run" data-palette-index="${index}">
          ${icon(item.icon)}
          <span class="palette__item-title">${escapeHtml(item.title)}</span>
          <span class="palette__item-sub">${escapeHtml(item.sub)}</span>
        </button>${action}
        </div>`;
}

function renderScopes(model) {
  const scopes = Array.isArray(model.scopes) ? model.scopes : [];
  if (!scopes.length) return '';
  const active = normalizePaletteScope(model.scope);
  return `<div class="palette__scopes" role="tablist" aria-label="Search scope">${scopes.map(({ key, label, count }) => (
    `<button type="button" role="tab" class="palette__scope${key === active ? ' is-active' : ''}" data-action="palette-scope" data-scope="${key}" aria-selected="${key === active}">${escapeHtml(label)}${count > 0 ? ` <span class="palette__scope-count">${count}</span>` : ''}</button>`
  )).join('')}</div>`;
}

// Accepts the buildPaletteGroups result ({ groups, flat }) or a bare group array.
export function renderPaletteHtml(state, model = { groups: [], flat: [] }) {
  const groups = Array.isArray(model) ? model : (model.groups || []);
  const flat = Array.isArray(model) ? groups.flatMap((group) => group.items) : (model.flat || groups.flatMap((group) => group.items));
  const rawSelection = Number.isFinite(state?.paletteSelection) ? state.paletteSelection : 0;
  const selectedIndex = flat.length ? Math.min(Math.max(0, rawSelection), flat.length - 1) : -1;

  let index = 0;
  const body = groups.length
    ? groups.map((group) => `
        <div class="palette__group">${escapeHtml(group.label)}</div>
        ${group.items.map((item) => renderItem(item, index++, selectedIndex)).join('')}${group.truncated > 0 ? `<div class="palette__truncated">${group.truncated} more — keep typing to narrow it down.</div>` : ''}`).join('')
    : '<div class="palette__empty">No matches.</div>';
  const scopeBar = Array.isArray(model) ? '' : renderScopes(model);

  return `
    <div class="overlay-center" data-overlay="palette" data-action="close-palette">
      <div class="palette" role="dialog" aria-label="Command palette">
        <div class="palette__input-row">
          ${icon('search')}
          <input class="palette__input" type="text" data-palette-input placeholder="Type a command, task, or document…" value="${escapeHtml(state?.paletteQuery ?? '')}" autocomplete="off" spellcheck="false">
          <span class="kbd">esc</span>
        </div>
        ${scopeBar}
        <div class="palette__scroll">${body}
        </div>
        <div class="palette__foot">
          <span class="palette__brand">${logo(15)}<span>prax</span></span>
          <span><span class="kbd">↑</span><span class="kbd">↓</span> navigate</span>
          <span>·</span>
          <span><span class="kbd">↵</span> run</span>
          <span>·</span>
          <span><span class="kbd">⌘↵</span> done</span>
          <span>·</span>
          <span><span class="kbd">⇥</span> scope</span>
        </div>
      </div>
    </div>`;
}
