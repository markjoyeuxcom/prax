function selectedText(value, selectionStart, selectionEnd) {
  return value.slice(selectionStart, selectionEnd);
}

function wrapSelection(value, selectionStart, selectionEnd, wrapper, fallback) {
  const selected = selectedText(value, selectionStart, selectionEnd) || fallback;
  const nextValue = `${value.slice(0, selectionStart)}${wrapper}${selected}${wrapper}${value.slice(selectionEnd)}`;
  return {
    value: nextValue,
    selectionStart: selectionStart + wrapper.length,
    selectionEnd: selectionStart + wrapper.length + selected.length,
  };
}

function selectedLineRange(value, selectionStart, selectionEnd) {
  const lineStart = value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
  const nextLineBreak = value.indexOf('\n', selectionEnd);
  return {
    lineStart,
    lineEnd: nextLineBreak === -1 ? value.length : nextLineBreak,
  };
}

function prefixSelectedLines(value, selectionStart, selectionEnd, marker, fallback) {
  if (selectionStart === selectionEnd && !value) {
    return {
      value: `${marker}${fallback}`,
      selectionStart: marker.length,
      selectionEnd: marker.length + fallback.length,
    };
  }

  const { lineStart, lineEnd } = selectedLineRange(value, selectionStart, selectionEnd);
  const selectedLines = value.slice(lineStart, lineEnd);
  const nextLines = selectedLines
    .split('\n')
    .map(line => `${marker}${line}`)
    .join('\n');

  return {
    value: `${value.slice(0, lineStart)}${nextLines}${value.slice(lineEnd)}`,
    selectionStart: lineStart,
    selectionEnd: lineStart + nextLines.length,
  };
}

function orderedList(value, selectionStart, selectionEnd) {
  if (selectionStart === selectionEnd && !value) {
    return {
      value: '1. item',
      selectionStart: 3,
      selectionEnd: 7,
    };
  }

  const { lineStart, lineEnd } = selectedLineRange(value, selectionStart, selectionEnd);
  const selectedLines = value.slice(lineStart, lineEnd);
  const nextLines = selectedLines
    .split('\n')
    .map((line, index) => `${index + 1}. ${line}`)
    .join('\n');

  return {
    value: `${value.slice(0, lineStart)}${nextLines}${value.slice(lineEnd)}`,
    selectionStart: lineStart,
    selectionEnd: lineStart + nextLines.length,
  };
}

function heading(value, selectionStart, selectionEnd) {
  return prefixSelectedLines(value, selectionStart, selectionEnd, '## ', 'Heading');
}

function link(value, selectionStart, selectionEnd) {
  const selected = selectedText(value, selectionStart, selectionEnd) || 'link text';
  const nextValue = `${value.slice(0, selectionStart)}[${selected}](https://)${value.slice(selectionEnd)}`;
  return {
    value: nextValue,
    selectionStart: selectionStart + selected.length + 4,
    selectionEnd: selectionStart + selected.length + 12,
  };
}

function codeBlock(value, selectionStart, selectionEnd) {
  const selected = selectedText(value, selectionStart, selectionEnd) || 'code block';
  const prefix = '```\n';
  const suffix = '\n```';
  const nextValue = `${value.slice(0, selectionStart)}${prefix}${selected}${suffix}${value.slice(selectionEnd)}`;
  return {
    value: nextValue,
    selectionStart: selectionStart + prefix.length,
    selectionEnd: selectionStart + prefix.length + selected.length,
  };
}

export function applyMarkdownFormat(value, selectionStart, selectionEnd, action) {
  const safeValue = String(value ?? '');
  const start = Math.max(0, Number(selectionStart) || 0);
  const end = Math.max(start, Number(selectionEnd) || start);

  switch (action) {
    case 'bold':
      return wrapSelection(safeValue, start, end, '**', 'bold text');
    case 'italic':
      return wrapSelection(safeValue, start, end, '*', 'italic text');
    case 'code':
      return wrapSelection(safeValue, start, end, '`', 'code');
    case 'code-block':
      return codeBlock(safeValue, start, end);
    case 'heading':
      return heading(safeValue, start, end);
    case 'bullet-list':
      return prefixSelectedLines(safeValue, start, end, '- ', 'item');
    case 'numbered-list':
      return orderedList(safeValue, start, end);
    case 'checklist':
      return prefixSelectedLines(safeValue, start, end, '- [ ] ', 'task');
    case 'quote':
      return prefixSelectedLines(safeValue, start, end, '> ', 'quote');
    case 'link':
      return link(safeValue, start, end);
    case 'table':
      return table(safeValue, start, end);
    default:
      return { value: safeValue, selectionStart: start, selectionEnd: end };
  }
}

