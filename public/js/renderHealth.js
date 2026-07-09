import { escapeHtml } from './renderHelpers.js';

// Library health view — a curation dashboard of documents that may need
// attention: unverified AI drafts to review, empty stubs, stale derivations,
// and link orphans. Pure state->HTML; rows dispatch data-action clicks.
const CAP = 20;

// `showTrust` is only set where the row's verified/updatedBy are accurate (the
// listDocuments-sourced sections) — the stale/orphan rows come from a query that
// doesn't select those fields, so their trust tags would be misleading.
function docRow(doc, rowAction, showTrust) {
  const agent = showTrust && doc.updatedBy === 'agent' ? '<span class="health-tag">agent-written</span>' : '';
  const unver = showTrust && !doc.verified ? '<span class="health-tag health-tag--warn">unverified</span>' : '';
  return `<div class="health-row">
    <button class="health-row__title" type="button" data-action="open-health-doc" data-doc-id="${escapeHtml(doc.id || '')}">${escapeHtml(doc.title || 'Untitled')}</button>
    <span class="health-row__meta">${escapeHtml(doc.documentType || 'note')}${agent}${unver}</span>
    ${rowAction ? rowAction(doc) : ''}
  </div>`;
}

function section(title, docs, { empty, rowAction, showTrust = false } = {}) {
  const list = Array.isArray(docs) ? docs : [];
  const shown = list.slice(0, CAP).map((d) => docRow(d, rowAction, showTrust)).join('');
  const more = list.length > CAP ? `<p class="health-more">and ${list.length - CAP} more…</p>` : '';
  const body = list.length ? `${shown}${more}` : `<p class="health-empty">✓ ${escapeHtml(empty)}</p>`;
  return `<section class="health-card">
    <h2 class="health-card__title">${escapeHtml(title)}<span class="health-count${list.length ? '' : ' is-zero'}">${list.length}</span></h2>
    ${body}
  </section>`;
}

export function renderHealthHtml(state) {
  const h = state.healthData;
  const head = `<header class="page-head">
      <button class="btn-ghost" type="button" data-action="back-to-library" title="Back to the Library">← Library</button>
      <h1 class="page-head__title">Library health</h1>
      <div class="page-head__actions"><button class="btn-ghost" type="button" data-action="refresh-health"${state.healthLoading ? ' disabled' : ''}>${state.healthLoading ? 'Refreshing…' : 'Refresh'}</button></div>
    </header>`;
  if (!h) {
    return `<div class="page health">${head}<p class="view-hint">${state.healthLoading ? 'Checking the library…' : 'Could not load library health.'}</p></div>`;
  }
  const verifyBtn = (d) => `<button class="btn-outline btn-outline--sm" type="button" data-action="verify-health-doc" data-doc-id="${escapeHtml(d.id || '')}">Verify</button>`;
  return `<div class="page health">
      ${head}
      <p class="page-head__sub">Documents that may need attention — verify AI drafts, fill or delete stubs, refresh stale derivations, link orphans.</p>
      ${section('Needs review', h.needsReview, { empty: 'No unverified documents.', rowAction: verifyBtn, showTrust: true })}
      ${section('Empty stubs', h.empty, { empty: 'No empty documents.' })}
      ${section('Stale derivations', h.stale, { empty: 'No stale documents.' })}
      ${section('Orphans — no links', h.orphans, { empty: 'No orphaned documents.' })}
    </div>`;
}
