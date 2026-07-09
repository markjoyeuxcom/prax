function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// A fenced code block with a bar: the language label (when present) and a Copy
// button. The button carries no data — the click handler reads the sibling
// <code>'s textContent — so the code is never double-escaped into an attribute.
// The inner <pre><code …> shape (with data-language) is unchanged.
function renderCodeBlock(code, language) {
  const languageAttr = language ? ` data-language="${escapeHtml(language)}"` : '';
  const langLabel = language ? escapeHtml(language) : '';
  return '<div class="code-block">'
    + `<div class="code-block__bar"><span class="code-block__lang">${langLabel}</span>`
    + '<button type="button" class="code-block__copy" data-action="copy-code" aria-label="Copy code to clipboard">Copy</button></div>'
    + `<pre><code${languageAttr}>${escapeHtml(code)}</code></pre>`
    + '</div>';
}

// Set per-render by renderMarkdownHtml: (title) => { id, title } | null. Lets
// renderInline (called deep in the parse) resolve [[wiki-links]] without
// threading the document list through every call. Safe because rendering is
// synchronous and single-threaded.
let wikiResolver = null;

function renderInline(value) {
  const codeSpans = [];
  let text = String(value ?? '').replace(/`([^`]+)`/g, (_match, code) => {
    const token = `\u0000CODE${codeSpans.length}\u0000`;
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  // Wiki-links [[Title]] are resolved on the RAW text (before escapeHtml) so
  // the resolver sees the true title — titles with & ' \" < > would otherwise
  // never match. The rendered HTML is protected by a token like code spans,
  // and its display title / attributes are escaped explicitly.
  const wikiSpans = [];
  text = text.replace(/\[\[([^\]\n]+)\]\]/g, (_match, rawTitle) => {
    const title = rawTitle.trim();
    const doc = wikiResolver ? wikiResolver(title) : null;
    const token = `\u0000WIKI${wikiSpans.length}\u0000`;
    if (doc) {
      wikiSpans.push(`<a class="wikilink" data-action="open-doc" data-document-id="${escapeHtml(doc.id)}" title="Open ${escapeHtml(doc.title || title)}">${escapeHtml(title)}</a>`);
    } else {
      wikiSpans.push(`<span class="wikilink wikilink--missing" title="No document named this yet">${escapeHtml(title)}</span>`);
    }
    return token;
  });

  text = escapeHtml(text);
  // Images ![alt](src) — before links, so the link rule doesn't eat the [..](..)
  // and strand the leading "!". src is restricted to http(s)/relative (no
  // javascript:) and alt is already escaped by escapeHtml above.
  text = text.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]+|#[^)\s]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // Underscore emphasis, with word-boundary guards so snake_case identifiers and
  // file/paths with underscores are never turned into emphasis. Double first.
  text = text.replace(/(^|[^\w])__(\S(?:[^_]*\S)?)__(?=[^\w]|$)/g, '$1<strong>$2</strong>');
  text = text.replace(/(^|[^\w])_(\S(?:[^_]*\S)?)_(?=[^\w]|$)/g, '$1<em>$2</em>');
  text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  // Function replacers: a string replacement arg would treat `$&`, `` $` ``,
  // `$'`, `$$` in the HTML (reachable from user content with `$`) as
  // replacement patterns and corrupt output; a function inserts it verbatim.
  codeSpans.forEach((code, index) => {
    text = text.replace(`\u0000CODE${index}\u0000`, () => code);
  });
  wikiSpans.forEach((wiki, index) => {
    text = text.replace(`\u0000WIKI${index}\u0000`, () => wiki);
  });
  return text;
}

function flushParagraph(output, paragraph) {
  if (!paragraph.length) return;
  output.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
  paragraph.length = 0;
}

function renderListItem(item, childHtml) {
  if (item.type === 'task') {
    // Task items are clickable in Prax: main.js listens on [data-md-check]
    // and rewrites `- [ ]`/`- [x]` at data-line in the markdown source.
    return `<li class="task-item${item.checked ? ' is-done' : ''}" data-md-check data-line="${item.line}" title="Click to toggle">`
      + `<span class="task-item__box">${item.checked ? '✓' : ''}</span> `
      + `<span class="task-item__label">${renderInline(item.text)}</span>${childHtml}</li>`;
  }
  return `<li>${renderInline(item.text)}${childHtml}</li>`;
}

