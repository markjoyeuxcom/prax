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

test('renderMarkdownHtml supports implementation-plan Markdown patterns', () => {
  const html = renderMarkdownHtml(`> **For workers:** Use \`subagent\`.

**Goal:** Open [Cloudflare](https://dash.cloudflare.com).

1. First step
2. Second step

- [ ] Pending task
- [x] Done task

| Name | Value |
| --- | --- |
| Tunnel | Enabled |

---

\`\`\`bash
cloudflared tunnel list
\`\`\``);

  assert.match(html, /<blockquote><p><strong>For workers:<\/strong> Use <code>subagent<\/code>\.<\/p><\/blockquote>/);
  assert.match(html, /<strong>Goal:<\/strong>/);
  assert.match(html, /<a href="https:\/\/dash.cloudflare.com" rel="noreferrer">Cloudflare<\/a>/);
  assert.match(html, /<ol>/);
  assert.match(html, /<li>First step<\/li>/);
  assert.match(html, /type="checkbox" disabled/);
  assert.match(html, /checked/);
  assert.match(html, /<table>/);
  assert.match(html, /<th>Name<\/th>/);
  assert.match(html, /<td>Enabled<\/td>/);
  assert.match(html, /<hr>/);
  assert.match(html, /<pre><code data-language="bash">cloudflared tunnel list<\/code><\/pre>/);
});

test('titleFromMarkdown prefers first heading then filename then fallback', () => {
  assert.equal(titleFromMarkdown('## Cluster Restore', 'restore.md'), 'Cluster Restore');
  assert.equal(titleFromMarkdown('No heading', 'ingress-notes.md'), 'ingress-notes');
  assert.equal(titleFromMarkdown('', ''), 'Untitled document');
});
