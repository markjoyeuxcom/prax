function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(value) {
  const codeSpans = [];
  let text = String(value ?? '').replace(/`([^`]+)`/g, (_match, code) => {
    const token = `\u0000CODE${codeSpans.length}\u0000`;
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  text = escapeHtml(text);
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]+|#[^)\s]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  codeSpans.forEach((code, index) => {
    text = text.replace(`\u0000CODE${index}\u0000`, code);
  });
  return text;
}

function flushParagraph(output, paragraph) {
  if (!paragraph.length) return;
  output.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
  paragraph.length = 0;
}

function flushList(output, listItems) {
  if (!listItems.length) return;
  const type = listItems[0].type;
  const tag = type === 'ordered' ? 'ol' : 'ul';
  output.push(`<${tag}>${listItems.map((item) => {
    if (item.type === 'task') {
      return `<li><input type="checkbox" disabled${item.checked ? ' checked' : ''}> ${renderInline(item.text)}</li>`;
    }
    return `<li>${renderInline(item.text)}</li>`;
  }).join('')}</${tag}>`);
  listItems.length = 0;
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function parseTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
}

function flushTable(output, tableRows) {
  if (tableRows.length < 2 || !isTableSeparator(tableRows[1])) return false;
  const headers = parseTableRow(tableRows[0]);
  const rows = tableRows.slice(2).map(parseTableRow);
  output.push(`<table><thead><tr>${headers.map(cell => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${renderInline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
  tableRows.length = 0;
  return true;
}

export function renderMarkdownHtml(markdown = '') {
  const lines = String(markdown || '').split(/\r?\n/);
  const output = [];
  const paragraph = [];
  const listItems = [];
  const tableRows = [];
  let codeLines = null;
  let codeLanguage = '';

  lines.forEach((line) => {
    if (line.trim().startsWith('```')) {
      if (codeLines) {
        flushParagraph(output, paragraph);
        flushList(output, listItems);
        flushTable(output, tableRows);
        const languageAttr = codeLanguage ? ` data-language="${escapeHtml(codeLanguage)}"` : '';
        output.push(`<pre><code${languageAttr}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        codeLines = null;
        codeLanguage = '';
      } else {
        flushParagraph(output, paragraph);
        flushList(output, listItems);
        flushTable(output, tableRows);
        codeLines = [];
        codeLanguage = line.trim().slice(3).trim().split(/\s+/)[0] || '';
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
      if (tableRows.length && !flushTable(output, tableRows)) {
        paragraph.push(...tableRows);
        tableRows.length = 0;
        flushParagraph(output, paragraph);
      }
      return;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph(output, paragraph);
      flushList(output, listItems);
      flushTable(output, tableRows);
      output.push('<hr>');
      return;
    }

    if (trimmed.includes('|') && (tableRows.length || /^\|?.+\|.+/.test(trimmed))) {
      flushParagraph(output, paragraph);
      flushList(output, listItems);
      tableRows.push(trimmed);
      return;
    }

    if (tableRows.length && !flushTable(output, tableRows)) {
      paragraph.push(...tableRows);
      tableRows.length = 0;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph(output, paragraph);
      flushList(output, listItems);
      output.push(`<h${heading[1].length}>${renderInline(heading[2])}</h${heading[1].length}>`);
      return;
    }

    const blockquote = /^>\s?(.+)$/.exec(trimmed);
    if (blockquote) {
      flushParagraph(output, paragraph);
      flushList(output, listItems);
      output.push(`<blockquote><p>${renderInline(blockquote[1])}</p></blockquote>`);
      return;
    }

    const taskItem = /^[-*]\s+\[([ xX])\]\s+(.+)$/.exec(trimmed);
    if (taskItem) {
      flushParagraph(output, paragraph);
      listItems.push({ type: 'task', checked: taskItem[1].toLowerCase() === 'x', text: taskItem[2] });
      return;
    }

    const orderedItem = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (orderedItem) {
      flushParagraph(output, paragraph);
      listItems.push({ type: 'ordered', text: orderedItem[1] });
      return;
    }

    const listItem = /^[-*]\s+(.+)$/.exec(trimmed);
    if (listItem) {
      flushParagraph(output, paragraph);
      listItems.push({ type: 'unordered', text: listItem[1] });
      return;
    }

    flushList(output, listItems);
    paragraph.push(trimmed);
  });

  if (codeLines) output.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  if (tableRows.length && !flushTable(output, tableRows)) paragraph.push(...tableRows);
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
