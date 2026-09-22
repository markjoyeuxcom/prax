import { escapeHtml, chip } from './renderHelpers.js';
import { designStatus } from './statusMap.js';
import { logo } from './icons.js';
import { getSystemProject } from './systemProject.js';
import { localDateOf } from './dateHelpers.js';

// All-projects screen (design-handoff §6) — state-grouped project cards with
// progress bars + state-change chip actions. Replaces the old project
// manager/archive dialogs. Pure render: no DOM access, events delegate through
// data-action in main.js.

const STATE_DEFS = [
  { state: 'active', groupLabel: 'Active', actionLabel: 'Active' },
  { state: 'on-hold', groupLabel: 'On hold', actionLabel: 'Hold' },
  { state: 'completed', groupLabel: 'Completed', actionLabel: 'Done' },
  { state: 'archived', groupLabel: 'Archived', actionLabel: 'Archive' },
];

const KNOWN_STATES = new Set(STATE_DEFS.map((def) => def.state));

// Unrecognised/legacy project statuses fall back to the first group (Active)
// rather than disappearing — ports the old manager's default-select intent.
function normalizedStatus(project) {
  const status = project?.status;
  return KNOWN_STATES.has(status) ? status : 'active';
}

// Groups projects Active/On hold/Completed/Archived (empty groups dropped) and
// derives per-project counts from tasks: archived tasks are excluded entirely;
// done = design status 'completed'; pct = done/(open+done) rounded.
export function buildProjectGroups(projects = [], tasks = []) {
  const byProject = new Map();
  for (const task of tasks) {
    if (task.archivedAt) continue;
    const bucket = byProject.get(task.projectId) || { open: 0, done: 0 };
    if (designStatus(task.status) === 'completed') bucket.done += 1;
    else bucket.open += 1;
    byProject.set(task.projectId, bucket);
  }

  return STATE_DEFS.map(({ state, groupLabel }) => {
    const entries = projects
      .filter((project) => normalizedStatus(project) === state)
      .map((project) => {
        const { open, done } = byProject.get(project.id) || { open: 0, done: 0 };
        const total = open + done;
        return {
          project,
          open,
          done,
          pct: total ? Math.round((done / total) * 100) : 0,
          updated: localDateOf(project.updatedAt),
        };
      });
    return { state, label: groupLabel, projects: entries, areas: areasOf(entries) };
  }).filter((group) => group.projects.length > 0);
}

// Within a state group, projects sit under their area (spec item 15), the
// same partition the browser panel uses: named areas alphabetically, then
// the unassigned rest under Other. A group with no areas at all keeps one
// unlabelled run, so a small workspace looks exactly as before.
export function areasOf(entries = []) {
  const named = new Map();
  const loose = [];
  for (const entry of entries) {
    const area = String(entry.project?.area || '').trim();
    if (area) {
      if (!named.has(area)) named.set(area, []);
      named.get(area).push(entry);
    } else {
      loose.push(entry);
    }
  }
  if (!named.size) return [{ label: null, projects: entries }];
  const areas = [...named.keys()].sort((a, b) => a.localeCompare(b)).map((label) => ({ label, projects: named.get(label) }));
  if (loose.length) areas.push({ label: 'Other', projects: loose });
  return areas;
}

function renderStateChips(project) {
  const current = normalizedStatus(project);
  const id = escapeHtml(project.id);
  return STATE_DEFS
    .filter(({ state }) => state !== current)
    .map(({ state, actionLabel }) => `<button class="chip-btn" type="button" data-action="set-project-state" data-project-id="${id}" data-state="${state}">${actionLabel}</button>`)
    .join('');
}

function renderProjectCard(entry, groupState, colorFor) {
  const { project, open, done, pct, updated } = entry;
  const id = escapeHtml(project.id);
  const color = escapeHtml(colorFor(project));
  const stateDef = STATE_DEFS.find((def) => def.state === normalizedStatus(project));
  const dim = groupState === 'archived' ? ' is-dim' : '';
  const system = getSystemProject(project);
  return `
    <div class="proj-card${dim}" data-action="open-project" data-project-id="${id}">
      <div class="proj-card__head">
        <span class="proj-dot" style="--dot:${color}" aria-hidden="true"></span>
        <span class="proj-card__name">${escapeHtml(project.name)}</span>
        ${chip(stateDef.groupLabel, `state-${stateDef.state}`)}
      </div>
      <div class="proj-card__bar"><span style="width:${pct}%; --dot:${color}"></span></div>
      <div class="proj-card__meta">
        <span>${open} open · ${done} done</span>
        <span>${escapeHtml(updated)}</span>
      </div>
      <div class="proj-card__actions">
        ${system
          ? chip(`System · ${system.purpose}`, 'system')
          : `${renderStateChips(project)}
        <button class="chip-btn" type="button" data-action="delete-project" data-project-id="${id}">Delete</button>`}
      </div>
    </div>`;
}

function renderGroup(group, colorFor) {
  const areas = Array.isArray(group.areas) && group.areas.length ? group.areas : [{ label: null, projects: group.projects }];
  const grids = areas.map((area) => `
      ${area.label ? `<h3 class="all-projects__area">${escapeHtml(area.label)} <span class="all-projects__area-count">${area.projects.length}</span></h3>` : ''}
      <div class="proj-grid">
        ${area.projects.map((entry) => renderProjectCard(entry, group.state, colorFor)).join('')}
      </div>`).join('');
  return `
    <section class="all-projects__group">
      <h2 class="group-label">${escapeHtml(group.label)}</h2>${grids}
    </section>`;
}

// colorFor(project) → css color; main.js passes renderShell's projectColor.
export function renderAllProjectsHtml(state, groups = [], colorFor = (project) => project?.color || 'var(--accent)') {
  const body = groups.length
    ? groups.map((group) => renderGroup(group, colorFor)).join('')
    : `
      <div class="empty">
        ${logo(48)}
        <p class="empty__title">No projects yet</p>
        <p class="empty__sub">Create your first project to start organising work.</p>
      </div>`;

  return `
    <div class="page" data-all-projects>
      <header class="page-head">
        <h1 class="page-head__title">All projects</h1>
        <div class="page-head__actions">
          <input class="text-input" type="text" data-new-project-name placeholder="New project name" autocomplete="off">
          <button class="btn-primary" type="button" data-action="create-project">＋ New project</button>
        </div>
      </header>
      <p class="page-head__sub">Everything in one place — including what&#39;s paused, finished, or filed away.</p>
      ${body}
    </div>`;
}
