import { escapeHtml } from './html.js';

// Prax's small Markdown renderer. One renderer serves two kinds of text, so
// every render names its mode:
//
//   'document'  — a person's own document in the editor preview. Remote
//                 (http/https) images load, and task items toggle their
//                 source line when the caller passes editable: true.
//   'untrusted' — model output (assistant, Ask Prax, narratives, writing
//                 previews) and anything else built from agent-written text.
//                 Remote images stay inert placeholders: the browser fetches
//                 an <img> on render with no click, so a prompt-injected
//                 answer could carry workspace data out in the image URL. Task
//                 items are inert: a data-line there would rewrite whichever
//                 document happens to be open.
//
// Everything is escaped in both modes; links are limited to http(s), a
// same-site path or a #fragment.
export const MARKDOWN_MODES = Object.freeze({ document: 'document', untrusted: 'untrusted' });

// Resolve the caller's options into one render context.
//   { mode: 'document', editable, resolveWikiLink }
//   { mode: 'untrusted', resolveWikiLink }
// Without a mode, the older flags keep their exact meaning: remoteImages:
// true (the editor preview, i.e. 'document') and taskToggles: true opt in
// one by one; the default is 'untrusted'. An unknown mode is 'untrusted'.
export function markdownRenderContext(options = {}) {
  const resolveWikiLink = typeof options.resolveWikiLink === 'function' ? options.resolveWikiLink : null;
  if (options.mode === undefined) {
    const remoteImages = options.remoteImages === true;
    return {
      mode: remoteImages ? 'document' : 'untrusted',
      remoteImages,
      taskToggles: options.taskToggles === true,
      resolveWikiLink,
    };
  }
  if (options.mode === 'document') {
    return { mode: 'document', remoteImages: true, taskToggles: options.editable === true, resolveWikiLink };
  }
  return { mode: 'untrusted', remoteImages: false, taskToggles: false, resolveWikiLink };
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

// Inline tokens. The inline rules are regular expressions over one line of
// text; HTML they generate (code spans, wiki-links, links, images) is held
// out of that text as a token, \u0000<index>\u0000, so later rules cannot
// rewrite it. Tokens cannot be forged: renderMarkdownHtml removes every
// U+0000 from the source first (a browser drops it from text anyway), so the
// only delimiters in the text are the ones added here, and each index names
// an entry of this render's own table.
const TOKEN = /\u0000(\d+)\u0000/g;

function createTokens() {
  const items = [];
  return {
    // html: what the token renders as; text: its escaped plain text, for an
    // attribute value; source: the raw Markdown it came from.
    hold(html, text, source) {
      items.push({ html, text, source });
      return `\u0000${items.length - 1}\u0000`;
    },
    // Tokens may hold tokens (a link's text may hold an image or a code
    // span), so each is expanded recursively. Function replacers throughout:
    // a string replacement would treat `$&`, `` $` ``, `$'` and `$$` in
    // user content as patterns.
    html(value) { return value.replace(TOKEN, (_match, index) => this.html(items[index].html)); },
    text(value) { return value.replace(TOKEN, (_match, index) => this.text(items[index].text)); },
    source(value) { return value.replace(TOKEN, (_match, index) => this.source(items[index].source)); },
  };
}

// Bold, italic and strikethrough over already-escaped text whose generated
// HTML is held in tokens.
function renderEmphasis(text) {
  let html = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // Underscore emphasis, with word-boundary guards so snake_case identifiers and
  // file/paths with underscores are never turned into emphasis. Double first.
  html = html.replace(/(^|[^\w])__(\S(?:[^_]*\S)?)__(?=[^\w]|$)/g, '$1<strong>$2</strong>');
  html = html.replace(/(^|[^\w])_(\S(?:[^_]*\S)?)_(?=[^\w]|$)/g, '$1<em>$2</em>');
  return html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
}

function renderInline(value, context) {
  const tokens = createTokens();
  let text = String(value ?? '').replace(/`([^`]+)`/g, (match, code) => (
    tokens.hold(`<code>${escapeHtml(code)}</code>`, escapeHtml(code), match)
  ));

  // Wiki-links [[Title]] are resolved on the RAW text (before escaping) so
  // the resolver sees the true title — titles with & ' " < > would otherwise
  // never match. A code span inside the brackets counts as its source text.
  text = text.replace(/\[\[([^\]\n]+)\]\]/g, (match, rawTitle) => {
    const title = tokens.source(rawTitle).trim();
    const doc = context.resolveWikiLink ? context.resolveWikiLink(title) : null;
    // href="#" makes the link focusable and announced as a link; the app's
    // click handler cancels the navigation and runs data-action instead.
    const html = doc
      ? `<a class="wikilink" data-action="open-doc" data-document-id="${escapeHtml(doc.id)}" href="#" title="Open ${escapeHtml(doc.title || title)}">${escapeHtml(title)}</a>`
      : `<span class="wikilink wikilink--missing" title="No document named this yet">${escapeHtml(title)}</span>`;
    return tokens.hold(html, escapeHtml(title), tokens.source(match));
  });

  // From here on the text is escaped: the captures below are escaped text
  // (URLs included), and a URL never holds a token.
  text = escapeHtml(text);

  // Images ![alt](src) — before links, so the link rule doesn't eat the [..](..)
  // and strand the leading "!". src is restricted to http(s)/relative (no
  // javascript:). The alt attribute gets the plain text of any code span or
  // wiki-link inside it, never their HTML.
  text = text.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s\u0000]+|\/[^)\s\u0000]+)\)/g, (match, alt, src) => {
    // Same-origin only for a single leading slash: a browser resolves `//host`
    // and `/\host` (backslash counts as a slash) to another origin.
    const samePage = /^\/(?![/\\])/.test(src);
    const altText = tokens.text(alt);
    if (context.remoteImages || samePage) {
      return tokens.hold(`<img src="${src}" alt="${altText}" loading="lazy">`, altText, match); // html-safe: src and alt are escaped text
    }
    const host = src.replace(/^(?:https?:)?[/\\]{2}/, '').split(/[/\\?#]/)[0];
    const label = `[image${alt ? `: ${alt}` : ''} — ${host}, not loaded]`;
    return tokens.hold(`<span class="md-image-blocked" title="Remote image not loaded">${label}</span>`, altText, match); // html-safe: alt and host are escaped text
  });
  // A link's visible text still gets emphasis, rendered on its own.
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s\u0000]+|\/[^)\s\u0000]+|#[^)\s\u0000]+)\)/g, (match, label, href) => (
    tokens.hold(`<a href="${href}" rel="noreferrer">${renderEmphasis(label)}</a>`, tokens.text(label), match) // html-safe: href is escaped text; label is escaped text with emphasis
  ));
  return tokens.html(renderEmphasis(text));
}