// Given the text of the line the caret sits at (caret assumed at end of line),
// decide what Enter should do inside a Markdown list/quote:
//   { action: 'none' }                    — not a list line; default Enter
//   { action: 'exit' }                    — empty item; clear the marker (leave list)
//   { action: 'continue', prefix: '…' }   — insert a newline + this prefix
// Handles bullets (-, *, +), ordered (auto-incremented), task items (fresh
// unchecked), and blockquotes, preserving leading indentation. Pure.
export function continueListOnEnter(lineText) {
  const match = /^(\s*)([-*+] \[[ xX]\] |[-*+] |\d+\. |> ?)(.*)$/.exec(String(lineText ?? ''));
  if (!match) return { action: 'none' };
  const [, indent, marker, content] = match;
  if (content.trim() === '') return { action: 'exit' };

  const task = /^([-*+]) \[[ xX]\] $/.exec(marker);
  const ordered = /^(\d+)\. $/.exec(marker);
  let nextMarker;
  if (task) nextMarker = `${task[1]} [ ] `;
  else if (ordered) nextMarker = `${Number(ordered[1]) + 1}. `;
  else if (marker.startsWith('>')) nextMarker = '> ';
  else nextMarker = marker; // "- " / "* " / "+ "
  return { action: 'continue', prefix: `${indent}${nextMarker}` };
}

// ---- Tables ---------------------------------------------------------------

const TABLE_ROW = /^\s*\|.*\|\s*$/;

function tableRowText(cells) {
  return `| ${cells.map((c) => (c === '' ? ' ' : c)).join(' | ')} |`;
}

// Insert a table at the caret (2×2 with a header), or turn the selected lines
// into one: each line a row, cells split on tabs, " | " or commas, the first
// line the header. The caret lands selecting the first header cell. Pure.
function table(value, start, end) {
  const selected = value.slice(start, end);
  const lines = selected.split('\n').map((l) => l.trim()).filter(Boolean);
  let rows;
  if (lines.length) {
    rows = lines.map((line) => line.replace(/^\|/, '').replace(/\|$/, '').split(/\t| \| |,/).map((c) => c.trim()));
    const width = Math.max(...rows.map((r) => r.length));
    rows = rows.map((r) => [...r, ...Array(width - r.length).fill('')]);
  } else {
    rows = [['Column 1', 'Column 2'], ['', '']];
  }
  const width = rows[0].length;
  const text = [tableRowText(rows[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(tableRowText)].join('\n');
  // On its own lines: a blank line before when the previous line has text,
  // a newline after when something follows.
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before === '' || before.endsWith('\n\n') ? '' : (before.endsWith('\n') ? '\n' : '\n\n');
  const tail = after === '' || after.startsWith('\n') ? '' : '\n';
  const next = before + lead + text + tail + after;
  const cellStart = start + lead.length + 2;
  return { value: next, selectionStart: cellStart, selectionEnd: cellStart + rows[0][0].length };
}

export function isTableRow(lineText) {
  return TABLE_ROW.test(String(lineText ?? ''));
}

// The "| --- | :-: |" row under a header: never a place to type.
export function isTableSeparator(lineText) {
  const text = String(lineText ?? '');
  if (!isTableRow(text)) return false;
  const cells = tableCells(text);
  // GFM: an optional colon, one or more dashes, an optional colon.
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(text.slice(c.from, c.to).trim()));
}

// Enter at the end of a table row: a fresh empty row with the same number of
// cells ({ action: 'continue', prefix }), or, on a row that is already empty,
// leave the table ({ action: 'exit' }). A separator row never continues.
// `nextLineText`: the line below, so Enter at the end of a header row whose
// separator follows puts the new row under the separator, not between them.
export function continueTableOnEnter(lineText, nextLineText = '') {
  const text = String(lineText ?? '');
  if (!isTableRow(text)) return { action: 'none' };
  const cells = tableCells(text);
  if (isTableSeparator(text)) return { action: 'none' };
  if (isTableSeparator(nextLineText)) {
    return { action: 'continue', prefix: tableRowText(Array(cells.length).fill('')), caret: 2, afterNextLine: true };
  }
  if (cells.every((c) => text.slice(c.from, c.to).trim() === '')) return { action: 'exit' };
  // caret: where the caret lands inside the new row (the first cell).
  return { action: 'continue', prefix: tableRowText(Array(cells.length).fill('')), caret: 2 };
}

// The content ranges of a row's cells, as offsets within the line: between
// the pipes, with the surrounding spaces left out. Pure.
export function tableCells(lineText) {
  const text = String(lineText ?? '');
  const pipes = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '|' && text[i - 1] !== '\\') pipes.push(i);
  }
  const cells = [];
  for (let i = 0; i + 1 < pipes.length; i += 1) {
    let from = pipes[i] + 1;
    let to = pipes[i + 1];
    while (from < to && text[from] === ' ') from += 1;
    while (to > from && text[to - 1] === ' ') to -= 1;
    // An empty cell: one space in from its pipe, so typing reads "| x |".
    if (from >= to) { from = Math.min(pipes[i] + 2, pipes[i + 1]); to = from; }
    cells.push({ from, to });
  }
  return cells;
}

// The cell to move to from a caret at `offset` in a row, one step in
// `direction` (1 = Tab, -1 = Shift+Tab): its content range, or null when the
// step leaves the row (the editor then moves to the next or previous row).
export function nextTableCell(lineText, offset, direction) {
  const cells = tableCells(lineText);
  if (!cells.length) return null;
  let index = cells.findIndex((c) => offset <= c.to + 1 && offset >= c.from - 1);
  if (index < 0) index = offset < cells[0].from ? -1 : cells.length;
  const target = index + (direction < 0 ? -1 : 1);
  return cells[target] || null;
}
