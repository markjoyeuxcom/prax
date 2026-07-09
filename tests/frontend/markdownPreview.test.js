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

// ---- nested lists ------------------------------------------------------------

test('renderMarkdownHtml nests indented bullets under an ordered item without renumbering', () => {
  const md = [
    '1. First',
    '2. Second:',
    '  - sub a',
    '  - sub b',
    '3. Third',
  ].join('\n');
  const html = renderMarkdownHtml(md);
  // Exactly three top-level <ol> items; the sub-bullets are a nested <ul>.
  const ol = html.match(/<ol>([\s\S]*)<\/ol>/)[1];
  const topLevelLis = ol.replace(/<ul>[\s\S]*?<\/ul>/g, '').match(/<li>/g) || [];
  assert.equal(topLevelLis.length, 3);
  assert.match(html, /<li>Second:<ul><li>sub a<\/li><li>sub b<\/li><\/ul><\/li>/);
  assert.match(html, /<li>Third<\/li><\/ol>/);
});

test('renderMarkdownHtml keeps a contiguous ordered then unordered block as two lists', () => {
  const html = renderMarkdownHtml('1. one\n2. two\n- a\n- b');
  assert.match(html, /<ol><li>one<\/li><li>two<\/li><\/ol><ul><li>a<\/li><li>b<\/li><\/ul>/);
});

test('renderMarkdownHtml nests deeper levels and returns to shallower ones', () => {
  const md = ['- top', '  - mid', '    - deep', '- top2'].join('\n');
  const html = renderMarkdownHtml(md);
  assert.match(html, /<ul><li>top<ul><li>mid<ul><li>deep<\/li><\/ul><\/li><\/ul><\/li><li>top2<\/li><\/ul>/);
});

// ---- images, strikethrough, underscore emphasis ------------------------------

test('renderMarkdownHtml renders images (relative + http) with escaped alt and lazy loading', () => {
  assert.match(renderMarkdownHtml('![logo](/img/x.png)'), /<img src="\/img\/x\.png" alt="logo" loading="lazy">/);
  assert.match(renderMarkdownHtml('![a](https://ex.com/y.png)'), /<img src="https:\/\/ex\.com\/y\.png" alt="a" loading="lazy">/);
});

test('renderMarkdownHtml does not create an image for a javascript: (or other) unsafe src', () => {
  const html = renderMarkdownHtml('![x](javascript:alert(1))');
  assert.doesNotMatch(html, /<img/);
  assert.ok(!html.includes('javascript:alert(1)') || html.includes('!['));
});

test('renderMarkdownHtml renders ~~strikethrough~~ as <del>', () => {
  assert.match(renderMarkdownHtml('this is ~~gone~~ now'), /this is <del>gone<\/del> now/);
});

test('renderMarkdownHtml renders _underscore_ and __underscore__ emphasis', () => {
  assert.match(renderMarkdownHtml('an _emphasised_ word'), /an <em>emphasised<\/em> word/);
  assert.match(renderMarkdownHtml('a __strong__ word'), /a <strong>strong<\/strong> word/);
});

test('renderMarkdownHtml leaves snake_case identifiers and underscored paths untouched', () => {
  assert.match(renderMarkdownHtml('my_var_name stays plain'), /my_var_name stays plain/);
  assert.doesNotMatch(renderMarkdownHtml('my_var_name stays plain'), /<em>|<strong>/);
  assert.match(renderMarkdownHtml('see /etc/foo_bar_baz/x here'), /\/etc\/foo_bar_baz\/x/);
  assert.doesNotMatch(renderMarkdownHtml('see /etc/foo_bar_baz/x here'), /<em>|<strong>/);
});

test('renderMarkdownHtml keeps asterisk bold/italic working alongside the underscore rules', () => {
  assert.match(renderMarkdownHtml('keep **star** and *em* going'), /keep <strong>star<\/strong> and <em>em<\/em> going/);
});

test('renderMarkdownHtml renders an inline code span containing $-patterns literally', () => {
  // A string replacement arg would expand `$&` in the escaped HTML into the
  // matched placeholder token and leak a NUL sentinel; the function replacer
  // must insert the code verbatim.
  const html = renderMarkdownHtml('Use `sed s/$&/x/` daily.');
  assert.match(html, /<code>sed s\/\$&amp;\/x\/<\/code>/);
  assert.ok(!html.includes('\u0000'));
});

test('renderMarkdownHtml resolves a [[wiki-link]] whose title contains $ without corruption', () => {
  const resolveWikiLink = (title) => (title === 'A$&B' ? { id: 'doc-9', title: 'A$&B' } : null);
  const html = renderMarkdownHtml('See [[A$&B]] here.', { resolveWikiLink });
  assert.match(html, /data-document-id="doc-9"/);
  assert.match(html, />A\$&amp;B<\/a>/);
  assert.ok(!html.includes('\u0000'));
});


test('renderMarkdownHtml wraps a fenced code block with a language label and a Copy button', () => {
  const html = renderMarkdownHtml('```bash\nkubectl get pods\n```');
  assert.match(html, /class="code-block"/);
  assert.match(html, /class="code-block__lang">bash</);
  assert.match(html, /data-action="copy-code"[^>]*>Copy</);
  // The inner <pre><code data-language> shape is unchanged.
  assert.match(html, /<pre><code data-language="bash">kubectl get pods<\/code><\/pre>/);
});

