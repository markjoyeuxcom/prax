import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKDOWN_MODES, markdownRenderContext, renderMarkdownHtml } from '../../public/js/markdownPreview.js';

// The renderer's two modes, the older option flags that map onto them, and
// the inline token table that content cannot forge.

const resolveWikiLink = (title) => (title === 'Runbook' ? { id: 'doc-1', title: 'Runbook' } : null);
const REMOTE_IMAGE = '![chart](https://cdn.example/c.png)';
const TASKS = 'Intro\n\n- [ ] Renew cert\n- [x] Rotate keys';

// ---- modes -----------------------------------------------------------------

test('document mode loads remote images; task toggles need editable: true', () => {
  assert.equal(MARKDOWN_MODES.document, 'document');
  assert.match(renderMarkdownHtml(REMOTE_IMAGE, { mode: 'document' }), /<img src="https:\/\/cdn\.example\/c\.png" alt="chart" loading="lazy">/);
  assert.doesNotMatch(renderMarkdownHtml(TASKS, { mode: 'document' }), /data-action|role="checkbox"/);
  const editable = renderMarkdownHtml(TASKS, { mode: 'document', editable: true });
  assert.match(editable, /<li class="task-item" data-md-check data-line="2"><span class="task-item__toggle" data-action="toggle-md-check" data-line="2" role="checkbox"/);
});

test('untrusted mode keeps remote images and task items inert, whatever flags ride along', () => {
  assert.equal(MARKDOWN_MODES.untrusted, 'untrusted');
  for (const options of [{ mode: 'untrusted' }, { mode: 'untrusted', remoteImages: true, taskToggles: true, editable: true }]) {
    const image = renderMarkdownHtml(REMOTE_IMAGE, options);
    assert.doesNotMatch(image, /<img/);
    assert.match(image, /<span class="md-image-blocked" title="Remote image not loaded">\[image: chart — cdn\.example, not loaded\]<\/span>/);
    assert.doesNotMatch(renderMarkdownHtml(TASKS, options), /data-action|role="checkbox"|tabindex/);
  }
  // Same-page images still load: they cannot carry data off the machine.
  assert.match(renderMarkdownHtml('![x](/img/x.png)', { mode: 'untrusted' }), /<img src="\/img\/x\.png"/);
});

test('an unknown mode fails closed to untrusted', () => {
  assert.equal(markdownRenderContext({ mode: 'trusted' }).mode, 'untrusted');
  assert.doesNotMatch(renderMarkdownHtml(REMOTE_IMAGE, { mode: 'Document', remoteImages: true }), /<img/);
});

test('the older flags map onto the modes with the same output', () => {
  const corpus = [REMOTE_IMAGE, TASKS, 'See [[Runbook]] and [docs](https://ex.com/a__b) **now**', '| a | b |\n| --- | --- |\n| `x` | ![i](/i.png) |'];
  for (const md of corpus) {
    assert.equal(renderMarkdownHtml(md, { remoteImages: true, taskToggles: true, resolveWikiLink }),
      renderMarkdownHtml(md, { mode: 'document', editable: true, resolveWikiLink }), md);
    assert.equal(renderMarkdownHtml(md, { remoteImages: true, resolveWikiLink }), renderMarkdownHtml(md, { mode: 'document', resolveWikiLink }), md);
    assert.equal(renderMarkdownHtml(md, { resolveWikiLink }), renderMarkdownHtml(md, { mode: 'untrusted', resolveWikiLink }), md);
    assert.equal(renderMarkdownHtml(md), renderMarkdownHtml(md, { mode: 'untrusted' }), md);
  }
  assert.deepEqual(markdownRenderContext({}), { mode: 'untrusted', remoteImages: false, taskToggles: false, resolveWikiLink: null });
  assert.deepEqual(markdownRenderContext({ remoteImages: true, taskToggles: true }),
    { mode: 'document', remoteImages: true, taskToggles: true, resolveWikiLink: null });
  // A lone flag keeps its old meaning.
  assert.deepEqual(markdownRenderContext({ taskToggles: true }), { mode: 'untrusted', remoteImages: false, taskToggles: true, resolveWikiLink: null });
  assert.equal(markdownRenderContext({ remoteImages: 'yes' }).remoteImages, false, 'only true opts in');
});

