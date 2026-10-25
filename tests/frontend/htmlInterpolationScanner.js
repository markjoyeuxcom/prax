// Finds `${…}` interpolations in HTML-building template literals whose value
// is not provably escaped. Used by htmlEscaping.test.js; the rules are listed
// under "HTML escaping" in the Prax Library document "Working on Prax (contributor guide)".
//
// This is a small lexer plus a few conservative rules, not a JavaScript
// parser. It reads strings, comments, regex literals and nested template
// literals well enough to find each template's static text and its
// interpolations. A value passes when it is:
//   1. wrapped by an escaper (ESCAPERS, or a const alias of one);
//   2. a literal, number, boolean, comparison, UPPER_CASE constant or
//      constant lookup, or `.length`;
//   3. a call to an HTML builder: a render…/…Html function, SAFE_BUILDERS,
//      or a helper in the same file whose every return value passes;
//   4. built only from passing values (ternary branches, ||, ??, &&, +,
//      template literals, list.map(item => …).join(…));
//   5. a local name whose every binding in the file passes: each `const`,
//      `let` or `var` initialiser, each later assignment, and for a helper's
//      parameter, the argument at every call site; or
//   6. on a line marked `// html-safe: <reason>` (or `/* html-safe: … */`
//      inside the interpolation).
// Anything else is reported. Names resolve per function scope (block scopes
// are merged into their function); values are not followed through object
// fields, other modules or destructuring assignments.

// Wrapping a value in one of these makes it safe in text and in a quoted
// attribute.
export const ESCAPERS = new Set(['escapeHtml', 'escapeAttr', 'cssColor']);

// Functions (imported, so the file cannot see their bodies) that return HTML
// they escaped themselves, or only numbers and booleans. Functions named
// render… or …Html follow the codebase convention for HTML builders and pass
// by name; their own modules are scanned too.
export const SAFE_BUILDERS = new Set([
  'chip', 'icon', 'prioDotClass', 'logo',
  // Enum lookups that always return one of a fixed set of words.
  'apiStatus', 'designStatus', 'externalRefKind',
  'Number', 'Boolean', 'parseInt', 'Math.round', 'Math.floor', 'Math.ceil', 'Math.min', 'Math.max', 'Math.abs',
]);

// Arguments (by position) that a builder escapes itself: a template literal
// there is text, not HTML.
export const ESCAPED_ARGUMENTS = { chip: [0, 1] };
// Arguments a builder inserts as HTML: they must pass like an interpolation.
export const RAW_ARGUMENTS = { chip: [2] };

const BUILDER_NAME = /^(?:render[A-Z]\w*|\w+Html)$/;
// A template whose static text looks like markup (a tag, or an attribute
// such as ` class="`) builds HTML. `[name="…"]` is a CSS selector.
const HTML_TEXT = /<\/?[a-zA-Z!]|(?:^|\s)[\w:-]+=["']/;
// `// html-safe: <reason>` on the line, or `/* html-safe: <reason> */` inside
// the interpolation when the line is template text.
const SAFE_COMMENT = /(?:\/\/|\/\*)\s*html-safe:\s*\S/;
// Array methods whose callback's second parameter is the numeric index.
const INDEXED_CALLBACKS = /\.(?:map|flatMap|forEach|filter|some|every|find|findIndex)\(\s*$/;

// ---------------------------------------------------------------------------
// Lexing
// ---------------------------------------------------------------------------

const REGEX_AFTER = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await']);

function skipString(text, start) {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length && text[i] !== quote && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1;
  return i + 1;
}

function skipRegex(text, start) {
  let i = start + 1;
  let inClass = false;
  while (i < text.length && text[i] !== '\n') {
    const ch = text[i];
    if (ch === '\\') { i += 2; continue; }
    if (inClass) inClass = ch !== ']';
    else if (ch === '[') inClass = true;
    else if (ch === '/') break;
    i += 1;
  }
  i += 1;
  while (/[a-z]/.test(text[i] || '')) i += 1;
  return i;
}

// Lex `source`. Returns every template literal as
// { start, end, text, exprs: [{ code, start, end }], parent: { template, expr } | null }
// (text is the static part) and `masked`: the source with comments and the
// contents of strings, regexes and template text blanked to spaces, so
// declarations can be found with regular expressions.
export function lex(source) {
  const templates = [];
  const masked = source.split('');
  const blank = (from, to) => { for (let k = from; k < to; k += 1) if (masked[k] !== '\n') masked[k] = ' '; };
  const stack = [{ kind: 'code', braces: 0 }];
  let prev = '';
  let prevWord = '';
  let i = 0;

  while (i < source.length) {
    const frame = stack[stack.length - 1];
    const ch = source[i];

    if (frame.kind === 'template') {
      if (ch === '`') {
        frame.record.end = i + 1;
        stack.pop();
        prev = 'a';
        prevWord = '';
        i += 1;
      } else if (ch === '$' && source[i + 1] === '{') {
        const expr = { code: '', start: i + 2, end: -1 };
        frame.record.exprs.push(expr);
        stack.push({ kind: 'code', braces: 0, template: frame.record, expr });
        prev = '{';
        prevWord = '';
        i += 2;
      } else {
        const width = ch === '\\' ? 2 : 1;
        frame.record.text += source.slice(i, i + width);
        blank(i, i + width);
        i += width;
      }
      continue;
    }

    if (ch === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
    } else if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (ch === '"' || ch === "'") {
      const stop = skipString(source, i);
      blank(i + 1, stop - 1);
      prev = 'a';
      prevWord = '';
      i = stop;
    } else if (ch === '/' && (REGEX_AFTER.has(prev) || REGEX_AFTER_WORD.has(prevWord))) {
      const stop = skipRegex(source, i);
      blank(i + 1, stop);
      prev = 'a';
      prevWord = '';
      i = stop;
    } else if (ch === '`') {
      const parent = frame.expr ? { template: frame.template, expr: frame.expr } : null;
      const record = { start: i, end: -1, text: '', exprs: [], parent };
      templates.push(record);
      stack.push({ kind: 'template', record });
      i += 1;
    } else if (ch === '}' && frame.braces === 0 && frame.expr) {
      frame.expr.end = i;
      frame.expr.code = source.slice(frame.expr.start, i);
      stack.pop();
      i += 1;
    } else if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (/[\w$]/.test(source[j] || '')) j += 1;
      prevWord = source.slice(i, j);
      prev = 'a';
      i = j;
    } else {
      if (ch === '{') frame.braces += 1;
      if (ch === '}') frame.braces -= 1;
      if (!/\s/.test(ch)) {
        prev = /[\d.)\]]/.test(ch) ? 'a' : ch;
        prevWord = '';
      }
      i += 1;
    }
  }
  return { templates, masked: masked.join('') };
}

