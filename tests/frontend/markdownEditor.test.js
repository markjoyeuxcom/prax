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

import { continueTableOnEnter, tableCells, nextTableCell, isTableRow, isTableSeparator } from '../../public/js/markdownEditor.js';

test('applyMarkdownFormat inserts a 2×2 table on its own lines and selects the first header cell', () => {
  const out = applyMarkdownFormat('intro', 5, 5, 'table');
  assert.equal(out.value, 'intro\n\n| Column 1 | Column 2 |\n| --- | --- |\n|   |   |');
  assert.equal(out.value.slice(out.selectionStart, out.selectionEnd), 'Column 1');
  const mid = applyMarkdownFormat('a\n\nb', 3, 3, 'table');
  assert.match(mid.value, /^a\n\n\| Column 1 \| Column 2 \|\n\| --- \| --- \|\n\|   \|   \|\nb$/);
});

test('applyMarkdownFormat turns selected lines into table rows, the first line the header', () => {
  const text = 'Name\tRole\nAda\tengineer\nLin, ops';
  const out = applyMarkdownFormat(text, 0, text.length, 'table');
  assert.equal(out.value, '| Name | Role |\n| --- | --- |\n| Ada | engineer |\n| Lin | ops |');
});

test('Enter at the end of a table row adds an empty row; an empty row leaves the table; a separator never continues', () => {
  assert.deepEqual(continueTableOnEnter('| a | b |'), { action: 'continue', prefix: '|   |   |', caret: 2 });
  assert.deepEqual(continueTableOnEnter('|   |   |'), { action: 'exit' });
  assert.deepEqual(continueTableOnEnter('| --- | --- |'), { action: 'none' });
  assert.deepEqual(continueTableOnEnter('plain'), { action: 'none' });
  assert.equal(isTableRow('| x |'), true);
});

test('tableCells and nextTableCell step through a row and off its ends', () => {
  const row = '| Name | Role |';
  assert.deepEqual(tableCells(row), [{ from: 2, to: 6 }, { from: 9, to: 13 }]);
  assert.deepEqual(nextTableCell(row, 3, 1), { from: 9, to: 13 });
  assert.deepEqual(nextTableCell(row, 10, -1), { from: 2, to: 6 });
  assert.equal(nextTableCell(row, 10, 1), null, 'past the last cell');
  assert.equal(nextTableCell(row, 3, -1), null, 'before the first cell');
  assert.deepEqual(tableCells('|   |   |'), [{ from: 2, to: 2 }, { from: 6, to: 6 }], 'an empty cell puts the caret one space in');
  assert.equal(isTableSeparator('| --- | :-: |'), true);
  assert.equal(isTableSeparator('| a | b |'), false);
});
