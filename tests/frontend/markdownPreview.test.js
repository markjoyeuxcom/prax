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
  // Prax renders task items as clickable rows (main.js rewrites the source
  // line via data-line) instead of the old disabled checkboxes.
  assert.match(html, /class="task-item is-done" data-md-check data-line="\d+"/);
  assert.match(html, /task-item__box">✓</);
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

// ---- wiki-links --------------------------------------------------------------

test('renderMarkdownHtml resolves [[wiki-links]] to a clickable doc link', () => {
  const resolveWikiLink = (title) => (title === 'Runbook' ? { id: 'doc-1', title: 'Runbook' } : null);
  const html = renderMarkdownHtml('See [[Runbook]] for steps.', { resolveWikiLink });
  assert.match(html, /<a class="wikilink" data-action="open-doc" data-document-id="doc-1"[^>]*>Runbook<\/a>/);
});

test('renderMarkdownHtml renders an unresolved [[wiki-link]] as a muted missing span', () => {
  const html = renderMarkdownHtml('See [[Nonexistent]] here.', { resolveWikiLink: () => null });
  assert.match(html, /<span class="wikilink wikilink--missing"[^>]*>Nonexistent<\/span>/);
  assert.doesNotMatch(html, /data-action="open-doc"/);
});

test('renderMarkdownHtml treats [[wiki-links]] as missing when no resolver is given', () => {
  const html = renderMarkdownHtml('A [[Doc]] link.');
  assert.match(html, /wikilink--missing/);
});

test('renderMarkdownHtml escapes wiki-link titles', () => {
  const html = renderMarkdownHtml('[[<script>x</script>]]', { resolveWikiLink: () => null });
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
});

test('renderMarkdownHtml resolves wiki-links whose titles contain & \' " < >', () => {
  // The resolver must see the RAW title, not the HTML-escaped one — otherwise
  // common titles (apostrophes, ampersands) never match.
  const docs = { "mark's notes": { id: 'd1', title: "Mark's Notes" }, 'q&a': { id: 'd2', title: 'Q&A' } };
  const resolveWikiLink = (title) => docs[title.trim().toLowerCase()] || null;
  const html = renderMarkdownHtml("See [[Mark's Notes]] and [[Q&A]].", { resolveWikiLink });
  assert.match(html, /data-document-id="d1"[^>]*>Mark&#39;s Notes<\/a>/);
  assert.match(html, /data-document-id="d2"[^>]*>Q&amp;A<\/a>/);
  assert.doesNotMatch(html, /wikilink--missing/);
  assert.ok(!html.includes('<script>'));
});