// ---------------------------------------------------------------------------
// Expression helpers (over expression text, strings intact)
// ---------------------------------------------------------------------------

function skipTemplate(text, start) {
  let i = start + 1;
  let depth = 0;
  while (i < text.length) {
    const ch = text[i];
    if (depth === 0) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === '`') return i + 1;
      if (ch === '$' && text[i + 1] === '{') { depth = 1; i += 2; continue; }
    } else if (ch === '`') { i = skipTemplate(text, i); continue; }
    else if (ch === '"' || ch === "'") { i = skipString(text, i); continue; }
    else if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    i += 1;
  }
  return i;
}

// Walk `text` calling visit(i, depth) at each character outside strings and
// templates; visit may return a new index to continue from.
function walk(text, visit) {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"' || ch === "'") { i = skipString(text, i) - 1; continue; }
    if (ch === '`') { i = skipTemplate(text, i) - 1; continue; }
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    const next = visit(i, ch, depth);
    if (next === false) return;
    if (typeof next === 'number') i = next;
  }
}

// An expression is { code, pos }: trimmed text and its offset in the file,
// so names inside it resolve in the right scope.
function expr(code, pos) {
  return { code: code.trim(), pos: pos + (code.length - code.trimStart().length) };
}

// Split at every top-level occurrence of one of `operators`; null if none.
function splitTopLevel(e, operators) {
  const { code } = e;
  const parts = [];
  let last = 0;
  walk(code, (i, ch, depth) => {
    if (depth !== 0 || '([{)]}'.includes(ch)) return undefined;
    const op = operators.find((candidate) => code.startsWith(candidate, i));
    if (!op) return undefined;
    // `=>` is not a comparison; `x++`, `-1` and `1e-3` are not binary.
    const before = code[i - 1] || '';
    const after = code[i + op.length] || '';
    if (op === '>' && before === '=') return undefined;
    if ((op === '<' || op === '>') && (after === '=' || before === op || after === op)) return undefined;
    if ((op === '+' || op === '-') && (after === op || before === op || (/[eE]/.test(before) && /\d/.test(code[i - 2] || '')))) return undefined;
    parts.push(expr(code.slice(last, i), e.pos + last));
    last = i + op.length;
    return i + op.length - 1;
  });
  if (!parts.length) return null;
  parts.push(expr(code.slice(last), e.pos + last));
  return parts.every((part) => part.code) ? parts : null;
}

// [condition, whenTrue, whenFalse] for a top-level ternary, else null.
function splitTernary(e) {
  const { code } = e;
  let question = -1;
  let colon = -1;
  let nested = 0;
  walk(code, (i, ch, depth) => {
    if (depth !== 0) return undefined;
    if (ch === '?' && code[i + 1] !== '.' && code[i + 1] !== '?' && code[i - 1] !== '?') {
      if (question === -1) question = i;
      else nested += 1;
    } else if (ch === ':' && question !== -1) {
      if (nested === 0) { colon = i; return false; }
      nested -= 1;
    }
    return undefined;
  });
  if (question === -1 || colon === -1) return null;
  return [
    expr(code.slice(0, question), e.pos),
    expr(code.slice(question + 1, colon), e.pos + question + 1),
    expr(code.slice(colon + 1), e.pos + colon + 1),
  ];
}

