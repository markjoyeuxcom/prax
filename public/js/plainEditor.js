import { applyMarkdownFormat, continueListOnEnter } from './markdownEditor.js';

// Spike: a dependency-free Markdown editor to A/B against CodeMirror.
//
// The "highlight-behind-textarea" pattern: a real <textarea> does all the hard
// editing (cursor, selection, undo/redo, IME, clipboard, mobile, a11y) for free
// and correctly; behind it sits a <div> that mirrors the text with syntax
// highlighting. The textarea's text is transparent (only its caret + selection
// show), so the coloured layer reads through. Both share identical font/metrics
// so they stay aligned, including soft-wrapping. Exposes the SAME controller
// interface as mountCodeMirrorEditor so it's a drop-in swap.
//
// Deliberately OUT of the spike (documented, not oversights): viewport
// virtualization (fine at note/runbook scale), multi-cursor, code folding, and
// the slash-menu/wiki-link autocomplete. Highlighting is regex/line-based, not
// a full parser, so it's "good enough", not perfect.

const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
function esc(s) { return String(s).replace(/[&<>]/g, (c) => HTML_ESC[c]); }

// Inline spans on already-escaped text: code first (so *_` inside code aren't
// re-highlighted), then strong, emphasis, links/wiki-links. The inserted markup
// uses only letters/hyphens/quotes/brackets — none of the inline markers — so
// later passes never match inside an earlier span.
function inline(escaped) {
  return escaped
    .replace(/(`[^`\n]+`)/g, '<span class="pe-t-code">$1</span>')
    .replace(/(\*\*[^*\n]+\*\*|__[^_\n]+__)/g, '<span class="pe-t-strong">$1</span>')
    // Single * / _ emphasis, guarded so it never matches a marker adjacent to
    // another * / _ or a word char (so it can't re-open inside **bold** or a word).
    .replace(/(?<![*\w])(\*[^*\s][^*\n]*\*)(?![*\w])|(?<![\w])(_[^_\s][^_\n]*_)(?![\w])/g,
      (m, star, und) => `<span class="pe-t-em">${star || und}</span>`)
    .replace(/(\[\[[^\]\n]+\]\]|\[[^\]\n]*\]\([^)\n]*\))/g, '<span class="pe-t-link">$1</span>');
}

function highlightLine(line, inFence) {
  if (inFence) return `<span class="pe-t-codeblock">${esc(line)}</span>`;
  if (/^\s*```/.test(line)) return `<span class="pe-t-marker">${esc(line)}</span>`;
  if (/^#{1,6}\s/.test(line)) return `<span class="pe-t-heading">${esc(line)}</span>`;
  if (/^\s*>/.test(line)) return `<span class="pe-t-quote">${inline(esc(line))}</span>`;
  const li = line.match(/^(\s*)(?:[-*+]|\d+\.)(?:\s+\[[ xX]\])?\s+/);
  if (li) {
    const markerLen = li[0].length;
    return `<span class="pe-t-marker">${esc(line.slice(0, markerLen))}</span>${inline(esc(line.slice(markerLen)))}`;
  }
  if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) return `<span class="pe-t-marker">${esc(line)}</span>`;
  return inline(esc(line));
}

