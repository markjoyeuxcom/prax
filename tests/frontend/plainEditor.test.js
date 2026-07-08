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

import { detectCompletion, renderMarks, SLASH_COMMANDS } from '../../public/js/plainEditor.js';

test('detectCompletion finds an open [[wiki context at the caret', () => {
  const text = 'see [[Runb';
  const c = detectCompletion(text, text.length);
  assert.deepEqual(c, { kind: 'wiki', from: 6, to: 10, query: 'Runb' });
  // a closed link is not an open context
  assert.equal(detectCompletion('see [[Runbook]] now', 19), null);
  // empty query right after [[
  assert.equal(detectCompletion('x [[', 4).query, '');
});

test('detectCompletion finds a /slash only at line start', () => {
  const c = detectCompletion('/head', 5);
  assert.deepEqual(c, { kind: 'slash', from: 0, to: 5, query: 'head' });
  assert.deepEqual(detectCompletion('  /b', 4), { kind: 'slash', from: 2, to: 4, query: 'b' });
  // a slash mid-line is not a command
  assert.equal(detectCompletion('a/b', 3), null);
  // slash commands include the documented set
  assert.ok(SLASH_COMMANDS.some((c2) => c2.key === 'task' && c2.action === 'checklist'));
});

test('renderMarks paints match ranges per line, marking the current one', () => {
  const text = 'cat and cat\ncat';        // three "cat" at 0, 8, 12
  const matches = [{ start: 0, end: 3 }, { start: 8, end: 11 }, { start: 12, end: 15 }];
  const html = renderMarks(text, matches, 1);
  assert.equal((html.match(/<mark/g) || []).length, 3);
  assert.equal((html.match(/pe-m-current/g) || []).length, 1);
  // the current mark wraps the 2nd occurrence (after " and ")
  assert.match(html, /and <mark class="pe-m pe-m-current">cat<\/mark>/);
  // two lines rendered
  assert.equal((html.match(/class="pe__line"/g) || []).length, 2);
});

test('renderMarks with no matches still renders the lines (no marks)', () => {
  const html = renderMarks('a\nb', []);
  assert.equal((html.match(/<mark/g) || []).length, 0);
  assert.equal((html.match(/class="pe__line"/g) || []).length, 2);
});
