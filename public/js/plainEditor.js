import { applyMarkdownFormat, continueListOnEnter } from './markdownEditor.js';

// A dependency-free Markdown editor (the "highlight-behind-textarea" pattern) —
// a drop-in alternative to mountCodeMirrorEditor. A real <textarea> does all the
// hard editing (cursor, selection, undo/redo, IME, clipboard, mobile, a11y —
// correctly, for free); behind it, layers mirror the text with syntax
// highlighting and painted search-match backgrounds. All layers share identical
// font/metrics so they stay aligned, including soft-wrapping.
//
// At parity with the CodeMirror mount: markdown highlighting, wrap-aware line
// numbers, find/replace with painted highlights, [[wiki-link]] + /slash
// autocomplete, list continuation, and the markdown toolbar. Still out of scope:
// viewport virtualization (fine at note/runbook scale), multi-cursor, folding.

const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
function esc(s) { return String(s).replace(/[&<>]/g, (c) => HTML_ESC[c]); }

// Mirrors CodeMirror's slash menu — actions reuse applyMarkdownFormat.
export const SLASH_COMMANDS = [
  { key: 'heading', action: 'heading', detail: 'H2 heading' },
  { key: 'bullet', action: 'bullet-list', detail: '• bullet list' },
  { key: 'numbered', action: 'numbered-list', detail: '1. numbered list' },
  { key: 'task', action: 'checklist', detail: '☐ to-do item' },
  { key: 'quote', action: 'quote', detail: '❝ blockquote' },
  { key: 'code', action: 'code-block', detail: '‹⁄› code block' },
  { key: 'bold', action: 'bold', detail: 'bold text' },
  { key: 'italic', action: 'italic', detail: 'italic text' },
  { key: 'inline-code', action: 'code', detail: 'inline code' },
  { key: 'link', action: 'link', detail: 'link' },
];

