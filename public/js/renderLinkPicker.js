import { escapeHtml } from './html.js';
import { chip } from './renderHelpers.js';
import { icon } from './icons.js';

// Link picker overlay — pure state → HTML string, restyled to the Prax palette
// dialog. Two modes (state.pickerMode): 'link' attaches a document to the open
// task (already-linked docs from state.taskDocuments render marked), while
// 'supersede' picks the replacement document for a supersede action. Filtering
// is client-side against title / documentType / tags, inside the render so a
// re-render with a new state.linkPickerQuery is the whole search loop.

function matchesQuery(doc, q) {
  return [doc.title, doc.documentType, ...(Array.isArray(doc.tags) ? doc.tags : [])]
    .some(value => String(value || '').toLowerCase().includes(q));
}

function linkedIdSet(taskDocuments) {
  const ids = (Array.isArray(taskDocuments) ? taskDocuments : [])
    .map(doc => (typeof doc === 'string' ? doc : doc && doc.id))
    .filter(Boolean);
  return new Set(ids);
}

export function renderLinkPickerHtml(state = {}) {
  const mode = state.pickerMode === 'supersede' ? 'supersede' : 'link';
  const heading = mode === 'supersede' ? 'Supersede with…' : 'Link a document';
  const query = String(state.linkPickerQuery ?? '');
  const q = query.trim().toLowerCase();
  const documents = Array.isArray(state.linkPickerDocuments) ? state.linkPickerDocuments : [];
  const filtered = q ? documents.filter(doc => matchesQuery(doc, q)) : documents;
  const linked = linkedIdSet(state.taskDocuments);

  const rows = filtered.length
    ? filtered.map(doc => {
        const isLinked = mode === 'link' && linked.has(doc.id);
        const pressed = mode === 'link' ? ` aria-pressed="${isLinked}"` : '';
        const type = escapeHtml(doc.documentType || 'note');
        return `
        <button class="palette__item${isLinked ? ' is-linked' : ''}" type="button" data-link-picker-doc data-document-id="${escapeHtml(doc.id)}"${pressed}>
          ${icon('doc')}
          <span class="palette__item-title">${escapeHtml(doc.title || 'Untitled document')}</span>
          ${chip(doc.documentType || 'note', `type-${type}`)}
        </button>`;
      }).join('')
    : '<p class="palette__empty">No documents match.</p>';

  return `
    <div class="overlay-center" data-link-picker>
      <section class="palette" role="dialog" aria-modal="true" aria-labelledby="link-picker-title">
        <header class="palette__group" id="link-picker-title">${heading}</header>
        <div class="palette__input-row">
          ${icon('search')}
          <input class="palette__input" type="search" data-link-picker-search value="${escapeHtml(query)}" placeholder="Search documents…" autocomplete="off" aria-label="Search documents">
          <button class="drawer__close" type="button" data-action="close-link-picker" aria-label="Close">✕</button>
        </div>
        <div class="palette__scroll">${rows}
        </div>
      </section>
    </div>`;
}