// text -> HTML: one <div class="pe__line" data-ln="N"> per line (data-ln drives
// the CSS line-number gutter). Pure; exported for tests.
export function highlightMarkdown(text) {
  const lines = String(text ?? '').split('\n');
  let inFence = false;
  return lines.map((line, i) => {
    const isFence = /^\s*```/.test(line);
    const html = highlightLine(line, inFence && !isFence);
    if (isFence) inFence = !inFence;
    return `<div class="pe__line" data-ln="${i + 1}">${html}</div>`;
  }).join('');
}

// ---- search (basic textarea find/replace) -----------------------------------
function buildRegex({ search, caseSensitive, regexp, wholeWord } = {}) {
  if (!search) return null;
  let src = regexp ? search : search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (wholeWord) src = `\\b(?:${src})\\b`;
  try { return new RegExp(src, caseSensitive ? 'g' : 'gi'); } catch { return false; }
}

// Pure; exported for tests. { valid, matches: [{start,end}] }.
export function findMatches(text, query) {
  const re = buildRegex(query);
  if (re === false) return { valid: false, matches: [] };
  if (!re) return { valid: true, matches: [] };
  const matches = [];
  let m; let guard = 0;
  const src = String(text ?? '');
  while ((m = re.exec(src)) && guard < 10000) {
    matches.push({ start: m.index, end: m.index + m[0].length });
    if (m.index === re.lastIndex) re.lastIndex += 1;
    guard += 1;
  }
  return { valid: true, matches };
}

export function mountPlainEditor({ host, value = '', onChange, onSave, lineNumbers = false, cursorToEnd = true } = {}) {
  if (!host) return null;
  const doc = globalThis.document;

  host.classList.add('pe-host');
  host.classList.toggle('pe-has-gutter', Boolean(lineNumbers));

  const scroll = doc.createElement('div');
  scroll.className = 'pe__scroll';
  const stack = doc.createElement('div');
  stack.className = 'pe__doc';
  const lines = doc.createElement('div');
  lines.className = 'pe__lines';
  lines.setAttribute('aria-hidden', 'true');
  const ta = doc.createElement('textarea');
  ta.className = 'pe__input';
  ta.spellcheck = false;
  ta.setAttribute('autocapitalize', 'off');
  ta.setAttribute('autocomplete', 'off');
  ta.setAttribute('autocorrect', 'off');
  ta.value = String(value ?? '');
  stack.append(lines, ta);
  scroll.append(stack);
  host.append(scroll);

  let query = null;

  function paint() {
    lines.innerHTML = highlightMarkdown(ta.value);
  }
  paint();

  function emitChange() {
    paint();
    if (typeof onChange === 'function') onChange(ta.value);
  }

  // Splice text into the textarea, keeping undo history (execCommand) where the
  // browser supports it; fall back to a value swap.
  function replaceRange(start, end, insert, caretStart, caretEnd) {
    ta.focus();
    ta.setSelectionRange(start, end);
    let ok = false;
    try { ok = doc.execCommand('insertText', false, insert); } catch { ok = false; }
    if (!ok) ta.value = ta.value.slice(0, start) + insert + ta.value.slice(end);
    ta.setSelectionRange(caretStart ?? start + insert.length, caretEnd ?? start + insert.length);
    emitChange();
  }

  function onInput() { emitChange(); }

  function onKeydown(e) {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      if (typeof onSave === 'function') onSave();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); applyFormat('bold'); return; }
      if (k === 'i') { e.preventDefault(); applyFormat('italic'); return; }
      if (k === 'e') { e.preventDefault(); applyFormat('code'); return; }
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      replaceRange(ta.selectionStart, ta.selectionEnd, '  ');
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && ta.selectionStart === ta.selectionEnd) {
      const pos = ta.selectionStart;
      const lineStart = ta.value.lastIndexOf('\n', pos - 1) + 1;
      const lineEndNl = ta.value.indexOf('\n', pos);
      const lineEnd = lineEndNl === -1 ? ta.value.length : lineEndNl;
      if (pos !== lineEnd) return; // only continue when at end of line
      const result = continueListOnEnter(ta.value.slice(lineStart, lineEnd));
      if (result.action === 'exit') { e.preventDefault(); replaceRange(lineStart, lineEnd, ''); return; }
      if (result.action === 'continue') { e.preventDefault(); replaceRange(pos, pos, `\n${result.prefix}`); return; }
    }
  }

  function applyFormat(action) {
    const r = applyMarkdownFormat(ta.value, ta.selectionStart, ta.selectionEnd, action);
    replaceRange(0, ta.value.length, r.value, r.selectionStart, r.selectionEnd);
  }

  function matchInfo() {
    if (!query || !query.search) return { total: 0, current: 0, valid: true };
    const { valid, matches } = findMatches(ta.value, query);
    if (!valid) return { total: 0, current: 0, valid: false };
    const caret = ta.selectionStart;
    const idx = matches.findIndex((m) => m.start >= caret);
    const current = matches.length ? ((idx === -1 ? matches.length : idx + 1)) : 0;
    return { total: matches.length, current: matches.length ? current : 0, valid: true };
  }

  function gotoMatch(dir) {
    const { valid, matches } = findMatches(ta.value, query || {});
    if (!valid || !matches.length) return matchInfo();
    const caret = dir >= 0 ? ta.selectionEnd : ta.selectionStart;
    let target;
    if (dir >= 0) target = matches.find((m) => m.start >= caret) || matches[0];
    else target = [...matches].reverse().find((m) => m.end <= caret) || matches[matches.length - 1];
    ta.focus();
    ta.setSelectionRange(target.start, target.end);
    scrollSelectionIntoView();
    return matchInfo();
  }

  function scrollSelectionIntoView() {
    // Approximate: scroll so the caret line is roughly centered.
    const before = ta.value.slice(0, ta.selectionStart);
    const line = before.split('\n').length - 1;
    const lineH = lines.firstChild ? lines.firstChild.getBoundingClientRect().height || 24 : 24;
    scroll.scrollTop = Math.max(0, line * lineH - scroll.clientHeight / 2);
  }

  ta.addEventListener('input', onInput);
  ta.addEventListener('keydown', onKeydown);
  if (cursorToEnd) ta.setSelectionRange(ta.value.length, ta.value.length);

  return {
    getValue() { return ta.value; },
    focus() { ta.focus(); },
    getSelectionText() { return ta.value.slice(ta.selectionStart, ta.selectionEnd); },
    scrollToLine(lineNumber) {
      const target = Math.max(0, Number(lineNumber) || 0);
      const offset = ta.value.split('\n').slice(0, target).join('\n').length + (target > 0 ? 1 : 0);
      ta.focus();
      ta.setSelectionRange(offset, offset);
      scrollSelectionIntoView();
    },
    applyFormat,
    applySearch(q = {}) { query = q; return matchInfo(); },
    searchNext() { return gotoMatch(1); },
    searchPrevious() { return gotoMatch(-1); },
    replaceMatch() {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      const { matches } = findMatches(ta.value, query || {});
      const isMatch = matches.some((m) => m.start === ta.selectionStart && m.end === ta.selectionEnd) && sel;
      if (isMatch) replaceRange(ta.selectionStart, ta.selectionEnd, String(query.replace ?? ''));
      return gotoMatch(1);
    },
    replaceAllMatches() {
      const { valid, matches } = findMatches(ta.value, query || {});
      if (!valid || !matches.length) return matchInfo();
      let out = '';
      let last = 0;
      for (const m of matches) { out += ta.value.slice(last, m.start) + String(query.replace ?? ''); last = m.end; }
      out += ta.value.slice(last);
      replaceRange(0, ta.value.length, out, out.length, out.length);
      return matchInfo();
    },
    searchInfo() { return matchInfo(); },
    clearSearch() { query = null; },
    destroy() {
      ta.removeEventListener('input', onInput);
      ta.removeEventListener('keydown', onKeydown);
      host.classList.remove('pe-host', 'pe-has-gutter');
      host.innerHTML = '';
    },
  };
}
