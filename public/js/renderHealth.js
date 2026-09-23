import { escapeHtml } from './html.js';

// Library health view — a curation dashboard of documents that may need
// attention: unverified AI drafts to review, empty stubs, and stale
// derivations. Pure state->HTML; rows dispatch data-action clicks.
const CAP = 20;

// `showTrust` is only set where the row's verified/updatedBy are accurate (the
// listDocuments-sourced sections) — stale rows come from a query that doesn't
// select those fields, so their trust tags would be misleading.
function docRow(doc, rowAction, showTrust) {
  const agent = showTrust && doc.updatedBy === 'agent' ? '<span class="health-tag">agent-written</span>' : '';
  const unver = showTrust && !doc.verified ? '<span class="health-tag health-tag--warn">unverified</span>' : '';
  // Present only when the list was fetched with sort=recall.
  const recalled = Number.isFinite(doc.recallHits) ? `<span class="health-tag">recalled ${escapeHtml(doc.recallHits)}×</span>` : '';
  return `<div class="health-row">
    <button class="health-row__title" type="button" data-action="open-health-doc" data-doc-id="${escapeHtml(doc.id || '')}">${escapeHtml(doc.title || 'Untitled')}</button>
    <span class="health-row__meta">${escapeHtml(doc.documentType || 'note')}${agent}${unver}${recalled}</span>
    ${rowAction ? rowAction(doc) : '' /* html-safe: rowAction is verifyBtn below, which escapes */}
  </div>`;
}

function section(title, docs, { empty, rowAction, showTrust = false, headAction = '' } = {}) {
  const list = Array.isArray(docs) ? docs : [];
  const shown = list.slice(0, CAP).map((d) => docRow(d, rowAction, showTrust)).join('');
  const more = list.length > CAP ? `<p class="health-more">and ${list.length - CAP} more…</p>` : '';
  const body = list.length ? `${shown}${more}` : `<p class="health-empty">✓ ${escapeHtml(empty)}</p>`;
  return `<section class="health-card">
    <h2 class="health-card__title">${escapeHtml(title)}<span class="health-count${list.length ? '' : ' is-zero'}">${list.length}</span>${headAction /* html-safe: reviewSortToggle builds it with escaped values */}</h2>
    ${body}
  </section>`;
}

// Opt-in: order the review list by how often agents' recalls returned each
// document. The default order is the one every other consumer sees.
function reviewSortToggle(state) {
  const on = state.healthReviewSort === 'recall';
  return `<button class="btn-ghost health-card__action" type="button" data-action="toggle-health-review-sort" aria-pressed="${on ? 'true' : 'false'}">${on ? 'Most recalled first' : 'Sort by recall'}</button>`;
}

// ---- Librarian (docs/superpowers/specs/2026-09-23-librarian-design.md) --------
// Consolidation proposals (drafted, never applied without a person), the
// questions memory could not answer, and never-recalled agent memories.

function proposalRow(p) {
  const trust = p.verified
    ? '<span class="health-tag">verified</span>'
    : '<span class="health-tag health-tag--warn">unverified</span>';
  const approve = p.verified
    ? `<button class="btn-outline btn-outline--sm" type="button" data-action="decide-proposal" data-decision="approve" data-proposal-id="${escapeHtml(p.documentId || '')}">Approve</button>`
    : `<button class="btn-outline btn-outline--sm" type="button" data-action="verify-health-doc" data-doc-id="${escapeHtml(p.documentId || '')}" title="Read the draft and verify it; then approve it here">Review</button>`;
  return `<div class="health-row librarian-proposal">
    <button class="health-row__title" type="button" data-action="open-health-doc" data-doc-id="${escapeHtml(p.documentId || '')}">${escapeHtml(p.title || 'Untitled proposal')}</button>
    <span class="health-row__meta">${escapeHtml((p.sourceIds || []).length)} sources · ${escapeHtml(p.method || '')}${trust}</span>
    <span class="librarian-proposal__actions">${approve}<button class="btn-ghost" type="button" data-action="decide-proposal" data-decision="dismiss" data-proposal-id="${escapeHtml(p.documentId || '')}">Dismiss</button></span>
  </div>`;
}

function gapRow(g) {
  const why = g.reason === 'no-hits' ? 'no hits' : 'hits never used';
  const who = (g.agents || []).length ? ` · ${escapeHtml(g.agents.join(', '))}` : '';
  return `<div class="health-row librarian-gap">
    <span class="librarian-gap__query">${escapeHtml(g.query || '')}</span>
    <span class="health-row__meta">asked ${escapeHtml(g.occurrences)}× · ${escapeHtml(why)}${who}</span>
  </div>`;
}

