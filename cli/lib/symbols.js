// Enclosing-symbol heuristic for code citations — the third citation anchor.
//
// A line hash dies with any edit and a whitespace-free content hash dies with
// any real edit, but the function a claim is about usually survives both: it
// is what a person would search for to re-cite. Naming it needs no parser.
// Definitions are recognisable one line at a time in the languages Prax's
// users cite most, and indentation says which definition a line sits inside.
// Zero dependencies by design (no Tree-sitter, no language server): a wrong
// guess costs a hint, never a verdict — a changed citation stays changed.

const JS_IDENT = '[A-Za-z_$][\\w$]*';
const JS_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'with', 'function', 'return', 'else', 'do', 'try',
  'typeof', 'await', 'new', 'delete', 'void', 'yield', 'super', 'import', 'export',
]);

// Each pattern captures the name as `name`; Go methods add `recv`.
const PATTERNS = {
  js: [
    new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:async\\s+)?function\\s*\\*?\\s*(?<name>${JS_IDENT})`),
    new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?class\\s+(?<name>${JS_IDENT})`),
    new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:const\\s+)?(?:interface|enum|namespace)\\s+(?<name>${JS_IDENT})`),
    new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?type\\s+(?<name>${JS_IDENT})\\s*(?:<[^=]*>)?\\s*=`),
    // const f = function… | const f = x => … | const f = (a) => … | const f = async ( (params wrapped)
    new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+(?<name>${JS_IDENT})\\s*(?::[^=]+)?=\\s*(?:async\\s*)?(?:function\\b|${JS_IDENT}\\s*=>|\\([^)]*\\)\\s*(?::[^=]+)?=>|\\([^)]*$)`),
    // A method or object-literal method whose body opens on this line.
    new RegExp(`^\\s*(?:(?:public|private|protected|static|readonly|override|abstract|async|get|set)\\s+)*\\*?\\s*(?<name>#?${JS_IDENT})\\s*(?:<[^>]*>)?\\s*\\([^;]*\\)\\s*(?::\\s*[^{;]+)?\\{\\s*$`),
  ],
  python: [
    /^\s*(?:async\s+)?def\s+(?<name>\w+)/,
    /^\s*class\s+(?<name>\w+)/,
  ],
  rust: [
    /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:default\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+(?<name>\w+)/,
    /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|union|mod|type)\s+(?<name>\w+)/,
    /^\s*(?:unsafe\s+)?impl(?:\s*<[^>]*>)?\s+(?:[\w:<>, ]+?\s+for\s+)?(?<name>\w+)/,
  ],
  go: [
    /^func\s+\(\s*\w*\s*\*?\s*(?<recv>\w+)[^)]*\)\s*(?<name>\w+)/,
    /^func\s+(?<name>\w+)/,
    /^type\s+(?<name>\w+)/,
  ],
  swift: [
    /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|fileprivate|internal|open|static|class|final|override|mutating|nonmutating|convenience|required|indirect|lazy|dynamic|nonisolated|distributed)(?:\([^)]*\))?\s+)*func\s+(?<name>[^\s(<]+)/,
    /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|fileprivate|internal|open|override|convenience|required|nonisolated)\s+)*(?<name>init|deinit)\b/,
    /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|fileprivate|internal|open|final|indirect)\s+)*(?:class|struct|enum|protocol|extension|actor)\s+(?<name>[\w.]+)/,
  ],
  shell: [
    /^\s*function\s+(?<name>[A-Za-z_][\w.:-]*)/,
    /^\s*(?<name>[A-Za-z_][\w.:-]*)\s*\(\s*\)/,
  ],
};

const EXTENSIONS = {
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'js', tsx: 'js', mts: 'js', cts: 'js',
  py: 'python', pyi: 'python',
  rs: 'rust',
  go: 'go',
  swift: 'swift',
  sh: 'shell', bash: 'shell', zsh: 'shell', ksh: 'shell',
};

// The language whose definitions a file uses: by extension, else by shebang
// (extensionless scripts are common in bin/ and scripts/). Null = no symbols.
export function symbolLanguage(path, firstLine = '') {
  const base = String(path || '').split('/').pop();
  const dot = base.lastIndexOf('.');
  if (dot > 0) return EXTENSIONS[base.slice(dot + 1).toLowerCase()] ?? null;
  const shebang = /^#!\s*\S+(?:\s+(\S+))?/.exec(String(firstLine));
  if (!shebang) return null;
  const interpreter = (shebang[0].includes('/env') && shebang[1] ? shebang[1] : shebang[0]).split('/').pop();
  if (/^(?:node|deno|bun)\b/.test(interpreter)) return 'js';
  if (/^python/.test(interpreter)) return 'python';
  if (/^(?:ba|z|k|da)?sh\b/.test(interpreter)) return 'shell';
  return null;
}

