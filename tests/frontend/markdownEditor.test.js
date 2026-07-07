import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMarkdownFormat, continueListOnEnter } from '../../public/js/markdownEditor.js';

test('applyMarkdownFormat wraps selected text with bold markers', () => {
  assert.deepEqual(applyMarkdownFormat('make bold text', 5, 9, 'bold'), {
    value: 'make **bold** text',
    selectionStart: 7,
    selectionEnd: 11,
  });
});

test('applyMarkdownFormat prefixes selected lines as a Markdown list', () => {
  assert.deepEqual(applyMarkdownFormat('alpha\nbeta', 0, 10, 'bullet-list'), {
    value: '- alpha\n- beta',
    selectionStart: 0,
    selectionEnd: 14,
  });
});

test('applyMarkdownFormat inserts a checklist item at the cursor', () => {
  assert.deepEqual(applyMarkdownFormat('', 0, 0, 'checklist'), {
    value: '- [ ] task',
    selectionStart: 6,
    selectionEnd: 10,
  });
});

test('applyMarkdownFormat inserts a Markdown link around selected text', () => {
  assert.deepEqual(applyMarkdownFormat('Cloudflare', 0, 10, 'link'), {
    value: '[Cloudflare](https://)',
    selectionStart: 14,
    selectionEnd: 22,
  });
});

test('applyMarkdownFormat wraps selected text in a fenced code block', () => {
  assert.deepEqual(applyMarkdownFormat('kubectl get pods', 0, 16, 'code-block'), {
    value: '```\nkubectl get pods\n```',
    selectionStart: 4,
    selectionEnd: 20,
  });
});

test('applyMarkdownFormat inserts an empty fenced code block at the cursor', () => {
  assert.deepEqual(applyMarkdownFormat('', 0, 0, 'code-block'), {
    value: '```\ncode block\n```',
    selectionStart: 4,
    selectionEnd: 14,
  });
});

// ---- continueListOnEnter -----------------------------------------------------

test('continueListOnEnter continues a bullet list, preserving the bullet + indent', () => {
  assert.deepEqual(continueListOnEnter('- item'), { action: 'continue', prefix: '- ' });
  assert.deepEqual(continueListOnEnter('  * nested'), { action: 'continue', prefix: '  * ' });
  assert.deepEqual(continueListOnEnter('+ plus'), { action: 'continue', prefix: '+ ' });
});

test('continueListOnEnter increments an ordered list', () => {
  assert.deepEqual(continueListOnEnter('1. first'), { action: 'continue', prefix: '2. ' });
  assert.deepEqual(continueListOnEnter('   9. ninth'), { action: 'continue', prefix: '   10. ' });
});

test('continueListOnEnter continues a task item as a fresh unchecked box', () => {
  assert.deepEqual(continueListOnEnter('- [ ] todo'), { action: 'continue', prefix: '- [ ] ' });
  assert.deepEqual(continueListOnEnter('- [x] done'), { action: 'continue', prefix: '- [ ] ' });
  assert.deepEqual(continueListOnEnter('* [X] done'), { action: 'continue', prefix: '* [ ] ' });
});

test('continueListOnEnter continues a blockquote', () => {
  assert.deepEqual(continueListOnEnter('> quoted'), { action: 'continue', prefix: '> ' });
});

test('continueListOnEnter exits an empty item (marker with no content)', () => {
  assert.deepEqual(continueListOnEnter('- '), { action: 'exit' });
  assert.deepEqual(continueListOnEnter('  1. '), { action: 'exit' });
  assert.deepEqual(continueListOnEnter('- [ ] '), { action: 'exit' });
  assert.deepEqual(continueListOnEnter('> '), { action: 'exit' });
});

test('continueListOnEnter ignores non-list lines and plain text', () => {
  assert.deepEqual(continueListOnEnter('just a paragraph'), { action: 'none' });
  assert.deepEqual(continueListOnEnter('# Heading'), { action: 'none' });
  assert.deepEqual(continueListOnEnter(''), { action: 'none' });
  assert.deepEqual(continueListOnEnter('-no space is not a list'), { action: 'none' });
});