// ---- syntax highlighting ----------------------------------------------------
function inline(escaped) {
  return escaped
    .replace(/(`[^`\n]+`)/g, '<span class="pe-t-code">$1</span>')
    .replace(/(\*\*[^*\n]+\*\*|__[^_\n]+__)/g, '<span class="pe-t-strong">$1</span>')
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

// text -> HTML: one <div class="pe__line" data-ln="N"> per line. Pure.
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

// ---- painted search matches -------------------------------------------------
// text + match ranges -> per-line <mark>s (current match distinct). The layer's
// text is transparent (CSS); only the <mark> backgrounds show. Pure.
export function renderMarks(text, matches, currentIndex = -1) {
  const src = String(text ?? '');
  const lines = src.split('\n');
  const ms = (Array.isArray(matches) ? matches : []).slice().sort((a, b) => a.start - b.start);
  let out = '';
  let offset = 0;
  for (const line of lines) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    let html = '';
    let cursor = lineStart;
    for (let mi = 0; mi < ms.length; mi += 1) {
      const m = ms[mi];
      if (m.end <= lineStart || m.start >= lineEnd) continue;
      const s = Math.max(m.start, lineStart);
      const e = Math.min(m.end, lineEnd);
      if (s > cursor) html += esc(src.slice(cursor, s));
      html += `<mark class="pe-m${mi === currentIndex ? ' pe-m-current' : ''}">${esc(src.slice(s, e))}</mark>`;
      cursor = e;
    }
    if (cursor < lineEnd) html += esc(src.slice(cursor, lineEnd));
    out += `<div class="pe__line">${html}</div>`;
    offset = lineEnd + 1;
  }
  return out;
}

// ---- completion detection ---------------------------------------------------
// At the caret: an open [[wiki or a /slash at line start. Pure. from/to are
// absolute offsets of the query (slash includes the leading '/').
export function detectCompletion(text, caret) {
  const src = String(text ?? '');
  const before = src.slice(Math.max(0, caret - 200), caret);
  const wiki = /\[\[([^\]\n[]*)$/.exec(before);
  if (wiki) return { kind: 'wiki', from: caret - wiki[1].length, to: caret, query: wiki[1] };
  const lineStart = src.lastIndexOf('\n', caret - 1) + 1;
  const slash = /^\s*\/(\w*)$/.exec(src.slice(lineStart, caret));
  if (slash) return { kind: 'slash', from: caret - slash[1].length - 1, to: caret, query: slash[1] };
  return null;
}

// ---- search ranges ----------------------------------------------------------
function buildRegex({ search, caseSensitive, regexp, wholeWord } = {}) {
  if (!search) return null;
  let s = regexp ? search : search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (wholeWord) s = `\\b(?:${s})\\b`;
  try { return new RegExp(s, caseSensitive ? 'g' : 'gi'); } catch { return false; }
}

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

export function mountPlainEditor({ host, value = '', onChange, onSave, documentsProvider, lineNumbers = false, cursorToEnd = true } = {}) {
  if (!host) return null;
  const doc = globalThis.document;

  host.classList.add('pe-host');
  host.classList.toggle('pe-has-gutter', Boolean(lineNumbers));

  const scroll = doc.createElement('div'); scroll.className = 'pe__scroll';
  const stack = doc.createElement('div'); stack.className = 'pe__doc';
  const marks = doc.createElement('div'); marks.className = 'pe__marks'; marks.setAttribute('aria-hidden', 'true');
  const lines = doc.createElement('div'); lines.className = 'pe__lines'; lines.setAttribute('aria-hidden', 'true');
  const ta = doc.createElement('textarea');
  ta.className = 'pe__input';
  ta.spellcheck = false;
  ta.setAttribute('autocapitalize', 'off');
  ta.setAttribute('autocomplete', 'off');
  ta.setAttribute('autocorrect', 'off');
  ta.value = String(value ?? '');
  // A subtle highlight behind the line the caret is on (like CodeMirror).
  const activeLine = doc.createElement('div');
  activeLine.className = 'pe__activeline';
  activeLine.setAttribute('aria-hidden', 'true');
  activeLine.hidden = true;
  // Our own caret (the native one is hidden via caret-color). It's positioned
  // from the highlight layer's real geometry, so it stays exact on engines
  // (WebKit webviews) that render a <textarea>'s caret off the styled text.
  const caret = doc.createElement('div');
  caret.className = 'pe__caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.hidden = true;
  stack.append(activeLine, marks, lines, ta, caret);
  scroll.append(stack);
  host.append(scroll);

  const pop = doc.createElement('div');
  pop.className = 'pe__pop';
  pop.hidden = true;
  doc.body.append(pop);

  let query = null;
  let comp = null;

  function paint() { lines.innerHTML = highlightMarkdown(ta.value); }
  function paintMarks() {
    if (!query || !query.search) { marks.innerHTML = ''; return; }
    const { matches } = findMatches(ta.value, query);
    const cur = matches.findIndex((m) => m.start === ta.selectionStart && m.end === ta.selectionEnd);
    marks.innerHTML = renderMarks(ta.value, matches, cur);
  }
  paint();

  function emitChange() {
    paint();
    paintMarks();
    if (typeof onChange === 'function') onChange(ta.value);
    updateComp();
    updateCaret();
  }

  function replaceRange(start, end, insert, caretStart, caretEnd) {
    ta.focus();
    ta.setSelectionRange(start, end);
    let ok = false;
    try { ok = doc.execCommand('insertText', false, insert); } catch { ok = false; }
    if (!ok) ta.value = ta.value.slice(0, start) + insert + ta.value.slice(end);
    ta.setSelectionRange(caretStart ?? start + insert.length, caretEnd ?? start + insert.length);
    emitChange();
  }

  function applyFormat(action) {
    const r = applyMarkdownFormat(ta.value, ta.selectionStart, ta.selectionEnd, action);
    replaceRange(0, ta.value.length, r.value, r.selectionStart, r.selectionEnd);
  }

  // ---- completion popup ----
  function wikiItems(q) {
    const needle = q.toLowerCase();
    const docs = (typeof documentsProvider === 'function' ? documentsProvider() : []) || [];
    return docs.filter((d) => d && d.title && d.title.toLowerCase().includes(needle))
      .slice(0, 50)
      .map((d) => ({ label: d.title, detail: 'doc', insert: d.title }));
  }
  function slashItems(q) {
    const needle = q.toLowerCase();
    return SLASH_COMMANDS.filter((c) => c.key.startsWith(needle))
      .map((c) => ({ label: `/${c.key}`, detail: c.detail, action: c.action }));
  }
  function closeComp() { comp = null; pop.hidden = true; pop.innerHTML = ''; }
  function renderPop() {
    pop.innerHTML = comp.items.map((it, i) =>
      `<div class="pe__pop-item${i === comp.sel ? ' is-sel' : ''}" data-i="${i}">`
      + `<span class="pe__pop-label">${esc(it.label)}</span>`
      + (it.detail ? `<span class="pe__pop-detail">${esc(it.detail)}</span>` : '')
      + '</div>').join('');
    const sel = pop.querySelector('.is-sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
  function positionPop() {
    const r = caretRect(ta.selectionStart);
    if (!r) return;
    pop.style.left = `${Math.round(r.left)}px`;
    pop.style.top = `${Math.round(r.lineTop + r.lineHeight)}px`;
  }
  function updateComp() {
    if (ta.selectionStart !== ta.selectionEnd) { closeComp(); return; }
    const ctx = detectCompletion(ta.value, ta.selectionStart);
    if (!ctx) { closeComp(); return; }
    const items = ctx.kind === 'wiki' ? wikiItems(ctx.query) : slashItems(ctx.query);
    if (!items.length) { closeComp(); return; }
    comp = { ...ctx, items, sel: 0 };
    renderPop();
    positionPop();
    pop.hidden = false;
  }
  function acceptComp(i) {
    if (!comp) return;
    const item = comp.items[i == null ? comp.sel : i];
    const ctx = comp;
    closeComp();
    if (!item) return;
    if (ctx.kind === 'wiki') {
      const after = ta.value.slice(ctx.to, ctx.to + 2);
      const close = after === ']]' ? '' : ']]';
      replaceRange(ctx.from, ctx.to, item.insert + close, ctx.from + item.insert.length + close.length);
    } else {
      replaceRange(ctx.from, ctx.to, '');
      applyFormat(item.action);
    }
  }

  // Caret + popup positioning read the HIGHLIGHT layer's real geometry (what the
  // user sees) rather than the <textarea>'s own metrics — WebKit webviews place
  // a textarea's caret/line box a little differently than a <div>, drifting a
  // native caret off the styled text. Measuring the visible layer is pixel-exact
  // on every engine. The native caret is hidden (caret-color: transparent) and
  // we paint our own from these coordinates.
  function nodeAtColumn(lineEl, col) {
    const walker = doc.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT, null);
    let acc = 0; let node = null;
    while ((node = walker.nextNode())) {
      const len = node.nodeValue.length;
      if (acc + len >= col) return { node, offset: col - acc };
      acc += len;
    }
    return node ? { node, offset: node.nodeValue.length } : null;
  }
  // One consistent caret height: the text glyph line (not the full line box),
  // measured from a real character so an empty/new line's caret matches a text
  // line's instead of falling back to the taller line-box height.
  function glyphHeight(lineH) {
    for (const el of lines.children) {
      if (!el.textContent) continue;
      const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      const node = walker.nextNode();
      if (node && node.nodeValue.length) {
        const rg = doc.createRange();
        rg.setStart(node, 0); rg.setEnd(node, 1);
        const h = rg.getBoundingClientRect().height;
        if (h) return Math.round(h);
      }
    }
    return Math.round(lineH * 0.82);
  }
  // Viewport-space caret + line geometry at a source offset, from the highlight
  // layer (wrap-aware). The caret is a fixed glyphHeight tall, centred in its
  // visual row, so it's identical on text, empty, and wrapped lines.
  function caretRect(offset) {
    const before = ta.value.slice(0, offset);
    const lineIndex = (before.match(/\n/g) || []).length;
    const col = offset - (before.lastIndexOf('\n') + 1);
    const lineEl = lines.children[lineIndex];
    if (!lineEl) return null;
    const lineBox = lineEl.getBoundingClientRect();
    const lineH = parseFloat(getComputedStyle(ta).lineHeight) || lineBox.height || 20;
    const h = glyphHeight(lineH);
    let left = lineBox.left;
    let rowIndex = 0;
    const pos = col > 0 ? nodeAtColumn(lineEl, col) : null;
    if (pos) {
      const range = doc.createRange();
      range.setStart(lineEl, 0);
      range.setEnd(pos.node, pos.offset);
      const rects = range.getClientRects();
      const r = rects.length ? rects[rects.length - 1] : lineBox;
      left = r.right;
      rowIndex = Math.max(0, Math.round((r.top - lineBox.top) / lineH));
    }
    const top = lineBox.top + rowIndex * lineH + (lineH - h) / 2;
    return { left, top, height: h, lineTop: lineBox.top, lineHeight: lineBox.height };
  }
  // Paint our caret + active-line highlight, or hide both when the textarea is
  // unfocused or has a (non-empty) selection.
  function updateCaret() {
    if (doc.activeElement !== ta || ta.selectionStart !== ta.selectionEnd) {
      caret.hidden = true; activeLine.hidden = true; return;
    }
    const r = caretRect(ta.selectionStart);
    if (!r) { caret.hidden = true; activeLine.hidden = true; return; }
    const box = stack.getBoundingClientRect();
    caret.style.left = `${r.left - box.left}px`;
    caret.style.top = `${r.top - box.top}px`;
    caret.style.height = `${r.height}px`;
    caret.hidden = false;
    // Restart the blink so the caret is solid immediately after it moves.
    caret.classList.remove('pe__caret--on'); void caret.offsetWidth; caret.classList.add('pe__caret--on');
    activeLine.style.top = `${r.lineTop - box.top}px`;
    activeLine.style.height = `${r.lineHeight}px`;
    activeLine.hidden = false;
  }

  function onKeydown(e) {
    if (comp) {
      if (e.key === 'ArrowDown') { e.preventDefault(); comp.sel = (comp.sel + 1) % comp.items.length; renderPop(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); comp.sel = (comp.sel - 1 + comp.items.length) % comp.items.length; renderPop(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acceptComp(); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeComp(); return; }
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) closeComp();
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault(); if (typeof onSave === 'function') onSave(); return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); applyFormat('bold'); return; }
      if (k === 'i') { e.preventDefault(); applyFormat('italic'); return; }
      if (k === 'e') { e.preventDefault(); applyFormat('code'); return; }
    }
    if (e.key === 'Tab') { e.preventDefault(); replaceRange(ta.selectionStart, ta.selectionEnd, '  '); return; }
    if (e.key === 'Enter' && !e.shiftKey && ta.selectionStart === ta.selectionEnd) {
      const pos = ta.selectionStart;
      const lineStart = ta.value.lastIndexOf('\n', pos - 1) + 1;
      const nl = ta.value.indexOf('\n', pos);
      const lineEnd = nl === -1 ? ta.value.length : nl;
      if (pos !== lineEnd) return;
      const r = continueListOnEnter(ta.value.slice(lineStart, lineEnd));
      if (r.action === 'exit') { e.preventDefault(); replaceRange(lineStart, lineEnd, ''); return; }
      if (r.action === 'continue') { e.preventDefault(); replaceRange(pos, pos, `\n${r.prefix}`); return; }
    }
  }

  function matchInfo() {
    if (!query || !query.search) return { total: 0, current: 0, valid: true };
    const { valid, matches } = findMatches(ta.value, query);
    if (!valid) return { total: 0, current: 0, valid: false };
    const caret = ta.selectionStart;
    const idx = matches.findIndex((m) => m.start >= caret);
    return { total: matches.length, current: matches.length ? (idx === -1 ? matches.length : idx + 1) : 0, valid: true };
  }
  function gotoMatch(dir) {
    const { valid, matches } = findMatches(ta.value, query || {});
    if (!valid || !matches.length) { paintMarks(); return matchInfo(); }
    const caret = dir >= 0 ? ta.selectionEnd : ta.selectionStart;
    const target = dir >= 0
      ? (matches.find((m) => m.start >= caret) || matches[0])
      : ([...matches].reverse().find((m) => m.end <= caret) || matches[matches.length - 1]);
    ta.focus();
    ta.setSelectionRange(target.start, target.end);
    scrollSelectionIntoView();
    paintMarks();
    return matchInfo();
  }
  function scrollSelectionIntoView() {
    const line = ta.value.slice(0, ta.selectionStart).split('\n').length - 1;
    const lineH = lines.firstChild ? (lines.firstChild.getBoundingClientRect().height || 24) : 24;
    scroll.scrollTop = Math.max(0, line * lineH - scroll.clientHeight / 2);
  }

  const onSelectionChange = () => { if (doc.activeElement === ta) updateCaret(); };
  ta.addEventListener('input', emitChange);
  ta.addEventListener('keydown', onKeydown);
  ta.addEventListener('click', updateComp);
  ta.addEventListener('focus', updateCaret);
  ta.addEventListener('blur', () => { caret.hidden = true; activeLine.hidden = true; setTimeout(closeComp, 120); });
  doc.addEventListener('selectionchange', onSelectionChange);
  globalThis.addEventListener?.('resize', updateCaret);
  scroll.addEventListener('scroll', () => { if (comp) positionPop(); });
  pop.addEventListener('mousedown', (e) => {
    const item = e.target.closest('[data-i]');
    if (item) { e.preventDefault(); acceptComp(Number(item.dataset.i)); }
  });
  if (cursorToEnd) ta.setSelectionRange(ta.value.length, ta.value.length);

  return {
    getValue() { return ta.value; },
    focus() { ta.focus(); },
    getSelectionText() { return ta.value.slice(ta.selectionStart, ta.selectionEnd); },
    scrollToLine(lineNumber) {
      const target = Math.max(0, Number(lineNumber) || 0);
      const offset = ta.value.split('\n').slice(0, target).join('\n').length + (target > 0 ? 1 : 0);
      ta.focus(); ta.setSelectionRange(offset, offset); scrollSelectionIntoView();
    },
    applyFormat,
    applySearch(q = {}) { query = q; paintMarks(); return matchInfo(); },
    searchNext() { return gotoMatch(1); },
    searchPrevious() { return gotoMatch(-1); },
    replaceMatch() {
      const { matches } = findMatches(ta.value, query || {});
      const hit = matches.some((m) => m.start === ta.selectionStart && m.end === ta.selectionEnd) && ta.selectionStart !== ta.selectionEnd;
      if (hit) replaceRange(ta.selectionStart, ta.selectionEnd, String(query.replace ?? ''));
      return gotoMatch(1);
    },
    replaceAllMatches() {
      const { valid, matches } = findMatches(ta.value, query || {});
      if (!valid || !matches.length) return matchInfo();
      let out = ''; let last = 0;
      for (const m of matches) { out += ta.value.slice(last, m.start) + String(query.replace ?? ''); last = m.end; }
      out += ta.value.slice(last);
      replaceRange(0, ta.value.length, out, out.length, out.length);
      return matchInfo();
    },
    searchInfo() { return matchInfo(); },
    clearSearch() { query = null; paintMarks(); },
    destroy() {
      ta.removeEventListener('input', emitChange);
      ta.removeEventListener('keydown', onKeydown);
      ta.removeEventListener('click', updateComp);
      doc.removeEventListener('selectionchange', onSelectionChange);
      globalThis.removeEventListener?.('resize', updateCaret);
      pop.remove();
      caret.remove();
      activeLine.remove();
      host.classList.remove('pe-host', 'pe-has-gutter');
      host.innerHTML = '';
    },
  };
}