function indentOf(line) {
  let width = 0;
  for (const ch of line) {
    if (ch === ' ') width += 1;
    else if (ch === '\t') width += 4;
    else break;
  }
  return width;
}

const isBlank = (line) => !/\S/.test(line);
// A wrapped signature's tail (`} = {}) {`, `) -> Result<()> {`) sits at the
// definition's indentation; it must not read as the end of that definition.
const isClosingLine = (line) => /^\s*[)\]}]/.test(line);

// The symbol a single line defines, or null.
export function definitionName(line, language) {
  const patterns = PATTERNS[language];
  if (!patterns) return null;
  for (const pattern of patterns) {
    const match = pattern.exec(line);
    if (!match) continue;
    const { name, recv } = match.groups;
    if (!name || (language === 'js' && JS_KEYWORDS.has(name))) continue;
    return recv ? `${recv}.${name}` : name;
  }
  return null;
}

function linesOf(text) {
  return Array.isArray(text) ? text : String(text ?? '').replace(/\r\n/g, '\n').split('\n');
}

// The definition enclosing 1-based `line`: that line itself when it defines
// something, else the nearest definition above whose indentation is below
// every non-blank line between them. A line above at lower indentation that
// is not a definition (`if (…) {`, `app.get(…, () => {`) tightens the bound,
// so top-level code after a function is not mistaken for its body. A blank
// line has no indentation to go by: null.
export function enclosingSymbol(text, line, path) {
  const lines = linesOf(text);
  const language = symbolLanguage(path, lines[0]);
  if (!language || !Number.isInteger(line) || line < 1 || line > lines.length) return null;
  if (isBlank(lines[line - 1])) return null;
  let limit = Infinity;
  for (let i = line - 1; i >= 0; i -= 1) {
    const raw = lines[i];
    if (isBlank(raw)) continue;
    const indent = indentOf(raw);
    if (i === line - 1) {
      const own = definitionName(raw, language);
      if (own) return own;
      limit = indent;
      continue;
    }
    if (indent >= limit || isClosingLine(raw)) continue;
    const name = definitionName(raw, language);
    if (name) return name;
    limit = indent;
  }
  return null;
}

// The symbol anchor for a cited range: what encloses its first line, or —
// when the range starts at top level (a doc comment above a function) — the
// first definition inside the range at the range's outermost indentation.
export function citationSymbol(text, startLine, endLine, path) {
  if (!startLine) return null;
  const lines = linesOf(text);
  const last = Math.min(endLine ?? startLine, lines.length);
  // Leading blank lines say nothing about where the range sits.
  let first = startLine;
  while (first <= last && isBlank(lines[first - 1])) first += 1;
  if (first > last) return null;
  const enclosing = enclosingSymbol(lines, first, path);
  if (enclosing) return enclosing;
  const language = symbolLanguage(path, lines[0]);
  if (!language) return null;
  let outer = Infinity;
  for (let i = first - 1; i < last; i += 1) if (!isBlank(lines[i])) outer = Math.min(outer, indentOf(lines[i]));
  for (let i = first - 1; i < last; i += 1) {
    if (isBlank(lines[i]) || indentOf(lines[i]) > outer) continue;
    const name = definitionName(lines[i], language);
    if (name) return name;
  }
  return null;
}

// Every definition in a file: [{ name, line }] with 1-based lines.
export function findDefinitions(text, path) {
  const lines = linesOf(text);
  const language = symbolLanguage(path, lines[0]);
  if (!language) return [];
  const found = [];
  lines.forEach((raw, index) => {
    const name = definitionName(raw, language);
    if (name) found.push({ name, line: index + 1, indent: indentOf(raw) });
  });
  return found;
}

// Where `name` is defined now: the definition nearest `nearLine` when the name
// repeats (overloads, several `String()` receivers), or null when it is gone.
export function locateSymbol(text, name, nearLine, path) {
  if (!name) return null;
  const matches = findDefinitions(text, path).filter((d) => d.name === name);
  if (!matches.length) return null;
  const near = Number.isInteger(nearLine) ? nearLine : 1;
  return matches.reduce((best, d) => (Math.abs(d.line - near) < Math.abs(best.line - near) ? d : best)).line;
}

// The lines a definition at 1-based `line` spans, heuristically: to the line
// before the next definition at the same or lower indentation, else the end
// of the file. Used to say whether a change touched a symbol's body.
export function symbolBlock(text, line, path) {
  const lines = linesOf(text);
  const defs = findDefinitions(lines, path);
  const def = defs.find((d) => d.line === line);
  if (!def) return null;
  const next = defs.find((d) => d.line > line && d.indent <= def.indent);
  let end = next ? next.line - 1 : lines.length;
  while (end > line && isBlank(lines[end - 1])) end -= 1;
  return { startLine: line, endLine: end };
}