function flushParagraph(output, paragraph, context) {
  if (!paragraph.length) return;
  output.push(`<p>${renderInline(paragraph.join(' '), context)}</p>`);
  paragraph.length = 0;
}

function renderListItem(item, childHtml, context) {
  if (item.type === 'task') {
    // With task toggles, a task item holds a checkbox (its box and label; the
    // <li> keeps list semantics): main.js dispatches toggle-md-check (click,
    // Space or Enter) and rewrites `- [ ]`/`- [x]` at data-line in the
    // markdown source. Otherwise it is inert.
    const line = Number(item.line);
    const content = `<span class="task-item__box">${item.checked ? '✓' : ''}</span> `
      + `<span class="task-item__label">${renderInline(item.text, context)}</span>`;
    const body = context.taskToggles
      ? `<span class="task-item__toggle" data-action="toggle-md-check" data-line="${line}" role="checkbox" tabindex="0" aria-checked="${item.checked ? 'true' : 'false'}" title="Toggle this item">${content}</span>`
      : content;
    return `<li class="task-item${item.checked ? ' is-done' : ''}" data-md-check data-line="${line}">${body}${childHtml}</li>`;
  }
  return `<li>${renderInline(item.text, context)}${childHtml}</li>`;
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
function buildListTree(items, start, level, context) {
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
        const [nestedHtml, next] = buildListTree(items, i, level + 1, context);
        childHtml = nestedHtml;
        i = next;
      }
      lis += renderListItem(item, childHtml, context);
    }
    html += `<${tag}>${lis}</${tag}>`;
  }
  return [html, i];
}

