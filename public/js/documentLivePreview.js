import { renderMarkdownHtml } from './markdownPreview.js';

export function updateDocumentLivePreview(workspace, markdown) {
  const preview = workspace?.querySelector?.('.markdown-preview');
  if (!preview) return false;

  preview.innerHTML = renderMarkdownHtml(markdown);
  return true;
}
