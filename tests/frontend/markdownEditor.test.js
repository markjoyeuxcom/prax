import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMarkdownFormat } from '../../public/js/markdownEditor.js';

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
