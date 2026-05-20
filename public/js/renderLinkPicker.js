function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function labelFromValue(value) {
  return String(value ?? '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function renderLinkPickerHtml({ documents = [], linkedIds = [], query = '' } = {}) {
  const linked = new Set(linkedIds);
  const q = String(query).trim().toLowerCase();
  const filtered = !q ? documents : documents.filter(d =>
    [d.title, d.documentType, d.context, ...(d.tags || [])].some(v => String(v || '').toLowerCase().includes(q)));

  const rows = filtered.length
    ? filtered.map(d => {
        const isLinked = linked.has(d.id);
        return `
        <button class="link-picker__row${isLinked ? ' is-linked' : ''}" type="button" data-link-picker-doc="${escapeHtml(d.id)}" aria-pressed="${isLinked}">
          <span class="link-picker__check">${isLinked ? '[x]' : '[ ]'}</span>
          <span class="link-picker__title">
            <strong>${escapeHtml(d.title || 'Untitled document')}</strong>
            <small>${escapeHtml(labelFromValue(d.documentType || 'note'))} · ${escapeHtml(d.context || '')}</small>
          </span>
        </button>`;
      }).join('')
    : '<p class="link-picker__empty">No documents match.</p>';

  return `
    <div class="modal-backdrop" data-link-picker>
      <section class="task-form-modal" role="dialog" aria-modal="true" aria-labelledby="link-picker-title">
        <header class="modal-header">
          <div class="modal-header--desktop">
            <div class="modal-header__heading">
              <span class="detail-kicker">Library</span>
              <h2 id="link-picker-title">Link a document</h2>
              <p>Attach a runbook or note to this task.</p>
            </div>
            <button class="modal-header__close bracket-button bracket-button--quiet" type="button" data-action="close-link-picker" aria-label="Close">[x] close</button>
          </div>
          <div class="modal-header--mobile">
            <button class="modal-header__cancel bracket-button bracket-button--quiet" type="button" data-action="close-link-picker">cancel</button>
            <h2 class="modal-header__title">link doc</h2>
            <span></span>
          </div>
        </header>
        <div class="link-picker">
          <label class="link-picker__search">
            <span class="sr-only">Search documents</span>
            <input type="search" placeholder="/ search documents" autocomplete="off" value="${escapeHtml(query)}" data-link-picker-search>
          </label>
          <div class="link-picker__list">${rows}</div>
        </div>
      </section>
    </div>`;
}
