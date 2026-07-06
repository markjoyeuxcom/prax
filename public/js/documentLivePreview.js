import { renderMarkdownHtml } from './markdownPreview.js';

// Re-render the preview pane in place while typing in split mode. Returns
// false when no preview pane is mounted (edit-only mode) so callers can skip.
export function updateDocumentLivePreview(workspace, markdown) {
  const preview = workspace?.querySelector?.('[data-markdown-preview]');
  if (!preview) return false;

  preview.innerHTML = renderMarkdownHtml(markdown);
  return true;
}
