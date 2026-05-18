import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdownHtml, titleFromMarkdown } from '../../public/js/markdownPreview.js';

test('renderMarkdownHtml renders headings paragraphs lists and code', () => {
  const html = renderMarkdownHtml(`# Restore Drill

Validate backups before upgrades.

- Check snapshot
- Restore into scratch cluster

\`\`\`
kubectl get pods
\`\`\``);

  assert.match(html, /<h1>Restore Drill<\/h1>/);
  assert.match(html, /<p>Validate backups before upgrades\.<\/p>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<li>Check snapshot<\/li>/);
  assert.match(html, /<pre><code>kubectl get pods<\/code><\/pre>/);
});

test('renderMarkdownHtml escapes HTML before rendering', () => {
  const html = renderMarkdownHtml('# <script>alert("x")</script>');

  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('titleFromMarkdown prefers first heading then filename then fallback', () => {
  assert.equal(titleFromMarkdown('## Cluster Restore', 'restore.md'), 'Cluster Restore');
  assert.equal(titleFromMarkdown('No heading', 'ingress-notes.md'), 'ingress-notes');
  assert.equal(titleFromMarkdown('', ''), 'Untitled document');
});