export function librarianSection(state) {
  const lib = state.librarian;
  const running = Boolean(state.librarianRunning);
  const schedule = Boolean(lib?.settings?.scheduleEnabled);
  const telemetryOn = lib?.settings ? lib.settings.telemetryEnabled !== false : true;
  const head = `<div class="librarian__actions">
      <button class="btn-outline btn-outline--sm" type="button" data-action="run-librarian"${running ? ' disabled' : ''}>${running ? 'Running…' : 'Run librarian'}</button>
      <label class="librarian__schedule"><input type="checkbox" data-action="toggle-librarian-schedule"${schedule ? ' checked' : ''}${lib?.settings ? '' : ' disabled'}> Run daily</label>
    </div>`;
  const lastRun = state.librarianLastRun;
  const last = lastRun
    ? `<p class="health-empty">Last run: ${escapeHtml(lastRun.clusters)} cluster(s) by ${escapeHtml(lastRun.method === 'embedding' ? 'embeddings' : 'shingles')}, ${escapeHtml(lastRun.created)} new proposal(s).</p>`
    : '';
  const proposals = Array.isArray(lib?.proposals) ? lib.proposals : null;
  let proposalBody;
  if (proposals === null) proposalBody = '<p class="health-empty">Proposals could not be loaded.</p>';
  else if (!proposals.length) proposalBody = '<p class="health-empty">✓ No open proposals. Run the librarian to look for near-duplicates.</p>';
  else proposalBody = proposals.slice(0, CAP).map(proposalRow).join('');
  const gaps = Array.isArray(lib?.gaps?.items) ? lib.gaps.items : null;
  let gapBody;
  if (!telemetryOn) gapBody = '<p class="health-empty">Recall telemetry is off on this server (PRAX_RECALL_TELEMETRY=off).</p>';
  else if (gaps === null) gapBody = '<p class="health-empty">Knowledge gaps could not be loaded.</p>';
  else if (!gaps.length) gapBody = '<p class="health-empty">✓ No unanswered questions recorded.</p>';
  else gapBody = gaps.slice(0, CAP).map(gapRow).join('');
  const usedHint = gaps !== null && telemetryOn && !lib?.gaps?.usedSignals
    ? '<p class="librarian__hint">Only questions with no hits are listed until agents report use with <code>prax used &lt;id&gt;</code>.</p>'
    : '';
  const prune = lib?.prune;
  let pruneBody;
  if (!prune) pruneBody = '<p class="health-empty">Prune candidates could not be loaded.</p>';
  else if (!prune.ready) pruneBody = `<p class="health-empty">Needs ${escapeHtml(prune.minAgeDays)} days of recall telemetry (have ${escapeHtml(prune.coverageDays)}).</p>`;
  else if (!prune.items.length) pruneBody = '<p class="health-empty">✓ Every agent memory was recalled recently.</p>';
  else pruneBody = prune.items.slice(0, CAP).map((d) => docRow(d, null, false)).join('');
  const proposalCount = proposals ? proposals.length : 0;
  const gapCount = gaps ? gaps.length : 0;
  const pruneCount = prune?.items ? prune.items.length : 0;
  return `<section class="health-card librarian" aria-label="Librarian">
    <h2 class="health-card__title">Librarian</h2>
    <p class="aireview__intro">Finds near-duplicate documents and drafts one <strong>proposal</strong> per group for you to review. Nothing is merged or retired until you verify a proposal and approve it. Recall telemetry stays on this machine.</p>
    ${head}
    ${last}
    <h3 class="aireview__sub">Consolidation proposals<span class="health-count${proposalCount ? '' : ' is-zero'}">${escapeHtml(proposalCount)}</span></h3>
    ${proposalBody}
    <h3 class="aireview__sub">Knowledge gaps<span class="health-count${gapCount ? '' : ' is-zero'}">${escapeHtml(gapCount)}</span></h3>
    ${usedHint}
    ${gapBody}
    <h3 class="aireview__sub">Never recalled<span class="health-count${pruneCount ? '' : ' is-zero'}">${escapeHtml(pruneCount)}</span></h3>
    ${pruneBody}
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
      <p class="page-head__sub">Documents that may need attention — verify AI drafts, fill or delete stubs, and refresh stale derivations.</p>
      ${section('Needs review', h.needsReview, { empty: 'No unverified documents.', rowAction: verifyBtn, showTrust: true, headAction: reviewSortToggle(state) })}
      ${section('Empty stubs', h.empty, { empty: 'No empty documents.' })}
      ${section('Stale derivations', h.stale, { empty: 'No stale documents.' })}
      ${suggestionsSection(state.healthLinkSuggestions)}
      ${librarianSection(state)}
      ${aiReviewSection(state)}
    </div>`;
}