test('a fenced code block without a language still gets a Copy button and an empty label', () => {
  const html = renderMarkdownHtml('```\nplain text\n```');
  assert.match(html, /class="code-block__lang"><\/span>/);
  assert.match(html, /data-action="copy-code"/);
  assert.match(html, /<pre><code>plain text<\/code><\/pre>/);
});

// ---------------------------------------------------------------------------
// Table-detection misfire: a line containing a shell pipe ("|") that is really
// a list/task/heading/blockquote/ordered item must NOT be captured as a table
// row (which failed validation and dumped the line into a <p> as literal text).
// The guard is applied only to the table START, so genuine borderless tables
// whose data cell begins with a marker keep working. See markdownPreview.js.
// ---------------------------------------------------------------------------

test('task item with a shell pipe stays a task (not a <p>/table)', () => {
  const html = renderMarkdownHtml('- [ ] Identify the pod: `kubectl get pods -A | grep foo`');
  assert.match(html, /class="task-item"/);
  assert.match(html, /kubectl get pods -A \| grep foo/);
  assert.ok(!html.includes('<p>'), `unexpected paragraph: ${html}`);
});

test('checked task with a pipe renders the done box', () => {
  const html = renderMarkdownHtml('- [x] cat access.log | grep 500');
  assert.match(html, /class="task-item is-done"/);
  assert.match(html, /task-item__box">✓<\/span>/);
  assert.ok(!html.includes('<p>'));
});

test('a pipe in the MIDDLE item does not split one task list into pieces', () => {
  const html = renderMarkdownHtml('- [ ] first task\n- [ ] run foo | bar\n- [ ] third task');
  // exactly one <ul>, all three items present, no stray paragraph
  assert.equal(html.match(/<ul>/g)?.length, 1, `expected one <ul>: ${html}`);
  assert.match(html, /first task/);
  assert.match(html, /run foo \| bar/);
  assert.match(html, /third task/);
  assert.ok(!html.includes('<p>'));
});

test('plain unordered/ordered list items with a pipe stay lists', () => {
  assert.match(renderMarkdownHtml('- kubectl get pods | grep x'), /<ul><li>kubectl get pods \| grep x<\/li><\/ul>/);
  assert.match(renderMarkdownHtml('1. Pipe stdout | into file'), /<ol><li>Pipe stdout \| into file<\/li><\/ol>/);
  assert.match(renderMarkdownHtml('* grep foo | sort'), /<ul><li>grep foo \| sort<\/li><\/ul>/);
});

test('heading and blockquote containing a pipe keep their block type', () => {
  assert.match(renderMarkdownHtml('# Section A | Section B'), /<h1>Section A \| Section B<\/h1>/);
  const bq = renderMarkdownHtml('> note foo | bar');
  assert.match(bq, /<blockquote><p>note foo \| bar<\/p><\/blockquote>/);
  assert.ok(!bq.includes('<table>'));
});

test('a list item that is entirely a pipe-bearing code span stays a list', () => {
  const html = renderMarkdownHtml('- `kubectl get pods | grep Running`');
  assert.match(html, /<ul><li><code>kubectl get pods \| grep Running<\/code><\/li><\/ul>/);
  assert.ok(!html.includes('<p>'));
});

// ---- must-preserve: real tables (incl. the red-team's marker-first-cell cases) ----

test('PRESERVE: a basic bordered GFM table still renders as a table', () => {
  const html = renderMarkdownHtml('| Col A | Col B |\n| --- | --- |\n| 1 | 2 |');
  assert.match(html, /<table><thead><tr><th>Col A<\/th><th>Col B<\/th><\/tr><\/thead>/);
  assert.match(html, /<tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody>/);
  assert.ok(!html.includes('<p>'));
});

test('PRESERVE: borderless table whose data cell begins with a dash/plus marker', () => {
  // Regression guard: the earlier (rejected) fix corrupted this into an empty
  // <tbody> + a stray <ul>. The start-only guard keeps it a real table.
  const html = renderMarkdownHtml('Sign | Meaning\n--- | ---\n- | negative\n+ | positive');
  assert.match(html, /<tbody><tr><td>-<\/td><td>negative<\/td><\/tr><tr><td>\+<\/td><td>positive<\/td><\/tr><\/tbody>/);
  assert.ok(!html.includes('<ul>'), `marker-first cell must not become a list: ${html}`);
});

test('PRESERVE: borderless table whose data cell begins with an "N." ordered marker', () => {
  const html = renderMarkdownHtml('Step | Action\n---- | ------\n1. | Start\n2. | Stop');
  assert.match(html, /<tbody><tr><td>1\.<\/td><td>Start<\/td><\/tr><tr><td>2\.<\/td><td>Stop<\/td><\/tr><\/tbody>/);
  assert.ok(!html.includes('<ol>'), `digit-dot cell must not become an ordered list: ${html}`);
});

test('PRESERVE: a task ending in a colon or code span (no pipe) is still a task', () => {
  assert.match(renderMarkdownHtml('- [ ] Configure the following:'), /class="task-item"/);
  const code = renderMarkdownHtml('- [ ] Run `npm test`\n- [ ] Then `npm run build`');
  assert.match(code, /Run <code>npm test<\/code>/);
  assert.match(code, /Then <code>npm run build<\/code>/);
  assert.ok(!code.includes('<p>'));
});
