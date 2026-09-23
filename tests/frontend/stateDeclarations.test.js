import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { state } from '../../public/js/state.js';

// Every field the app state carries is declared, with a comment, in state.js.
// A field that only appears once main.js (or a controller or render module)
// reads or patches it is invisible to anyone reading the state shape, and its
// first value is `undefined` rather than a deliberate empty value.

const JS_DIR = new URL('../../public/js/', import.meta.url);
// Modules with a state object of their own (the capture-bar webview).
const OWN_STATE_MODULES = new Set(['captureBar.js', 'captureBarCore.js']);
const declared = new Set(Object.keys(state));

// Blank out comments and string/template text (keeping `${…}` expressions),
// so `state.foo` inside a comment or a string never counts as a read.
function codeOnly(source) {
  let out = '';
  let i = 0;
  const templateDepth = []; // brace depth at which each open `${` resumes its template
  let braces = 0;
  let lastSignificant = '';
  const regexAllowedAfter = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
  function readString(quote) {
    out += quote; i += 1;
    while (i < source.length && source[i] !== quote) {
      if (source[i] === '\\') { out += '  '; i += 2; continue; }
      out += source[i] === '\n' ? '\n' : ' '; i += 1;
    }
    out += quote; i += 1;
  }
  function readTemplate() {
    // Called with i at the opening backtick or just after a closing `}` of `${`.
    while (i < source.length) {
      const ch = source[i];
      if (ch === '\\') { out += '  '; i += 2; continue; }
      if (ch === '`') { out += '`'; i += 1; return 'end'; }
      if (ch === '$' && source[i + 1] === '{') { out += '${'; i += 2; return 'expr'; }
      out += ch === '\n' ? '\n' : ' '; i += 1;
    }
    return 'end';
  }
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') { while (i < source.length && source[i] !== '\n') { out += ' '; i += 1; } continue; }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end < 0 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop; continue;
    }
    if (ch === '/' && regexAllowedAfter.has(lastSignificant)) {
      // A regular-expression literal: skip it, classes included.
      let j = i + 1; let inClass = false;
      while (j < source.length && source[j] !== '\n') {
        if (source[j] === '\\') { j += 2; continue; }
        if (source[j] === '[') inClass = true;
        else if (source[j] === ']') inClass = false;
        else if (source[j] === '/' && !inClass) break;
        j += 1;
      }
      out += source.slice(i, j + 1).replace(/[^\n]/g, ' ');
      i = j + 1; lastSignificant = 'r'; continue;
    }
    if (ch === '"' || ch === "'") { readString(ch); lastSignificant = 's'; continue; }
    if (ch === '`') {
      out += '`'; i += 1;
      if (readTemplate() === 'expr') { templateDepth.push(braces); braces += 1; lastSignificant = '{'; }
      else lastSignificant = 's';
      continue;
    }
    if (ch === '{') braces += 1;
    if (ch === '}') {
      braces -= 1;
      if (templateDepth.length && templateDepth[templateDepth.length - 1] === braces) {
        templateDepth.pop();
        out += '}'; i += 1;
        if (readTemplate() === 'expr') { templateDepth.push(braces); braces += 1; lastSignificant = '{'; }
        else lastSignificant = 's';
        continue;
      }
    }
    out += ch; i += 1;
    if (!/\s/.test(ch)) lastSignificant = /[\w$)\].]/.test(ch) ? 'w' : ch;
  }
  return out;
}

// Top-level keys of every `setState({ … })` object literal (spreads skipped).
function setStateKeys(code) {
  const keys = [];
  for (const match of code.matchAll(/(?<![\w.$])setState\(\s*\{/g)) {
    let i = match.index + match[0].length;
    let depth = 1;
    let expectKey = true;
    while (i < code.length && depth > 0) {
      const ch = code[i];
      if ('({['.includes(ch)) { depth += 1; expectKey = false; i += 1; continue; }
      if (')}]'.includes(ch)) { depth -= 1; i += 1; continue; }
      if (depth === 1 && ch === ',') { expectKey = true; i += 1; continue; }
      if (depth === 1 && expectKey && /[A-Za-z_$]/.test(ch)) {
        const word = /^[A-Za-z_$][\w$]*/.exec(code.slice(i))[0];
        const after = code.slice(i + word.length).match(/^\s*(.)/)?.[1];
        if (after === ':' || after === ',' || after === '}') keys.push(word);
        expectKey = false;
        i += word.length;
        continue;
      }
      if (!/\s/.test(ch) && ch !== '.') expectKey = false;
      if (ch === '.' && code.startsWith('...', i)) { expectKey = false; i += 3; continue; }
      i += 1;
    }
  }
  return keys;
}

function appStateModules() {
  return readdirSync(JS_DIR)
    .filter(name => name.endsWith('.js') && name !== 'state.js' && !OWN_STATE_MODULES.has(name))
    .map(name => ({ name, code: codeOnly(readFileSync(new URL(name, JS_DIR), 'utf8')) }));
}

function undeclaredUses() {
  const missing = new Map();
  for (const { name, code } of appStateModules()) {
    const reads = [...code.matchAll(/(?<![\w.$])state\.([A-Za-z_$][\w$]*)/g)].map(m => m[1]);
    const writes = name === 'main.js' || name.endsWith('Controller.js') ? setStateKeys(code) : [];
    for (const field of [...reads, ...writes]) {
      if (declared.has(field)) continue;
      if (!missing.has(field)) missing.set(field, new Set());
      missing.get(field).add(name);
    }
  }
  return missing;
}

test('every state field main.js, a controller or a render module uses is declared in state.js', () => {
  const missing = [...undeclaredUses()].map(([field, files]) => `${field} (${[...files].join(', ')})`);
  assert.deepEqual(missing, [], `declare these fields in public/js/state.js: ${missing.join('; ')}`);
});

test('the scan sees reads and setState keys, and ignores comments and strings', () => {
  const code = codeOnly([
    "// state.inComment",
    "const s = 'state.inString'; const t = `x ${state.inTemplate} state.inTemplateText`;",
    "if (state.plainRead) setState({ written: 1, ...rest, shorthand, nested: { inner: 2 } });",
    "const re = /state\\.inRegex'/g;",
  ].join('\n'));
  const reads = [...code.matchAll(/(?<![\w.$])state\.([A-Za-z_$][\w$]*)/g)].map(m => m[1]);
  assert.deepEqual(reads, ['inTemplate', 'plainRead']);
  assert.deepEqual(setStateKeys(code), ['written', 'shorthand', 'nested']);
});

test('state.js gives each declared field a comment or a self-describing section', () => {
  const source = readFileSync(new URL('state.js', JS_DIR), 'utf8');
  const body = source.slice(source.indexOf('export const state = {'), source.indexOf('\n};'));
  for (const field of ['documentDraftBase', 'documentInfoDraft', 'confirm', 'inbox', 'collapsedSections',
    'assistantInput', 'assistantApprovalAttempted', 'documentTaskBacklinks', 'documentSimilar', 'libraryTagsExpanded']) {
    const line = body.split('\n').find(text => new RegExp(`^\\s+${field}:`).test(text));
    assert.ok(line, `${field} is declared`);
    assert.match(line, /\/\/ \S/, `${field} carries a one-line comment`);
  }
});
