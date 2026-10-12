// The application frame and the few placeholders main.js used to build inline:
// pure data → HTML. Every argument named *Html is trusted HTML produced by a
// render module; plain values are escaped here.

import { escapeHtml } from './renderHelpers.js';

// The shell renderApp installs into #app: window chrome, navigation, the main
// view, then the overlay root (modals render there in stacking order).
export function renderAppFrameHtml({ titlebarHtml = '', navHtml = '', mainHtml = '', flatMain = false, statusbarHtml = '', overlaysHtml = '', inspector = false } = {}) {
  return `
    <div class="desk">
      <div class="window">
        ${titlebarHtml}
        <div class="window__body${inspector ? ' window__body--inspector' : ''}">
          ${navHtml}
          <main class="main"><div class="main__scroll${flatMain ? ' main__scroll--flat' : ''}">${mainHtml}</div></main>
        </div>
        ${statusbarHtml}
      </div>
    </div>
    <div data-overlay-root>${overlaysHtml}</div>`;
}

// Task views before the first task collection arrives.
export function renderTasksLoadingHtml() {
  return '<div class="page"><div class="empty" role="status" aria-live="polite">'
    + '<p class="empty__title">Loading tasks…</p>'
    + '<p class="empty__sub">Preparing your workspace.</p>'
    + '</div></div>';
}

export function renderDocumentNotFoundHtml() {
  return '<div class="page"><p class="view-hint">Document not found.</p></div>';
}

// The toast layer: renderToastLayer swaps only its contents on expiry.
export function renderToastRootHtml(toastHtml = '') {
  return `<div data-toast-root>${toastHtml}</div>`;
}

// Boot: before the first render, and when the workspace could not load.
export function renderBootLoadingHtml() {
  return '<main class="empty" style="height:100vh"><p class="empty__sub">Loading Prax…</p></main>';
}

export function renderBootErrorHtml(message) {
  return `<main class="empty" style="height:100vh"><h2 class="empty__title">Prax could not load</h2><p class="empty__sub">${escapeHtml(message || 'Unknown error')}</p></main>`;
}
