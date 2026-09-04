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

// Auto wiki-link suggestions: a plain-text mention of another doc's title that
// isn't linked yet. One click rewrites the first mention to a [[wiki-link]].
function suggestionsSection(suggestions) {
  const list = Array.isArray(suggestions) ? suggestions : [];
  const rows = list.slice(0, CAP).map((s) => `<div class="health-row health-suggest">
    <div class="health-suggest__body">
      <div class="health-suggest__head">
        <button class="health-row__title" type="button" data-action="open-health-doc" data-doc-id="${escapeHtml(s.sourceId || '')}">${escapeHtml(s.sourceTitle || 'Untitled')}</button>
        <span class="health-suggest__arrow">→ link</span>
        <span class="wikilink">${escapeHtml(s.targetTitle || '')}</span>
      </div>
      <div class="health-suggest__snippet">${escapeHtml(s.snippet?.pre || '')}<mark>${escapeHtml(s.snippet?.hit || '')}</mark>${escapeHtml(s.snippet?.post || '')}</div>
    </div>
    <button class="btn-outline btn-outline--sm" type="button" data-action="apply-wiki-link" data-doc-id="${escapeHtml(s.sourceId || '')}" data-title="${escapeHtml(s.targetTitle || '')}">Link</button>
  </div>`).join('');
  const more = list.length > CAP ? `<p class="health-more">and ${list.length - CAP} more…</p>` : '';
  const body = list.length ? `${rows}${more}` : '<p class="health-empty">✓ No unlinked mentions — the library is well cross-linked.</p>';
  return `<section class="health-card">
    <h2 class="health-card__title">Suggested links<span class="health-count${list.length ? '' : ' is-zero'}">${list.length}</span></h2>
    ${body}
  </section>`;
}

// AI review (Tier-2 #5, part 2): an on-demand, advisory contradiction + gap scan.
// Read-only — the only actions are opening a cited doc and re-running the scan.
function contradictionRow(c) {
  const sev = c.severity === 'high' ? '<span class="health-tag health-tag--warn">high</span>' : '<span class="health-tag">low</span>';
  const side = (d) => `<div class="aireview__side">
    <button class="health-row__title" type="button" data-action="open-health-doc" data-doc-id="${escapeHtml(d.id || '')}">${escapeHtml(d.title || 'Untitled')}</button>
    <blockquote class="aireview__quote"><mark>${escapeHtml(d.quote || '')}</mark></blockquote>
  </div>`;
  return `<div class="aireview__contradiction">
    <div class="aireview__issue">${sev}${escapeHtml(c.issue || 'Possible conflict')}</div>
    <div class="aireview__pair">${side(c.a || {})}${side(c.b || {})}</div>
  </div>`;
}

function aiReviewSection(state) {
  const r = state.healthAiReview;
  const hasModel = Boolean(state.chatStatus?.available);
  let body;
  if (state.healthAiReviewLoading) {
    body = '<p class="health-empty">Reading the library for conflicts and coverage gaps…</p>';
  } else if (state.healthAiReviewError) {
    body = `<p class="health-empty health-empty--error">${escapeHtml(state.healthAiReviewError)}</p>`;
  } else if (!r) {
    body = `<p class="aireview__intro">An AI model reads the library for <strong>conflicting documents</strong> and <strong>coverage gaps</strong>. Advisory only — nothing is changed. Costs model tokens; runs on demand.${hasModel ? '' : ' <span class="aireview__hint">No AI model configured — set one in Settings ▸ Intelligence.</span>'}</p>`;
  } else if (r.reason === 'ai-review-failed') {
    // Defensive: a crashed scan must never render as a green "all clear".
    body = '<p class="health-empty health-empty--error">The AI review could not complete. Please try again.</p>';
  } else if (r.contradictionScan?.reason === 'empty') {
    body = '<p class="health-empty">No documents to scan yet — add some to the library first.</p>';
  } else {
    // Contradictions
    const cNote = r.contradictionScan?.reason === 'no-embedder'
      ? '<p class="health-empty">Contradiction scan needs semantic search (embeddings) enabled — showing coverage gaps only.</p>'
      : r.contradictionScan?.reason === 'embed-failed'
        ? '<p class="health-empty">Contradiction scan could not read embeddings — showing coverage gaps only.</p>'
        : '';
    const contradictions = r.contradictions?.length
      ? r.contradictions.map(contradictionRow).join('')
      : (cNote || '<p class="health-empty">✓ No contradictions found among similar documents.</p>');
    // Gaps
    const gapNote = r.gapScan?.reason === 'generation-failed' ? '<p class="health-empty">Gap detection could not complete this run.</p>' : '';
    const gaps = r.gaps?.length
      ? r.gaps.map((g) => `<div class="aireview__gap"><div class="aireview__gap-topic">${escapeHtml(g.topic || '')}</div><div class="aireview__gap-why">${escapeHtml(g.rationale || '')}</div>${g.evidence ? `<div class="aireview__gap-ev">${escapeHtml(g.evidence)}</div>` : ''}</div>`).join('')
      : (gapNote || '<p class="health-empty">✓ No obvious coverage gaps.</p>');
    const banner = `<p class="aireview__banner">Agent-generated · advisory${r.model ? ` · ${escapeHtml(r.model)}` : ''} — suggestions to review; nothing has been changed.</p>`;
    body = `${banner}
      <h3 class="aireview__sub">Contradictions</h3>${cNote && r.contradictions?.length ? cNote : ''}${contradictions}
      <h3 class="aireview__sub">Coverage gaps</h3>${gaps}`;
  }
  return `<section class="health-card">
    <h2 class="health-card__title">AI review</h2>
    ${body}
  </section>`;
}

export function renderHealthHtml(state) {
  const h = state.healthData;
  const head = `<header class="page-head">
      <button class="btn-ghost" type="button" data-action="back-to-library" title="Back to the Library">← Library</button>
      <h1 class="page-head__title">Library health</h1>
      <div class="page-head__actions">
        <button class="btn-outline btn-outline--sm" type="button" data-action="run-ai-review"${state.healthAiReviewLoading || !state.chatStatus?.available ? ' disabled' : ''}${!state.chatStatus?.available ? ' title="Set an AI model in Settings ▸ Intelligence"' : ''}>${state.healthAiReviewLoading ? 'Scanning…' : 'Scan with AI'}</button>
        <button class="btn-ghost" type="button" data-action="refresh-health"${state.healthLoading ? ' disabled' : ''}>${state.healthLoading ? 'Refreshing…' : 'Refresh'}</button>
      </div>
    </header>`;
  if (!h) {
    return `<div class="page health">${head}<p class="view-hint">${state.healthLoading ? 'Checking the library…' : 'Could not load library health.'}</p></div>`;
  }
  const verifyBtn = (d) => `<button class="btn-outline btn-outline--sm" type="button" data-action="verify-health-doc" data-doc-id="${escapeHtml(d.id || '')}">Review</button>`;
  return `<div class="page health">
      ${head}
      <p class="page-head__sub">Documents that may need attention — verify AI drafts, fill or delete stubs, refresh stale derivations, link orphans.</p>
      ${section('Needs review', h.needsReview, { empty: 'No unverified documents.', rowAction: verifyBtn, showTrust: true })}
      ${section('Empty stubs', h.empty, { empty: 'No empty documents.' })}
      ${section('Stale derivations', h.stale, { empty: 'No stale documents.' })}
      ${section('Orphans — no links', h.orphans, { empty: 'No orphaned documents.' })}
      ${suggestionsSection(state.healthLinkSuggestions)}
      ${aiReviewSection(state)}
    </div>`;
}