function matchingClose(text, open) {
  let result = -1;
  walk(text.slice(open), (i, ch, depth) => {
    if (')]}'.includes(ch) && depth === 0) { result = open + i; return false; }
    return undefined;
  });
  return result;
}

function stripParens(e) {
  let current = expr(e.code, e.pos);
  while (current.code.startsWith('(') && matchingClose(current.code, 0) === current.code.length - 1) {
    current = expr(current.code.slice(1, -1), current.pos + 1);
  }
  return current;
}

// { callee, args } when `e` is one call spanning the whole expression.
function asCall(e) {
  const { code } = e;
  if (!code.endsWith(')')) return null;
  let open = -1;
  walk(code, (i, ch, depth) => {
    if (ch === '(' && depth === 1 && matchingClose(code, i) === code.length - 1) { open = i; return false; }
    return undefined;
  });
  if (open <= 0) return null;
  const callee = code.slice(0, open).trim().replace(/\?\.$/, '');
  if (!/[\w$\])]$/.test(callee)) return null;
  return { callee, args: splitArgs(code.slice(open + 1, -1), e.pos + open + 1) };
}

function splitArgs(text, pos) {
  const args = [];
  let last = 0;
  walk(text, (i, ch, depth) => {
    if (ch === ',' && depth === 0) { args.push(expr(text.slice(last, i), pos + last)); last = i + 1; }
    return undefined;
  });
  args.push(expr(text.slice(last), pos + last));
  return args.filter((arg) => arg.code);
}

// Read an expression starting at `start` up to a top-level `;` or `,`, or an
// unbalanced closing bracket, in masked source. Returns its end.
function readExpression(masked, start) {
  let depth = 0;
  for (let i = start; i < masked.length; i += 1) {
    const ch = masked[i];
    if (ch === '`') { i = skipTemplate(masked, i) - 1; continue; }
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) { if (depth === 0) return i; depth -= 1; }
    else if (depth === 0 && (ch === ';' || ch === ',')) return i;
  }
  return masked.length;
}

// For a callback starting at `start`, the list expression when it is the
// first argument of list.map( / .filter( / …, else null.
function callbackList(source, masked, start) {
  const before = masked.slice(Math.max(0, start - 200), start);
  const call = INDEXED_CALLBACKS.exec(before);
  if (!call) return null;
  const dot = start - before.length + call.index;
  let i = dot - 1;
  const skipSpace = () => { while (i >= 0 && /\s/.test(masked[i])) i -= 1; };
  skipSpace();
  const end = i + 1;
  let begin = end;
  // Walk back over the receiver chain: names, calls, indexes and dots.
  for (;;) {
    if (masked[i] === ')' || masked[i] === ']') {
      let depth = 0;
      for (; i >= 0; i -= 1) {
        if (')]}'.includes(masked[i])) depth += 1;
        else if ('([{'.includes(masked[i])) { depth -= 1; if (depth === 0) break; }
      }
      begin = i;
      i -= 1;
      skipSpace();
      if (/[\w$)\]]/.test(masked[i] || '')) continue;
      break;
    }
    if (!/[\w$]/.test(masked[i] || '')) break;
    let j = i;
    while (j >= 0 && /[\w$]/.test(masked[j])) j -= 1;
    if (REGEX_AFTER_WORD.has(masked.slice(j + 1, i + 1))) break; // return [a, b].map(…)
    begin = j + 1;
    i = j;
    skipSpace();
    if (masked[i] !== '.') break;
    i -= 1;
    if (masked[i] === '?') i -= 1;
    skipSpace();
  }
  return expr(source.slice(begin, end), begin);
}

// ---------------------------------------------------------------------------
// Scopes and bindings: what every local name can hold
// ---------------------------------------------------------------------------

const IDENT = '[A-Za-z_$][\\w$]*';
const FUNCTION = new RegExp(
  // function name(…) {…}
  `(export\\s+)?(?:async\\s+)?\\bfunction\\s*\\*?\\s*(${IDENT})?\\s*(?=\\()`
  // const name = (…) => …, const name = function (…) {…}
  + `|(export\\s+)?\\b(?:const|let|var)\\s+(${IDENT})\\s*=\\s*(?:async\\s+)?(?:function\\s*\\*?\\s*(?:${IDENT})?\\s*)?(?=\\(|${IDENT}\\s*=>)`
  // (…) => …, x => …
  + `|(?<![\\w$])(?:async\\s+)?(?=\\([^()]*\\)\\s*=>|${IDENT}\\s*=>)`,
  'g',
);

