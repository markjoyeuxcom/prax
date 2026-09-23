import { renderMarkdownHtml } from './markdownPreview.js';

// Re-render the preview pane in place while typing in split mode. Returns
// false when no preview pane is mounted (edit-only mode) so callers can skip.
// `options` is forwarded to renderMarkdownHtml (e.g. { mode: 'document',
// editable, resolveWikiLink }, or the older remoteImages/taskToggles flags).
export function updateDocumentLivePreview(workspace, markdown, options = {}) {
  const preview = workspace?.querySelector?.('[data-markdown-preview]');
  if (!preview) return false;

  preview.innerHTML = renderMarkdownHtml(markdown, options);
  return true;
}
