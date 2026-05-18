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
    default:
      return { value: safeValue, selectionStart: start, selectionEnd: end };
  }
}