// Every function is a scope (block scopes are merged into their function).
// Each scope maps a name to an entry:
//   bindings: { kind: 'init', expr }      const/let/var initialiser or assignment
//             { kind: 'param', fn, index, fallback }  a named helper's parameter
//             { kind: 'safe' }            no initialiser, or a list callback's index
//             { kind: 'element', list }   a list callback's item
//             { kind: 'field', list }     a field destructured from that item
//             { kind: 'unknown' }         other destructuring and callback
//                                         parameters, catch, for…of, and an
//                                         exported helper's parameters
//   fns:     the functions declared under this name, each with its returns
//   uses:    per use of a named helper, its call arguments (null when it is
//            passed as a value or exported, so its arguments are unknown)
//   pushes:  expressions pushed onto the name (a list)
export function analyse(source) {
  const { templates, masked } = lex(source);
  const moduleScope = { start: 0, end: source.length + 1, parent: null, names: new Map() };
  const scopes = [moduleScope];
  const functions = [];
  const exported = new Set();
  for (const match of masked.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(',')) exported.add(part.trim().split(/\s+/)[0]);
  }

  const claimed = new Set();
  for (const match of masked.matchAll(FUNCTION)) {
    const paramsStart = match.index + match[0].length;
    if (claimed.has(paramsStart)) continue;
    let params;
    let after;
    if (masked[paramsStart] === '(') {
      const close = matchingClose(masked, paramsStart);
      if (close === -1) continue;
      params = splitArgs(source.slice(paramsStart + 1, close), paramsStart + 1);
      after = close + 1;
    } else {
      const ident = new RegExp(`^${IDENT}`).exec(masked.slice(paramsStart));
      if (!ident) continue;
      params = [expr(ident[0], paramsStart)];
      after = paramsStart + ident[0].length;
    }
    const arrow = /^\s*=>\s*/.exec(masked.slice(after));
    if (!arrow && !/^\s*\{/.test(masked.slice(after))) continue; // a call, not a function
    claimed.add(paramsStart);
    const bodyStart = arrow ? after + arrow[0].length : masked.indexOf('{', after);
    const block = masked[bodyStart] === '{';
    const bodyEnd = block ? matchingClose(masked, bodyStart) + 1 : readExpression(masked, bodyStart);
    const name = match[2] || match[4] || null;
    const scope = { start: paramsStart, end: bodyEnd, parent: null, names: new Map() };
    scopes.push(scope);
    functions.push({
      start: match.index, paramsStart, bodyStart, bodyEnd, block, name, scope, params,
      exported: Boolean(match[1] || match[3]) || (name !== null && exported.has(name)),
      // For list.map((item, index) => …): the list expression.
      list: name ? null : callbackList(source, masked, match.index),
      returns: block ? [] : [expr(source.slice(bodyStart, bodyEnd), bodyStart)],
    });
  }

  const scopeAt = (pos) => {
    let best = moduleScope;
    for (const scope of scopes) {
      if (scope.start <= pos && pos < scope.end && scope.end - scope.start < best.end - best.start) best = scope;
    }
    return best;
  };
  for (const scope of scopes) if (scope !== moduleScope) scope.parent = scopeAt(scope.start - 1);
  const entryIn = (scope, name) => {
    if (!scope.names.has(name)) scope.names.set(name, { bindings: [], fns: [], uses: [], pushes: [] });
    return scope.names.get(name);
  };
  const resolve = (name, pos) => {
    for (let scope = scopeAt(pos); scope; scope = scope.parent) if (scope.names.has(name)) return scope.names.get(name);
    return null;
  };

  // A return belongs to the innermost function around it.
  for (const fn of functions) {
    if (!fn.block) continue;
    for (const ret of masked.slice(fn.bodyStart, fn.bodyEnd).matchAll(/\breturn\b/g)) {
      const from = fn.bodyStart + ret.index + ret[0].length;
      if (scopeAt(from) !== fn.scope) continue;
      const to = readExpression(masked, from);
      fn.returns.push(source.slice(from, to).trim() ? expr(source.slice(from, to), from) : expr('undefined', from));
    }
  }

  // Named helpers and parameters.
  for (const fn of functions) {
    if (fn.name) {
      fn.entry = entryIn(scopeAt(fn.start), fn.name);
      fn.entry.fns.push(fn);
    }
    fn.params.forEach((param, index) => {
      const simple = new RegExp(`^(${IDENT})\\s*(?:=([\\s\\S]*))?$`).exec(param.code);
      if (!simple) {
        // A destructured element of a list: each name is one of its fields.
        const binding = fn.list && index === 0 ? { kind: 'field', list: fn.list } : { kind: 'unknown' };
        for (const name of param.code.replace(/:\s*[\w$]+/g, '').match(new RegExp(IDENT, 'g')) || []) {
          entryIn(fn.scope, name).bindings.push(binding);
        }
        return;
      }
      const fallback = simple[2] ? expr(simple[2], param.pos + param.code.indexOf('=') + 1) : null;
      const { bindings } = entryIn(fn.scope, simple[1]);
      if (fn.name && !fn.exported) bindings.push({ kind: 'param', fn, index, fallback });
      else if (fn.list && index === 0) bindings.push({ kind: 'element', list: fn.list });
      else if (fn.list && index === 1) bindings.push({ kind: 'safe' });
      else bindings.push({ kind: 'unknown' });
    });
  }

  // const/let/var declarations, including comma lists and destructuring.
  for (const match of masked.matchAll(/\b(?:const|let|var)\s+/g)) {
    let at = match.index + match[0].length;
    const scope = scopeAt(match.index);
    for (;;) {
      const rest = masked.slice(at);
      const simple = new RegExp(`^(${IDENT})\\s*(=(?![=>])|\\s(?:of|in)\\b)?`).exec(rest);
      if (simple) {
        const entry = entryIn(scope, simple[1]);
        if (!simple[2]) { entry.bindings.push({ kind: 'safe' }); at += simple[0].length; }
        else if (simple[2].trim() !== '=') { entry.bindings.push({ kind: 'unknown' }); break; }
        else {
          const from = at + simple[0].length;
          const to = readExpression(masked, from);
          // A helper is judged by its returns, not by its text.
          if (!functions.some((fn) => fn.name === simple[1] && fn.start === match.index)) {
            entry.bindings.push({ kind: 'init', expr: expr(source.slice(from, to), from) });
          }
          at = to;
        }
      } else if (/^[[{]/.test(rest)) {
        const close = matchingClose(masked, at);
        for (const name of masked.slice(at, close).match(new RegExp(IDENT, 'g')) || []) entryIn(scope, name).bindings.push({ kind: 'unknown' });
        at = readExpression(masked, close + 1);
      } else break;
      if (masked[at] !== ',') break;
      at += 1;
      while (/\s/.test(masked[at] || '')) at += 1;
    }
  }

  // Later assignments, catch parameters, pushes.
  for (const match of masked.matchAll(new RegExp(`(?<![\\w$.])(${IDENT})\\s*(\\+=|\\|\\|=|\\?\\?=|=(?![=>]))`, 'g'))) {
    if (/\b(?:const|let|var)\s+$/.test(masked.slice(Math.max(0, match.index - 8), match.index))) continue;
    const entry = resolve(match[1], match.index);
    if (!entry || !entry.bindings.length) continue; // globals, object keys, parameter defaults
    const from = match.index + match[0].length;
    entry.bindings.push({ kind: 'init', expr: expr(source.slice(from, readExpression(masked, from)), from) });
  }
  for (const match of masked.matchAll(new RegExp(`\\bcatch\\s*\\(\\s*(${IDENT})`, 'g'))) {
    entryIn(scopeAt(match.index + match[0].length), match[1]).bindings.push({ kind: 'unknown' });
  }
  for (const match of masked.matchAll(new RegExp(`(?<![\\w$.])(${IDENT})\\.(?:push|unshift)\\(`, 'g'))) {
    const entry = resolve(match[1], match.index);
    if (!entry) continue;
    const open = match.index + match[0].length - 1;
    entry.pushes.push(...splitArgs(source.slice(open + 1, matchingClose(masked, open)), open + 1));
  }

  // Uses of named helpers.
  for (const fn of functions) {
    if (!fn.name || fn.entry.usesCollected) continue;
    fn.entry.usesCollected = true;
    if (fn.entry.fns.some((named) => named.exported)) fn.entry.uses.push(null);
    for (const use of masked.matchAll(new RegExp(`(?<![\\w$.])${fn.name.replace(/\$/g, '\\$')}(?![\\w$])`, 'g'))) {
      if (resolve(fn.name, use.index) !== fn.entry) continue;
      if (fn.entry.fns.some((named) => use.index >= named.start && use.index < named.paramsStart)) continue; // its declaration
      const after = masked.slice(use.index + fn.name.length);
      if (/^\s*\(/.test(after)) {
        const open = use.index + fn.name.length + after.indexOf('(');
        fn.entry.uses.push(splitArgs(source.slice(open + 1, matchingClose(masked, open)), open + 1));
      } else {
        fn.entry.uses.push(null);
      }
    }
  }

  // `const esc = escapeHtml;` makes esc an escaper too.
  const escapers = new Set(ESCAPERS);
  for (const match of masked.matchAll(new RegExp(`\\bconst\\s+(${IDENT})\\s*=\\s*(${IDENT})\\s*;`, 'g'))) {
    if (ESCAPERS.has(match[2])) escapers.add(match[1]);
  }

  return { source, templates, masked, functions, resolve, escapers };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const CONSTANT = /^[A-Z][A-Z0-9_]*(?:\??\.[A-Za-z_$][\w$]*|\[[^\]]*\])*$/;
const MEMBER_PATH = /^([A-Za-z_$][\w$]*)((?:\??\.[A-Za-z_$][\w$]*|\[[^\]]*\])*)$/;
const NAME = /^[A-Za-z_$][\w$]*$/;

// Is the expression `e` ({ code, pos }) safe to insert into HTML?
// `nestedChecked`: a template literal here sits inside an HTML template and
// is scanned on its own, so it passes at this level.
export function isSafeExpression(e, info, { nestedChecked = false, seen = new Set() } = {}) {
  const current = stripParens(e);
  const { code } = current;
  const again = (part, nested = nestedChecked) => isSafeExpression(part, info, { nestedChecked: nested, seen });
  if (!code) return true;

  if (/^-?(?:\d[\d_]*\.?\d*(?:e[+-]?\d+)?|0x[\da-f]+)$/i.test(code)) return true;
  if (/^(?:true|false|null|undefined|NaN)$/.test(code)) return true;
  if (/^'(?:[^'\\\n]|\\.)*'$/.test(code) || /^"(?:[^"\\\n]|\\.)*"$/.test(code)) return true;
  // A template literal that looks like markup is scanned on its own, as is
  // one nested in an HTML template; any other must pass here.
  if (code.startsWith('`') && skipTemplate(code, 0) === code.length) {
    const outer = lex(code).templates.find((template) => !template.parent);
    return nestedChecked || HTML_TEXT.test(outer.text)
      || outer.exprs.every((inner) => again(expr(inner.code, current.pos + inner.start), false));
  }

  const ternary = splitTernary(current);
  if (ternary) {
    // `Number.isInteger(x) ? x : …` and `typeof x === 'number' ? x : …` print a number.
    const numeric = /^(?:Number\.is(?:Integer|Finite|SafeInteger)\((.+)\)|typeof\s+(.+?)\s*===?\s*'number')$/s.exec(ternary[0].code);
    const checked = numeric && (numeric[1] || numeric[2]).trim() === ternary[1].code;
    return (checked || again(ternary[1])) && again(ternary[2]);
  }
  const either = splitTopLevel(current, ['||', '??']);
  if (either) return either.every((part) => again(part));
  // `a && b` prints a only when it is falsy: false, 0, '', null, undefined, NaN.
  const both = splitTopLevel(current, ['&&']);
  if (both) return again(both[both.length - 1]);
  if (splitTopLevel(current, ['===', '!==', '==', '!=', '<=', '>=', '<', '>', ' instanceof ', ' in '])) return true;
  const sum = splitTopLevel(current, ['+']);
  if (sum) return sum.every((part) => again(part));
  if (splitTopLevel(current, ['-', '*', '/', '%'])) return true;
  if (/^(?:!|typeof\s|void\s|[-+~](?![-+]))/.test(code)) return true;
  if (/^(?:(?:\+\+|--)[\w$.]+|[\w$.]+(?:\+\+|--))$/.test(code)) return true;

  if (CONSTANT.test(code)) return true;
  if (/\??\.(?:length|size)$/.test(code)) return true;

  const call = asCall(current);
  if (call) return isSafeCall(call, current, info, seen, nestedChecked);

  const member = MEMBER_PATH.exec(code);
  if (member) {
    const [, root, path] = member;
    // A field of an object that came from a constant table.
    if (path) return /Html$/.test(code) || isConstantObject(root, current.pos, info, seen);
    return isSafeName(root, current.pos, info, seen, /Html$/.test(root));
  }
  return false;
}

function isSafeCall(call, e, info, seen, nestedChecked) {
  const { callee, args } = call;
  const name = callee.replace(/^.*\./, '');
  const all = (list) => list.every((arg) => isSafeExpression(arg, info, { seen }));
  if (info.escapers.has(callee)) return true;
  if (BUILDER_NAME.test(name)) return true;
  // A helper in this file (which may shadow an import): every return value must pass.
  if (NAME.test(callee)) {
    const entry = info.resolve(callee, e.pos);
    if (entry && entry.fns.length) return entry.fns.every((fn) => isSafeReturns(fn, info, seen, false));
  }
  // A builder's raw-HTML arguments must pass like any interpolation.
  if (SAFE_BUILDERS.has(callee)) return (RAW_ARGUMENTS[callee] || []).every((index) => !args[index] || isSafeExpression(args[index], info, { seen }));
  if (callee === 'String') return all(args);
  // Methods that return numbers or booleans.
  if (/\.(?:toFixed|toPrecision|getTime|indexOf|findIndex|includes|has|some|every|test|isInteger)$/.test(callee)) return true;
  // A string method on a safe string stays safe.
  const method = /^(.*)\.(?:trim|trimStart|trimEnd|toLowerCase|toUpperCase|slice|padStart|padEnd)$/s.exec(callee);
  if (method) return isSafeExpression(expr(method[1], e.pos), info, { seen }) && all(args);
  // list.join(separator): every element and the separator must pass.
  const join = /^(.*)\.join$/s.exec(callee);
  if (join) return all(args) && isSafeList(expr(join[1], e.pos), info, seen, nestedChecked);
  return false;
}

function isSafeReturns(fn, info, seen, nestedChecked) {
  if (seen.has(fn)) return true; // recursion: the other returns decide
  const next = new Set(seen).add(fn);
  return fn.returns.every((ret) => isSafeExpression(ret, info, { seen: next, nestedChecked }));
}

// Is `e` a list whose elements all pass?
function isSafeList(e, info, seen, nestedChecked) {
  const current = stripParens(e);
  const { code } = current;
  if (code.startsWith('[') && matchingClose(code, 0) === code.length - 1) {
    return splitArgs(code.slice(1, -1), current.pos + 1).every((item) => (item.code.startsWith('...')
      ? isSafeList(expr(item.code.slice(3), item.pos + 3), info, seen, nestedChecked)
      : isSafeExpression(item, info, { seen, nestedChecked })));
  }
  const call = asCall(current);
  if (call) {
    const method = /^(.*)\.(map|flatMap|filter|slice|concat|reverse|sort|toSorted)$/s.exec(call.callee);
    if (!method) return false;
    if (method[2] === 'map' || method[2] === 'flatMap') return Boolean(call.args[0]) && isSafeCallback(call.args[0], info, seen, nestedChecked);
    return isSafeList(expr(method[1], current.pos), info, seen, nestedChecked)
      && (method[2] !== 'concat' || call.args.every((arg) => isSafeList(arg, info, seen, nestedChecked)));
  }
  const ternary = splitTernary(current);
  if (ternary) return isSafeList(ternary[1], info, seen, nestedChecked) && isSafeList(ternary[2], info, seen, nestedChecked);
  const either = splitTopLevel(current, ['||', '??']);
  if (either) return either.every((part) => isSafeList(part, info, seen, nestedChecked));
  if (CONSTANT.test(code)) return true;
  if (NAME.test(code)) {
    const entry = info.resolve(code, current.pos);
    if (!entry || !entry.bindings.length) return false;
    if (seen.has(entry)) return true;
    const next = new Set(seen).add(entry);
    return entry.bindings.every((binding) => binding.kind === 'init' && isSafeList(binding.expr, info, next, false))
      && entry.pushes.every((item) => (item.code.startsWith('...')
        ? isSafeList(expr(item.code.slice(3), item.pos + 3), info, next, false)
        : isSafeExpression(item, info, { seen: next })));
  }
  return false;
}

// The callback of a .map(): a function whose results pass, or a named
// builder or helper.
function isSafeCallback(arg, info, seen, nestedChecked) {
  const fn = info.functions.find((candidate) => !candidate.name && candidate.start === arg.pos);
  if (fn) return isSafeReturns(fn, info, seen, nestedChecked);
  if (BUILDER_NAME.test(arg.code)) return true;
  if (NAME.test(arg.code)) {
    const entry = info.resolve(arg.code, arg.pos);
    if (entry && entry.fns.length) return entry.fns.every((named) => isSafeReturns(named, info, seen, false));
  }
  return SAFE_BUILDERS.has(arg.code) && !RAW_ARGUMENTS[arg.code];
}

// `trustUnknown`: a …Html name that arrives from outside the file (an
// exported function's parameter) is HTML by the caller's contract.
function isSafeName(name, pos, info, seen, trustUnknown = false) {
  const entry = info.resolve(name, pos);
  if (!entry || (!entry.bindings.length && !entry.fns.length)) return trustUnknown;
  if (seen.has(entry)) return true; // a cycle (x = x + …): the other bindings decide
  if (entry.fns.length) return false; // a function itself, not its result
  const next = new Set(seen).add(entry);
  return entry.bindings.every((binding) => {
    if (binding.kind === 'safe') return true;
    if (binding.kind === 'unknown') return trustUnknown;
    if (binding.kind === 'init') return isSafeExpression(binding.expr, info, { seen: next });
    if (binding.kind === 'element') return isConstantList(binding.list, info, next) || isSafeList(binding.list, info, next, false);
    if (binding.kind === 'field') return isConstantList(binding.list, info, next);
    // A helper's parameter: its default and the argument at every call.
    if (binding.fallback && !isSafeExpression(binding.fallback, info, { seen: next })) return false;
    return binding.fn.entry.uses.every((args) => args !== null
      && (args[binding.index] === undefined || isSafeExpression(args[binding.index], info, { seen: next })));
  });
}

// Every binding of `name` is a constant: an UPPER_CASE table lookup, an
// object literal of passing values, or a helper returning one of those.
function isConstantObject(name, pos, info, seen) {
  if (CONSTANT.test(name)) return true;
  const entry = info.resolve(name, pos);
  if (!entry || !entry.bindings.length || seen.has(entry)) return false;
  const next = new Set(seen).add(entry);
  return entry.bindings.every((binding) => {
    if (binding.kind === 'init') return isConstantExpr(binding.expr, info, next);
    if (binding.kind === 'element' || binding.kind === 'field') return isConstantList(binding.list, info, next);
    // A helper's parameter: a constant at every call.
    if (binding.kind !== 'param' || (binding.fallback && !isConstantExpr(binding.fallback, info, next))) return false;
    return binding.fn.entry.uses.every((args) => args !== null
      && (args[binding.index] === undefined || isConstantExpr(args[binding.index], info, next)));
  });
}

// A list of constants: an UPPER_CASE table, a literal of constants, or a
// filtered, sliced or sorted one of those.
function isConstantList(e, info, seen) {
  const current = stripParens(e);
  const { code } = current;
  if (CONSTANT.test(code)) return true;
  if (code.startsWith('[') && matchingClose(code, 0) === code.length - 1) {
    return splitArgs(code.slice(1, -1), current.pos + 1).every((item) => (item.code.startsWith('...')
      ? isConstantList(expr(item.code.slice(3), item.pos + 3), info, seen)
      : isConstantExpr(item, info, seen)));
  }
  const ternary = splitTernary(current);
  if (ternary) return isConstantList(ternary[1], info, seen) && isConstantList(ternary[2], info, seen);
  const call = asCall(current);
  const method = call && /^(.*)\.(filter|slice|concat|reverse|sort|toSorted)$/s.exec(call.callee);
  if (method) return isConstantList(expr(method[1], current.pos), info, seen);
  const member = MEMBER_PATH.exec(code);
  if (!member) return false;
  if (member[2]) return isConstantObject(member[1], current.pos, info, seen);
  const entry = info.resolve(code, current.pos);
  if (!entry || !entry.bindings.length || seen.has(entry)) return false;
  const next = new Set(seen).add(entry);
  return entry.bindings.every((binding) => binding.kind === 'init' && isConstantList(binding.expr, info, next));
}

function isConstantExpr(e, info, seen) {
  const current = stripParens(e);
  const { code } = current;
  const either = splitTopLevel(current, ['||', '??']);
  if (either) return either.every((part) => isConstantExpr(part, info, seen));
  const ternary = splitTernary(current);
  if (ternary) return isConstantExpr(ternary[1], info, seen) && isConstantExpr(ternary[2], info, seen);
  if (CONSTANT.test(code)) return true;
  if (/^[A-Z][A-Z0-9_]*\.find\(/.test(code) && asCall(current)) return true;
  if (code.startsWith('[') && matchingClose(code, 0) === code.length - 1) return isConstantList(current, info, seen);
  if (!/^[{\w$]/.test(code) || /^(?:true|false|null|undefined|-?\d)/.test(code)) return isSafeExpression(current, info, { seen });
  if (code.startsWith('{') && matchingClose(code, 0) === code.length - 1) {
    return splitArgs(code.slice(1, -1), current.pos + 1).every((prop) => {
      const colon = /^[\w$'"-]+\s*:/.exec(prop.code);
      const value = colon ? expr(prop.code.slice(colon[0].length), prop.pos + colon[0].length) : prop;
      return isSafeExpression(value, info, { seen });
    });
  }
  const call = asCall(current);
  if (call && NAME.test(call.callee)) {
    const entry = info.resolve(call.callee, current.pos);
    return Boolean(entry && entry.fns.length) && entry.fns.every((fn) => !seen.has(fn)
      && fn.returns.every((ret) => isConstantExpr(ret, info, new Set(seen).add(fn))));
  }
  const member = MEMBER_PATH.exec(code);
  return Boolean(member) && isConstantObject(member[1], current.pos, info, seen);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

// Is the end of `prefix` inside an argument that an escaper, or a builder
// that escapes that argument, will escape?
function insideEscapedArgument(prefix, escapers) {
  const stack = [];
  walk(prefix, (i, ch) => {
    if ('([{'.includes(ch)) {
      const callee = ch === '(' ? (/([\w$.]+)\s*$/.exec(prefix.slice(0, i))?.[1] || '') : '';
      stack.push({ callee: callee.replace(/^.*\./, ''), argument: 0 });
    } else if (')]}'.includes(ch)) stack.pop();
    else if (ch === ',' && stack.length) stack[stack.length - 1].argument += 1;
    return undefined;
  });
  return stack.some(({ callee, argument }) => escapers.has(callee) || ESCAPED_ARGUMENTS[callee]?.includes(argument));
}

function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (source[i] === '\n') line += 1;
  return line;
}

// Every interpolation in an HTML-building template of `source` that does not
// pass: [{ line, code }]. A template builds HTML when its static text looks
// like markup, or when it sits in another HTML template's interpolation (the
// body of a .map(), a ternary branch) outside an escaper.
export function findUnescapedInterpolations(source) {
  const info = analyse(source);
  const lines = source.split('\n');
  const html = new Set();
  const findings = [];

  for (const template of info.templates) {
    const inHtml = template.parent && html.has(template.parent.template)
      && !insideEscapedArgument(source.slice(template.parent.expr.start, template.start), info.escapers);
    if (!HTML_TEXT.test(template.text) && !inHtml) continue;
    html.add(template);
    for (const inner of template.exprs) {
      const first = lineOf(source, inner.start);
      const last = lineOf(source, inner.end);
      if (lines.slice(first - 1, last).some((line) => SAFE_COMMENT.test(line))) continue;
      if (isSafeExpression(expr(inner.code, inner.start), info, { nestedChecked: true })) continue;
      findings.push({ line: first, code: inner.code.trim().replace(/\s+/g, ' ') });
    }
  }
  return findings;
}