test('links, emphasis and wiki-links render the same in both modes', () => {
  const md = '**see** [the **docs**](https://ex.com/a__b__c) and _this_, ~~old~~ [[Runbook]] [[Missing]] `code`';
  const expected = '<p><strong>see</strong> <a href="https://ex.com/a__b__c" rel="noreferrer">the <strong>docs</strong></a> and <em>this</em>, '
    + '<del>old</del> <a class="wikilink" data-action="open-doc" data-document-id="doc-1" href="#" title="Open Runbook">Runbook</a> '
    + '<span class="wikilink wikilink--missing" title="No document named this yet">Missing</span> <code>code</code></p>';
  assert.equal(renderMarkdownHtml(md, { mode: 'document', resolveWikiLink }), expected);
  assert.equal(renderMarkdownHtml(md, { mode: 'untrusted', resolveWikiLink }), expected);
});

// ---- inline tokens -----------------------------------------------------------

test('a NUL character cannot forge an inline token', () => {
  // The token table is keyed by U+0000<index>U+0000. Content that spells a
  // token must stay text: never pull generated HTML into another place.
  const forged = renderMarkdownHtml('![\u00001\u0000](/x.png) [a](http://e.example/y)', { mode: 'document' });
  assert.equal(forged, '<p><img src="/x.png" alt="1" loading="lazy"> <a href="http://e.example/y" rel="noreferrer">a</a></p>');
  assert.equal(renderMarkdownHtml('x \u00000\u0000 `y`'), '<p>x 0 <code>y</code></p>');
  for (const old of ['\u0000CODE0\u0000', '\u0000HTML0\u0000', '\u0000WIKI0\u0000']) {
    const html = renderMarkdownHtml(`${old} \`y\` [[Runbook]] [l](/p)`, { resolveWikiLink });
    assert.ok(!html.includes('\u0000'), html);
    assert.equal((html.match(/<code>y<\/code>/g) || []).length, 1, html);
  }
});

test('no input puts a NUL or markup into an attribute value', () => {
  const pieces = ['\u0000', '\u00000\u0000', '\u00001\u0000', '`c`', '[[Runbook]]', '[[x]]', '![a', '](', '/i.png', 'http://h.io/p', ')',
    '[', ']', '*', '_', '"', '<', '&', ' ', '\n', '- [ ] ', '|'];
  let seed = 11;
  const next = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let run = 0; run < 3000; run += 1) {
    let md = '';
    for (let i = 0, len = 1 + next(24); i < len; i += 1) md += pieces[next(pieces.length)];
    for (const mode of ['document', 'untrusted']) {
      const html = renderMarkdownHtml(md, { mode, editable: true, resolveWikiLink });
      assert.ok(!html.includes('\u0000'), JSON.stringify(md));
      for (const [, value] of html.matchAll(/ (?:alt|src|href|title|data-[\w-]+)="([^"]*)"/g)) {
        assert.ok(!value.includes('<'), `${JSON.stringify(md)} → ${html}`);
      }
    }
  }
});

test('an image alt holds the plain text of a code span or wiki-link, never its HTML', () => {
  assert.equal(renderMarkdownHtml('![`x`](/a.png)'), '<p><img src="/a.png" alt="x" loading="lazy"></p>');
  assert.equal(renderMarkdownHtml('![see [[Runbook]]](/a.png)', { resolveWikiLink }), '<p><img src="/a.png" alt="see Runbook" loading="lazy"></p>');
  // Blocked remote images keep the rendered label, as before.
  assert.match(renderMarkdownHtml('![`x`](https://h.example/a.png)'), /\[image: <code>x<\/code> — h\.example, not loaded\]/);
});

test('a code span or wiki-link inside a URL leaves the text as text', () => {
  assert.equal(renderMarkdownHtml('[a](http://x/`y`)'), '<p>[a](http://x/<code>y</code>)</p>');
  assert.doesNotMatch(renderMarkdownHtml('[a](http://x/[[Runbook]])', { resolveWikiLink }), /href="http/);
});

test('a code span inside a wiki-link is part of its title', () => {
  const seen = [];
  const html = renderMarkdownHtml('[[a `b` c]]', { resolveWikiLink: (title) => { seen.push(title); return null; } });
  assert.deepEqual(seen, ['a `b` c']);
  assert.equal(html, '<p><span class="wikilink wikilink--missing" title="No document named this yet">a `b` c</span></p>');
});