// Turn each item's raw indent into a nesting depth (0,1,2,…). Depth only ever
// increments by one at a time (indent runs through a stack), so the builder
// below can nest safely without infinite loops on inconsistent indentation.
function assignListLevels(items) {
  const indents = [];
  return items.map((item) => {
    while (indents.length && item.indent < indents[indents.length - 1]) indents.pop();
    if (!indents.length || item.indent > indents[indents.length - 1]) indents.push(item.indent);
    return { ...item, level: indents.length - 1 };
  });
}

// Build nested <ul>/<ol> from level-annotated items. A run of same-kind items at
// one level is one list; deeper items nest inside the preceding <li>; a change
// of ordered/unordered kind at the same level starts a sibling list. Returns
// [html, nextIndex].
function buildListTree(items, start, level) {
  let html = '';
  let i = start;
  while (i < items.length && items[i].level >= level) {
    const ordered = items[i].type === 'ordered';
    const tag = ordered ? 'ol' : 'ul';
    let lis = '';
    while (i < items.length && items[i].level === level && (items[i].type === 'ordered') === ordered) {
      const item = items[i];
      i += 1;
      let childHtml = '';
      if (i < items.length && items[i].level > level) {
        const [nested, next] = buildListTree(items, i, level + 1);
        childHtml = nested;
        i = next;
      }
      lis += renderListItem(item, childHtml);
    }
    html += `<${tag}>${lis}</${tag}>`;
  }
  return [html, i];
}

function flushList(output, listItems) {
  if (!listItems.length) return;
  output.push(buildListTree(assignListLevels(listItems), 0, 0)[0]);
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

export function renderMarkdownHtml(markdown = '', options = {}) {
  wikiResolver = typeof options.resolveWikiLink === 'function' ? options.resolveWikiLink : null;
  try {
    return renderMarkdownBody(markdown);
  } finally {
    wikiResolver = null;
  }
}

function renderMarkdownBody(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const output = [];
  const paragraph = [];
  const listItems = [];
  const tableRows = [];
  let codeLines = null;
  let codeLanguage = '';

  lines.forEach((line, lineIndex) => {
    if (line.trim().startsWith('```')) {
      if (codeLines) {
        flushParagraph(output, paragraph);
        flushList(output, listItems);
        flushTable(output, tableRows);
        output.push(renderCodeBlock(codeLines.join('\n'), codeLanguage));
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
    // Leading-whitespace width (tabs → 4) drives list nesting depth.
    const indent = line.slice(0, line.length - line.trimStart().length).replace(/\t/g, '    ').length;
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

    // A line that STARTS another block construct — heading (#), blockquote (>),
    // bullet/task item (-, *, +) or ordered item (N.) — may legitimately carry a
    // "|" (a shell pipe such as `- kubectl get pods | grep x`), so it must not be
    // allowed to *start* a table. The guard is applied ONLY to the table-start
    // test: a row that CONTINUES an already-open table (tableRows.length) is still
    // accepted, so a genuine borderless table whose data cell begins with a marker
    // (e.g. `- | negative` in a symbol table) keeps rendering as a table.
    const startsBlock = /^(#{1,6}\s|>|[-*+]\s|\d+\.\s)/.test(trimmed);
    if (trimmed.includes('|') && (tableRows.length || (!startsBlock && /^\|?.+\|.+/.test(trimmed)))) {
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
      listItems.push({ type: 'task', checked: taskItem[1].toLowerCase() === 'x', text: taskItem[2], line: lineIndex, indent });
      return;
    }

    const orderedItem = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (orderedItem) {
      flushParagraph(output, paragraph);
      listItems.push({ type: 'ordered', text: orderedItem[1], indent });
      return;
    }

    const listItem = /^[-*+]\s+(.+)$/.exec(trimmed);
    if (listItem) {
      flushParagraph(output, paragraph);
      listItems.push({ type: 'unordered', text: listItem[1], indent });
      return;
    }

    flushList(output, listItems);
    paragraph.push(trimmed);
  });

  if (codeLines) output.push(renderCodeBlock(codeLines.join('\n'), ''));
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
