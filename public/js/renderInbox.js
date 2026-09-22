import { escapeHtml } from './renderHelpers.js';
import { DOCUMENT_TYPES } from './documentTypes.js';
import { localDateOf } from './dateHelpers.js';

const esc = escapeHtml;
export function renderInboxSummary(inbox = {}) {
  const summary = inbox.summary;
  return `<section class="inbox-summary" aria-label="Inbox processing">
    <div><strong>${summary ? `${summary.total} to process` : 'Inbox captures'}</strong>
      <p>${summary ? `${summary.tasks} tasks · ${summary.notes} notes${summary.total ? ` · oldest ${summary.oldestDays} days · ${summary.olderThanWeek} at least a week old` : ''}` : 'File captures into their owning projects. Saved weekly reviews stay separate.'}</p></div>
    <div class="inbox-summary__actions"><button class="btn-primary" type="button" data-action="inbox-start">Process Inbox</button>
      ${inbox.undo ? `<button class="btn-outline" type="button" data-action="inbox-undo"${inbox.undoPending ? ' disabled' : ''}>${inbox.undoPending ? 'Undoing…' : 'Undo last decision'}</button>` : ''}</div>
    ${inbox.undo ? `<p class="inbox-summary__last">Last decision: ${esc(inbox.undo.title)}</p>` : ''}
    ${inbox.notice ? `<p class="inbox-summary__last" role="status">${esc(inbox.notice)}</p>` : ''}
  </section>`;
}

export function renderInboxView(inbox = {}) {
  const reviews = inbox.view === 'reviews', data = inbox.data;
  const items = data?.items || [];
  return `<section class="inbox-view" aria-label="${reviews ? 'Saved reviews' : 'Items to process'}">
    <p class="view-hint">${reviews ? 'Saved workspace reviews. These do not count as unprocessed captures.' : 'Open tasks and loose notes, oldest first. Skipped items remain here until filed, completed or archived.'}</p>
    ${inbox.error ? `<p role="alert">${esc(inbox.error)} <button class="btn-outline" data-action="inbox-reload">Retry</button></p>` : ''}
    ${inbox.loading ? '<p role="status">Loading Inbox…</p>' : ''}
    <div class="inbox-items">${items.map(item => `<article class="inbox-item">
      <div><button class="inbox-item__title" type="button" data-action="inbox-open" data-kind="${item.kind}" data-id="${esc(item.id)}">${esc(item.title)}</button>
        <p>${reviews ? 'Weekly review' : item.kind === 'task' ? 'Task' : 'Note'} · ${item.ageDays} days old</p>
        <p class="inbox-item__preview">${esc(item.preview)}</p></div>
      ${reviews ? '' : `<button class="btn-outline" type="button" data-action="inbox-start" data-kind="${item.kind}" data-id="${esc(item.id)}" aria-label="Process ${esc(item.title)}">Process</button>`}
    </article>`).join('')}</div>
    ${!items.length && !inbox.loading && !inbox.error ? `<p class="view-hint">${reviews ? 'No saved weekly reviews yet.' : 'No captures waiting to be processed.'}</p>` : ''}
    ${data ? `<p class="view-hint">Showing ${items.length} of ${data.page.total}${data.page.hasMore ? ' <button class="btn-outline" data-action="inbox-more">Load more</button>' : ''}</p>` : ''}
  </section>`;
}

