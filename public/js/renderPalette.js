import { escapeHtml } from './renderHelpers.js';
import { icon, logo } from './icons.js';

// Command palette (⌘K, design-handoff §10) — Commands always (filtered by the
// query), Tasks/Documents groups only while a query is typed. Items carry a
// string action id; main.js maps ids to behavior and runs flat[data-palette-index].

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

// Pure. Returns { groups, flat }: groups in Commands → Tasks → Documents order
// (empty groups dropped); flat is the ordered flattened item list whose indices
// match the rendered data-palette-index values.
export function buildPaletteGroups(state, { tasks = [], documents = [], projects = [] } = {}) {
  const query = String(state?.paletteQuery ?? '').trim().toLowerCase();
  const matches = (text) => !query || String(text ?? '').toLowerCase().includes(query);
  const groups = [];

  const commandItems = COMMANDS.filter((command) => matches(command.title)).map((command) => ({ ...command }));
  if (commandItems.length) groups.push({ label: 'Commands', items: commandItems });

  if (query) {
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));
    const taskItems = tasks
      .filter((task) => !task.archivedAt && matches(task.title))
      .slice(0, MAX_SEARCH_ITEMS)
      .map((task) => ({
        title: task.title,
        sub: projectNames.get(task.projectId) || '',
        icon: 'check',
        action: 'open-task',
        id: task.id,
      }));
    if (taskItems.length) groups.push({ label: 'Tasks', items: taskItems });

    const docItems = documents
      .filter((doc) => matches(`${doc.title} ${(doc.tags || []).join(' ')}`))
      .slice(0, MAX_SEARCH_ITEMS)
      .map((doc) => ({
        title: doc.title,
        sub: doc.documentType || '',
        icon: 'doc',
        action: 'open-doc',
        id: doc.id,
      }));
    if (docItems.length) groups.push({ label: 'Documents', items: docItems });
  }

  const flat = groups.flatMap((group) => group.items);
  return { groups, flat };
}

function renderItem(item, index, selectedIndex) {
  const selected = index === selectedIndex ? ' is-selected' : '';
  return `
        <button class="palette__item${selected}" type="button" data-action="palette-run" data-palette-index="${index}">
          ${icon(item.icon)}
          <span class="palette__item-title">${escapeHtml(item.title)}</span>
          <span class="palette__item-sub">${escapeHtml(item.sub)}</span>
        </button>`;
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
        ${group.items.map((item) => renderItem(item, index++, selectedIndex)).join('')}`).join('')
    : '<div class="palette__empty">No matches.</div>';

  return `
    <div class="overlay-center" data-overlay="palette" data-action="close-palette">
      <div class="palette" role="dialog" aria-label="Command palette">
        <div class="palette__input-row">
          ${icon('search')}
          <input class="palette__input" type="text" data-palette-input placeholder="Type a command, task, or document…" value="${escapeHtml(state?.paletteQuery ?? '')}" autocomplete="off" spellcheck="false">
          <span class="kbd">esc</span>
        </div>
        <div class="palette__scroll">${body}
        </div>
        <div class="palette__foot">
          <span class="palette__brand">${logo(15)}<span>prax</span></span>
          <span><span class="kbd">↑</span><span class="kbd">↓</span> navigate</span>
          <span>·</span>
          <span><span class="kbd">↵</span> run</span>
        </div>
      </div>
    </div>`;
}
