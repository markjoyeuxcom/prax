function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(value) {
  return escapeHtml(value);
}

function flushParagraph(output, paragraph) {
  if (!paragraph.length) return;
  output.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
  paragraph.length = 0;
}

function flushList(output, listItems) {
  if (!listItems.length) return;
  output.push(`<ul>${listItems.map(item => `<li>${renderInline(item)}</li>`).join('')}</ul>`);
  listItems.length = 0;
}

export function renderMarkdownHtml(markdown = '') {
  const lines = String(markdown || '').split(/\r?\n/);
  const output = [];
  const paragraph = [];
  const listItems = [];
  let codeLines = null;

  lines.forEach((line) => {
    if (line.trim().startsWith('```')) {
      if (codeLines) {
        flushParagraph(output, paragraph);
        flushList(output, listItems);
        output.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        codeLines = null;
      } else {
        flushParagraph(output, paragraph);
        flushList(output, listItems);
        codeLines = [];
      }
      return;
    }

    if (codeLines) {
      codeLines.push(line);
      return;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph(output, paragraph);
      flushList(output, listItems);
      return;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph(output, paragraph);
      flushList(output, listItems);
      output.push(`<h${heading[1].length}>${renderInline(heading[2])}</h${heading[1].length}>`);
      return;
    }

    const listItem = /^[-*]\s+(.+)$/.exec(trimmed);
    if (listItem) {
      flushParagraph(output, paragraph);
      listItems.push(listItem[1]);
      return;
    }

    flushList(output, listItems);
    paragraph.push(trimmed);
  });

  if (codeLines) output.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  flushParagraph(output, paragraph);
  flushList(output, listItems);

  return output.join('');
}

export function titleFromMarkdown(markdown = '', filename = '') {
  const heading = String(markdown || '').split(/\r?\n/)
    .map(line => /^(#{1,6})\s+(.+)$/.exec(line.trim()))
    .find(Boolean);
  if (heading) return heading[2].trim();

  const cleanFilename = String(filename || '').split('/').pop().replace(/\.md$/i, '').trim();
  return cleanFilename || 'Untitled document';
}
