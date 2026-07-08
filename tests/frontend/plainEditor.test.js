import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightMarkdown, findMatches } from '../../public/js/plainEditor.js';

test('highlightMarkdown wraps one data-ln div per line, preserving text', () => {
  const html = highlightMarkdown('# Title\n\n- [ ] step\n');
  // 4 lines (trailing newline → empty last line)
  assert.equal((html.match(/class="pe__line"/g) || []).length, 4);
  assert.match(html, /data-ln="1"/);
  assert.match(html, /data-ln="4"/);
  // heading + list marker tokens
  assert.match(html, /pe-t-heading">#\sTitle/);
  assert.match(html, /pe-t-marker">- \[ \] </);
});

test('highlightMarkdown escapes HTML so text length is preserved (alignment)', () => {
  const html = highlightMarkdown('a <b> & c');
  assert.match(html, /a &lt;b&gt; &amp; c/);
  assert.doesNotMatch(html, /<b>/);
});

test('highlightMarkdown colours inline code / bold / italic / links', () => {
  const html = highlightMarkdown('run `psql` **now** or _later_ see [[Runbook]] and [x](y)');
  assert.match(html, /pe-t-code">`psql`/);
  assert.match(html, /pe-t-strong">\*\*now\*\*/);
  assert.match(html, /pe-t-em">_later_/);
  assert.match(html, /pe-t-link">\[\[Runbook\]\]/);
  assert.match(html, /pe-t-link">\[x\]\(y\)/);
});

test('highlightMarkdown treats fenced code blocks as a run', () => {
  const html = highlightMarkdown('```\n**not bold** here\n```');
  assert.match(html, /pe-t-codeblock">\*\*not bold\*\* here/);
  assert.doesNotMatch(html, /pe-t-strong">\*\*not bold/);
});

test('findMatches returns ranges; plain text is escaped for regex', () => {
  const { valid, matches } = findMatches('a.b a.b axb', { search: 'a.b' });
  assert.equal(valid, true);
  assert.equal(matches.length, 2); // literal "a.b", not the regex wildcard
  assert.deepEqual(matches[0], { start: 0, end: 3 });
});

test('findMatches supports regexp + case sensitivity + whole word', () => {
  assert.equal(findMatches('cat Cat CAT', { search: 'cat' }).matches.length, 3); // ci default
  assert.equal(findMatches('cat Cat CAT', { search: 'cat', caseSensitive: true }).matches.length, 1);
  assert.equal(findMatches('a1 a2 a3', { search: 'a\\d', regexp: true }).matches.length, 3);
  assert.equal(findMatches('cat cats', { search: 'cat', wholeWord: true }).matches.length, 1);
});

test('findMatches flags an invalid regex rather than throwing', () => {
  assert.deepEqual(findMatches('x', { search: '(', regexp: true }), { valid: false, matches: [] });
  assert.deepEqual(findMatches('x', {}).matches, []); // empty query → no matches
});