function flushList(output, listItems, context) {
  if (!listItems.length) return;
  output.push(buildListTree(assignListLevels(listItems), 0, 0, context)[0]);
  listItems.length = 0;
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function parseTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
}

function flushTable(output, tableRows, context) {
  if (tableRows.length < 2 || !isTableSeparator(tableRows[1])) return false;
  const headers = parseTableRow(tableRows[0]);
  const rows = tableRows.slice(2).map(parseTableRow);
  const head = headers.map(cell => `<th>${renderInline(cell, context)}</th>`).join('');
  const body = rows.map(row => `<tr>${row.map(cell => `<td>${renderInline(cell, context)}</td>`).join('')}</tr>`).join('');
  output.push(`<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
  tableRows.length = 0;
  return true;
}

// renderMarkdownHtml(markdown, { mode: 'document', editable, resolveWikiLink })
// renderMarkdownHtml(markdown, { mode: 'untrusted', resolveWikiLink })
// See markdownRenderContext for the older remoteImages/taskToggles flags.
export function renderMarkdownHtml(markdown = '', options = {}) {
  // U+0000 is the inline token delimiter; content never carries one.
  const source = String(markdown || '').replace(/\u0000/g, '');
  return renderMarkdownBody(source, markdownRenderContext(options));
}

function renderMarkdownBody(markdown, context) {
  const lines = markdown.split(/\r?\n/);
  const output = [];
  const paragraph = [];
  const listItems = [];
  const tableRows = [];
  let codeLines = null;
  let codeLanguage = '';
  const flushBlocks = () => {
    flushParagraph(output, paragraph, context);
    flushList(output, listItems, context);
  };

  lines.forEach((line, lineIndex) => {
    if (line.trim().startsWith('```')) {
      flushBlocks();
      flushTable(output, tableRows, context);
      if (codeLines) {
        output.push(renderCodeBlock(codeLines.join('\n'), codeLanguage));
        codeLines = null;
        codeLanguage = '';
      } else {
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
      flushBlocks();
      if (tableRows.length && !flushTable(output, tableRows, context)) {
        paragraph.push(...tableRows);
        tableRows.length = 0;
        flushParagraph(output, paragraph, context);
      }
      return;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushBlocks();
      flushTable(output, tableRows, context);
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
      flushBlocks();
      tableRows.push(trimmed);
      return;
    }

    if (tableRows.length && !flushTable(output, tableRows, context)) {
      paragraph.push(...tableRows);
      tableRows.length = 0;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushBlocks();
      const level = heading[1].length;
      output.push(`<h${level}>${renderInline(heading[2], context)}</h${level}>`);
      return;
    }

    const blockquote = /^>\s?(.+)$/.exec(trimmed);
    if (blockquote) {
      flushBlocks();
      output.push(`<blockquote><p>${renderInline(blockquote[1], context)}</p></blockquote>`);
      return;
    }

    const taskItem = /^[-*]\s+\[([ xX])\]\s+(.+)$/.exec(trimmed);
    if (taskItem) {
      flushParagraph(output, paragraph, context);
      listItems.push({ type: 'task', checked: taskItem[1].toLowerCase() === 'x', text: taskItem[2], line: lineIndex, indent });
      return;
    }

    const orderedItem = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (orderedItem) {
      flushParagraph(output, paragraph, context);
      listItems.push({ type: 'ordered', text: orderedItem[1], indent });
      return;
    }

    const listItem = /^[-*+]\s+(.+)$/.exec(trimmed);
    if (listItem) {
      flushParagraph(output, paragraph, context);
      listItems.push({ type: 'unordered', text: listItem[1], indent });
      return;
    }

    flushList(output, listItems, context);
    paragraph.push(trimmed);
  });

  if (codeLines) output.push(renderCodeBlock(codeLines.join('\n'), ''));
  if (tableRows.length && !flushTable(output, tableRows, context)) paragraph.push(...tableRows);
  flushBlocks();

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