export function renderInboxDialog(inbox = {}) {
  const p = inbox.processing;
  if (!p) return '';
  const record = p.source?.record;
  const disabled = p.pending || Boolean(p.request) ? ' disabled' : '';
  const projects = inbox.data?.projects || [];
  const sourceText = !record ? '' : p.kind === 'task' ? [record.description, record.notes,
    record.checklist?.map(item => `- [${item.completed ? 'x' : ' '}] ${item.label}`).join('\n')].filter(Boolean).join('\n\n') : record.body;
  const suggestion = p.suggestion;
  const destination = suggestion && projects.find(project => project.id === suggestion.projectId);
  return `<div class="overlay-center" data-overlay="inbox">
    <section class="inbox-dialog" role="dialog" aria-modal="true" aria-labelledby="inbox-dialog-title" data-inbox-dialog tabindex="-1">
      <header><div><h2 id="inbox-dialog-title">Process Inbox</h2><p>${p.index + 1} of ${p.queue.length} in this pass</p></div>
        <button class="btn-ghost" type="button" data-action="inbox-close" aria-label="Close Inbox processing"${p.pending ? ' disabled' : ''}>×</button></header>
      ${p.recovered ? '<p role="status">Recovered unfinished decision. Review the current item before applying.</p>' : ''}
      ${p.request && !p.pending ? '<p role="alert">A previous request is unconfirmed. Retry that same decision to check its result.</p>' : ''}
      ${p.storageWarning ? `<p role="alert">${esc(p.storageWarning)}</p>` : ''}
      ${p.error ? `<p role="alert">${esc(p.error)}</p>` : ''}
      ${p.loading ? '<p role="status">Loading item…</p>' : ''}
      ${record ? `<h3>${esc(record.title)}</h3><p>${p.kind === 'task' ? 'Task' : esc(record.documentType)} · captured ${esc(localDateOf(record.createdAt))}</p>
        <pre class="inbox-source" tabindex="0" aria-label="Captured content">${esc(sourceText || record.title)}</pre>
        <div class="inbox-fields"><label>Owning project<select data-inbox-field="projectId"${disabled}><option value="">Choose a project</option>${projects.map(project => `<option value="${esc(project.id)}"${p.draft.projectId === project.id ? ' selected' : ''}>${esc(project.name)}</option>`).join('')}</select></label>
        ${p.kind === 'task' ? `<label>Plan for (optional)<input type="date" data-inbox-field="plannedFor" value="${esc(p.draft.plannedFor || '')}"${disabled}></label>`
          : `<label>Document type<select data-inbox-field="documentType"${disabled}>${DOCUMENT_TYPES.map(type => `<option value="${type.value}"${p.draft.documentType === type.value ? ' selected' : ''}>${esc(type.label)}</option>`).join('')}</select></label>`}</div>
        <div class="inbox-assist"><button class="btn-outline" type="button" data-action="inbox-suggest"${disabled || (p.suggesting ? ' disabled' : '')}>${p.suggesting ? 'Asking the model…' : 'Suggest filing with AI'}</button>
          <p>Uses your configured answer model. Suggestions do not change any item.</p>
          ${suggestion ? `<div class="inbox-suggestion"><h3>Suggested filing</h3><p>${destination ? esc(destination.name) : 'No destination suggested'}${suggestion.documentType ? ` · ${esc(suggestion.documentType)}` : ''}</p><p>${esc(suggestion.reason)}</p>
            <button class="btn-outline" type="button" data-action="inbox-use-suggestion"${disabled}>Use suggestion in form</button>
            <p>Reviewed ${suggestion.coverage.projectsShown} of ${suggestion.coverage.projectsTotal} projects and ${suggestion.coverage.candidatesShown} of ${suggestion.coverage.candidatesTotal} possible matches.${suggestion.coverage.sourceTruncated ? ' Only the first 8,000 characters of this item were sent.' : ''}</p>
            ${suggestion.duplicates.length ? `<h3>Possible duplicates — review before deciding</h3>${suggestion.duplicates.map(item => `<p><button class="btn-ghost" type="button" data-action="inbox-open" data-kind="${item.kind}" data-id="${esc(item.id)}">${esc(item.title)}</button> ${esc(item.reason)}</p>`).join('')}` : '<p>No duplicate suggested within the candidates reviewed.</p>'}</div>` : ''}</div>
        <div class="inbox-decisions">${p.request ? '' : `<button class="btn-primary" type="button" data-action="inbox-file">${p.kind === 'task' ? 'File task' : 'File note'}</button>
            <button class="btn-outline" type="button" data-action="inbox-reference">Keep as reference</button>
            ${p.kind === 'task' ? '<button class="btn-outline" type="button" data-action="inbox-complete">Complete task</button>' : ''}
            <button class="btn-outline" type="button" data-action="inbox-archive">Archive</button>`}</div>
        ${p.kind === 'task' ? '<p class="view-hint">Keep as reference saves an unverified linked note in the chosen project and archives this task. Undo restores the task and keeps the reference in Archive.</p>' : ''}` : ''}
      ${p.request ? `<button class="btn-primary" type="button" data-action="inbox-retry"${p.pending ? ' disabled' : ''}>${p.pending ? 'Saving…' : 'Retry same decision'}</button>` : ''}
      <footer><button class="btn-ghost" type="button" data-action="inbox-skip"${disabled}>Skip for now</button><button class="btn-ghost" type="button" data-action="inbox-item-reload"${disabled}>Reload item</button><span>Close keeps an unfinished decision on this tab.</span></footer>
    </section></div>`;
}
