// Project page chrome — pure state → HTML: the header (colour dot, title or
// inline rename, status chip, Ops disclosure), the system-project hint, the
// Inbox summary, the Ops row, and the tab bar with the list's grouping and
// density controls. main.js builds the tab body (list, board, backlog,
// archive or the Inbox queue) and passes it in as trusted HTML.

import { escapeHtml } from './renderHelpers.js';
import { icon } from './icons.js';
import { isCollapsed } from './collapsed.js';
import { renderOpsToggleHtml, renderProjectOpsHtml, opsSectionKey } from './renderProjectOps.js';
import { renderInboxSummary } from './renderInbox.js';
import { getSystemProject } from './systemProject.js';
import { projectColor } from './renderShell.js';

const GROUP_LABELS = { due: 'Due date', priority: 'Priority', status: 'Status' };

// Comfortable / compact rows (spec item 9), a preference applied on <body>.
export function renderDensityToggle(state) {
  const density = state.preferences?.listDensity === 'compact' ? 'compact' : 'comfortable';
  const button = (key, label, glyph) => (
    `<button type="button" class="layout-toggle__btn${density === key ? ' is-active' : ''}" data-action="set-list-density" data-density="${key}" aria-pressed="${density === key}" aria-label="${label} rows" title="${label} rows">${glyph}</button>`
  );
  return `<div class="layout-toggle" role="group" aria-label="Row density">${button('comfortable', 'Comfortable', '<span aria-hidden="true">☰</span>')}${button('compact', 'Compact', '<span aria-hidden="true">≡</span>')}</div>`;
}

export function renderProjectTabsHtml(state, { inboxView = false, backlogCount = 0, archiveCount = 0 } = {}) {
  const tabs = [...(inboxView ? [['inbox', 'To process'], ['reviews', 'Reviews']] : []), ['list', 'List'], ['board', 'Board'], ['backlog', 'Backlog'], ['archive', 'Archive']]
    .map(([key, label]) => {
      const count = key === 'backlog' ? backlogCount : (key === 'archive' ? archiveCount : 0);
      const suffix = count ? ` · ${escapeHtml(count)}` : '';
      return `<button class="tabs__tab${state.tab === key ? ' is-active' : ''}" type="button" data-action="set-tab" data-tab="${key}">${label}${suffix}</button>`;
    }).join('');
  const right = state.tab === 'list'
    ? `<div class="tabs__right"><button class="btn-ghost" type="button" data-action="cycle-group">Group: ${escapeHtml(GROUP_LABELS[state.groupBy])}</button>${renderDensityToggle(state)}</div>`
    : '';
  return `<nav class="tabs">${tabs}${right}</nav>`;
}

// project: the open project (or null/undefined while it loads).
// bodyHtml: the rendered tab body (trusted HTML built by the render modules).
export function renderProjectPageHtml(state, project, { backlogCount = 0, archiveCount = 0, bodyHtml = '' } = {}) {
  const system = getSystemProject(project);
  const inboxView = project?.slug === 'inbox';
  const canRename = project && !system;
  // Ops metadata (on call / handoff / repo / area) sits on its own row under
  // an Ops disclosure; the title keeps the header row (year-one shell spec).
  const hasOps = Boolean(project) && !system;
  const opsCollapsed = hasOps && isCollapsed(state.collapsedSections, opsSectionKey(project.id));
  const status = project?.status || 'active';
  const chipClass = system ? 'chip--system' : `chip--state-${escapeHtml(status)}`;
  const dotColor = project ? projectColor(project) : 'var(--accent)';
  const titleHtml = (canRename && state.renamingProjectId === project.id)
    ? `<input class="page-head__rename" type="text" data-project-rename data-project-id="${escapeHtml(project.id)}" value="${escapeHtml(project.name)}" aria-label="Rename project" autocomplete="off" spellcheck="false">`
    : `<h1 class="page-head__title">${escapeHtml(project?.name || 'Tasks')}</h1>`
      + (canRename ? `<button class="page-head__rename-btn" type="button" data-action="rename-project" data-project-id="${escapeHtml(project.id)}" title="Rename project" aria-label="Rename project">${icon('pencil', 13)}</button>` : '');
  return `<div class="page">
        <header class="page-head">
          <span class="page-head__dot" style="--dot:${escapeHtml(dotColor)}"></span>
          ${titleHtml}
          <span class="chip ${chipClass}">${escapeHtml(system ? `System · ${system.purpose}` : status.replace('-', ' '))}</span>
          ${hasOps ? `<button class="page-head__overview" type="button" data-action="open-project-overview" data-project-id="${escapeHtml(project.id)}" title="Open the project overview (created from the starter when missing)"${state.overviewPendingProjectId === project.id ? ' aria-busy="true" disabled' : ''}>${icon('doc', 13)}<span>${state.overviewPendingProjectId === project.id ? 'Opening…' : 'Overview'}</span></button>` : ''}
          ${hasOps ? renderOpsToggleHtml(project, { collapsed: opsCollapsed }) : ''}
        </header>
        ${system ? `<p class="view-hint">${escapeHtml(system.description)}</p>` : ''}
        ${inboxView ? renderInboxSummary(state.inbox) : ''}
        ${hasOps ? renderProjectOpsHtml(project, { collapsed: opsCollapsed, revealed: state.revealedOpsFields }) : ''}
        ${renderProjectTabsHtml(state, { inboxView, backlogCount, archiveCount })}
        ${bodyHtml}
      </div>`;
}
