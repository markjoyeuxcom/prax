// Hybrid citation anchors: the line hash, a whitespace-free content hash, and
// the enclosing symbol — so a citation survives line shifts and reformatting,
// and a changed one can still say where its code lives now.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkCitation, computeAnchors, describeCitationStatus, hashCitation, hashNormalized, resolveCitation,
} from '../../cli/lib/codeRefs.js';
import {
  citationSymbol, enclosingSymbol, findDefinitions, locateSymbol, symbolBlock, symbolLanguage,
} from '../../cli/lib/symbols.js';
import { recall } from '../../cli/lib/recall.js';

const lines = (...l) => l.join('\n');

// ---- language detection ------------------------------------------------------------

test('the symbol language comes from the extension, else the shebang', () => {
  assert.equal(symbolLanguage('src/a.ts'), 'js');
  assert.equal(symbolLanguage('src/a.MJS'), 'js');
  assert.equal(symbolLanguage('tool.py'), 'python');
  assert.equal(symbolLanguage('lib.rs'), 'rust');
  assert.equal(symbolLanguage('main.go'), 'go');
  assert.equal(symbolLanguage('App.swift'), 'swift');
  assert.equal(symbolLanguage('deploy.sh'), 'shell');
  assert.equal(symbolLanguage('bin/prax', '#!/usr/bin/env node'), 'js');
  assert.equal(symbolLanguage('bin/tool', '#!/usr/bin/python3'), 'python');
  assert.equal(symbolLanguage('bin/run', '#!/bin/bash'), 'shell');
  assert.equal(symbolLanguage('README.md'), null);
  assert.equal(symbolLanguage('Makefile', 'all:'), null);
});

// ---- the heuristic per language --------------------------------------------------------

const JS = lines(
  "import x from 'y';", //  1
  '', //                    2
  '/** Load config. */', // 3
  'export function loadConfig({', // 4
  '  a, b,', //             5
  '} = {}) {', //           6
  '  const x = 1;', //      7
  '  return x;', //         8
  '}', //                   9
  '', //                    10
  'const top = 2;', //      11
  '', //                    12
  'class Store {', //       13
  '  constructor() {', //   14
  '    this.a = 1;', //     15
  '  }', //                 16
  '', //                    17
  '  async save(a, b) {', //18
  '    if (a) {', //        19
  '      return b;', //     20
  '    }', //               21
  '  }', //                 22
  '}', //                   23
  '', //                    24
  'export const handler = async (req) => {', // 25
  '  return 1;', //         26
  '};', //                  27
  'export interface Shape {', // 28
  '  size: number;', //     29
  '}', //                   30
  'export type Id = string;', // 31
);

test('JS/TS: functions, wrapped signatures, classes, methods, arrow consts, interfaces, types', () => {
  assert.equal(enclosingSymbol(JS, 4, 'a.js'), 'loadConfig');
  assert.equal(enclosingSymbol(JS, 7, 'a.js'), 'loadConfig', 'a wrapped signature still encloses its body');
  assert.equal(enclosingSymbol(JS, 15, 'a.ts'), 'constructor');
  assert.equal(enclosingSymbol(JS, 20, 'a.ts'), 'save', 'an if block inside a method is not a definition');
  assert.equal(enclosingSymbol(JS, 26, 'a.ts'), 'handler');
  assert.equal(enclosingSymbol(JS, 29, 'a.ts'), 'Shape');
  assert.equal(enclosingSymbol(JS, 31, 'a.ts'), 'Id');
  assert.equal(enclosingSymbol(JS, 13, 'a.ts'), 'Store');
});

test('top-level code after a function is not mistaken for its body', () => {
  assert.equal(enclosingSymbol(JS, 11, 'a.js'), null);
  assert.equal(enclosingSymbol(JS, 1, 'a.js'), null);
});

test('a range that opens with a doc comment takes the definition inside it', () => {
  assert.equal(citationSymbol(JS, 3, 9, 'a.js'), 'loadConfig');
  assert.equal(citationSymbol(JS, 10, 12, 'a.js'), null);
});

test('Python: def, async def, class, by indentation', () => {
  const py = lines(
    'import os',
    '',
    'class Loader:',
    '    def __init__(self):',
    '        self.x = 1',
    '',
    '    async def fetch(self, url):',
    '        if url:',
    '            return url',
    '',
    'value = 3',
  );
  assert.equal(enclosingSymbol(py, 5, 'l.py'), '__init__');
  assert.equal(enclosingSymbol(py, 9, 'l.py'), 'fetch');
  assert.equal(enclosingSymbol(py, 3, 'l.py'), 'Loader');
  assert.equal(enclosingSymbol(py, 11, 'l.py'), null);
});

test('Rust: fn with modifiers, struct, impl named by type', () => {
  const rs = lines(
    'pub struct Config {',
    '    port: u16,',
    '}',
    '',
    'impl<T> Display for Wrapper<T> {',
    '    fn fmt(&self, f: &mut Formatter) -> Result {',
    '        write!(f, "x")',
    '    }',
    '}',
    '',
    'pub(crate) async unsafe fn launch() {',
    '    run();',
    '}',
  );
  assert.equal(enclosingSymbol(rs, 2, 'c.rs'), 'Config');
  assert.equal(enclosingSymbol(rs, 7, 'c.rs'), 'fmt');
  assert.equal(enclosingSymbol(rs, 5, 'c.rs'), 'Wrapper');
  assert.equal(enclosingSymbol(rs, 12, 'c.rs'), 'launch');
});

test('Go: funcs, methods qualified by receiver type, types', () => {
  const go = lines(
    'type Server struct {',
    '\taddr string',
    '}',
    '',
    'func (s *Server) Start(ctx context.Context) error {',
    '\treturn nil',
    '}',
    '',
    'func main() {',
    '\trun()',
    '}',
  );
  assert.equal(enclosingSymbol(go, 2, 'm.go'), 'Server');
  assert.equal(enclosingSymbol(go, 6, 'm.go'), 'Server.Start');
  assert.equal(enclosingSymbol(go, 10, 'm.go'), 'main');
});

test('Swift: func with attributes and modifiers, init, types and extensions', () => {
  const swift = lines(
    'final class Store {',
    '    @MainActor public static func shared() -> Store {',
    '        Store()',
    '    }',
    '',
    '    init() {',
    '        load()',
    '    }',
    '}',
    '',
    'extension Store.Item {',
    '    var name: String { "x" }',
    '}',
  );
  assert.equal(enclosingSymbol(swift, 3, 'S.swift'), 'shared');
  assert.equal(enclosingSymbol(swift, 7, 'S.swift'), 'init');
  assert.equal(enclosingSymbol(swift, 12, 'S.swift'), 'Store.Item');
});

test('shell: name() and function name', () => {
  const sh = lines(
    '#!/bin/sh',
    'set -e',
    'build() {',
    '  make all',
    '}',
    'function deploy {',
    '  rsync -a out/ host:',
    '}',
  );
  assert.equal(enclosingSymbol(sh, 4, 'x.sh'), 'build');
  assert.equal(enclosingSymbol(sh, 7, 'x.sh'), 'deploy');
  assert.equal(enclosingSymbol(sh, 2, 'x.sh'), null);
});

test('files without a known language have no symbol', () => {
  assert.equal(enclosingSymbol('# Title\n\nfunction x() {}', 3, 'notes.md'), null);
  assert.deepEqual(findDefinitions('def x():\n  pass', 'x.txt'), []);
});

test('locateSymbol picks the definition nearest the recorded line when a name repeats', () => {
  const go = lines('func (a A) String() string {', '}', '', 'func (b A) String() string {', '}');
  assert.equal(locateSymbol(go, 'A.String', 5, 'x.go'), 4);
  assert.equal(locateSymbol(go, 'A.String', 1, 'x.go'), 1);
  assert.equal(locateSymbol(go, 'B.String', 1, 'x.go'), null);
});

test('symbolBlock runs to the next definition at the same or lower indentation', () => {
  assert.deepEqual(symbolBlock(JS, 4, 'a.js'), { startLine: 4, endLine: 11 });
  assert.deepEqual(symbolBlock(JS, 14, 'a.js'), { startLine: 14, endLine: 16 });
  assert.equal(symbolBlock(JS, 5, 'a.js'), null);
});

// ---- anchors ---------------------------------------------------------------------------

test('the content hash ignores all whitespace, including a re-wrapped call', () => {
  assert.equal(hashNormalized('call(a, b);'), hashNormalized('call(\n  a,\n  b,\n);'.replace(',\n);', '\n);')));
  assert.equal(hashNormalized('  x = 1;\r\n'), hashNormalized('x=1;'));
  assert.notEqual(hashNormalized('x = 1;'), hashNormalized('x = 2;'));
});

test('computeAnchors and resolveCitation pin all three anchors', () => {
  const anchors = computeAnchors(JS, 7, 8, 'a.js');
  assert.deepEqual(anchors, {
    contentHash: hashCitation('  const x = 1;\n  return x;'),
    normalizedHash: hashNormalized('const x = 1; return x;'),
    symbol: 'loadConfig',
  });
  const pin = resolveCitation('a.js:7-8', { readFile: () => JS, headSha: 'abc' });
  assert.equal(pin.symbol, 'loadConfig');
  assert.equal(pin.normalizedHash, anchors.normalizedHash);
  assert.equal(computeAnchors(JS, null, null, 'a.js').symbol, null, 'a whole-file citation has no symbol');
});

// ---- relocation order: line hash, then content hash, then symbol ------------------------------

const BODY = ['function pick(list) {', '  return list.filter(Boolean).map((x) => x.id);', '}'];
const pinned = (text, start, end, path = 'p.js') => ({ path, startLine: start, endLine: end, ...computeAnchors(text, start, end, path) });

test('1. the line hash at the recorded range: current, same shape as before anchors', () => {
  const text = lines(...BODY);
  assert.deepEqual(checkCitation(pinned(text, 1, 3), text), { status: 'current', startLine: 1, endLine: 3 });
});

test('2. the line hash wins over the content hash: an exact copy elsewhere is a move', () => {
  const original = lines('// header', ...BODY);
  const ref = pinned(original, 2, 4);
  // At the recorded lines: the same code reformatted. Further down: an exact copy.
  const now = lines('// header', 'function pick(list) {', '  return list.filter(Boolean)', '    .map((x) => x.id);', '}', '', ...BODY);
  assert.deepEqual(checkCitation(ref, now), { status: 'moved', startLine: 7, endLine: 9 });
});

test('3a. the content hash: whitespace-only change in place still holds', () => {
  const original = lines('// header', ...BODY, 'tail();');
  const ref = pinned(original, 2, 4);
  const reindented = lines('// header', 'function pick(list) {', '    return list.filter(Boolean).map((x) => x.id);  ', '}', 'tail();');
  assert.deepEqual(checkCitation(ref, reindented), { status: 'current', startLine: 2, endLine: 4, anchor: 'content' });
  assert.equal(describeCitationStatus(checkCitation(ref, reindented), ref), '');
});

test('3b. the content hash: reformatted AND moved, with a different line count', () => {
  const original = lines('// header', ...BODY);
  const ref = pinned(original, 2, 4);
  const now = lines('// header', 'import a from "a";', '', 'function pick(list) {', '  return list', '    .filter(Boolean)', '    .map((x) => x.id);', '}');
  const result = checkCitation(ref, now);
  assert.deepEqual(result, { status: 'moved', startLine: 4, endLine: 8, anchor: 'content' });
  assert.equal(describeCitationStatus(result, ref), 'moved to p.js:4-8 (whitespace changed)');
});

test('4. the symbol: content changed, but its definition is still found', () => {
  const original = lines('// header', ...BODY);
  const ref = pinned(original, 3, 3); // the return line, inside pick
  assert.equal(ref.symbol, 'pick');
  const now = lines('// header', '', '', 'function pick(list) {', '  return list.filter((x) => x.live).map((x) => x.id);', '}');
  const result = checkCitation(ref, now);
  assert.deepEqual(result, { status: 'changed', startLine: 3, endLine: 3, symbol: { name: 'pick', line: 4 } });
  assert.equal(describeCitationStatus(result, ref), 'p.js changed since this was written (pick is now at line 4)');
});

test('4b. a symbol that is gone says so', () => {
  const original = lines(...BODY);
  const ref = pinned(original, 2, 2);
  const result = checkCitation(ref, 'const nothing = 1;');
  assert.deepEqual(result.symbol, { name: 'pick', line: null });
  assert.match(describeCitationStatus(result, ref), /pick is gone/);
});

test('a legacy citation (no anchors) is checked by its line hash alone', () => {
  const original = lines('// header', ...BODY, 'tail();');
  const legacy = { path: 'p.js', startLine: 2, endLine: 4, contentHash: hashCitation(lines(...BODY)) };
  const reindented = lines('// header', 'function pick(list) {', '    return list.filter(Boolean).map((x) => x.id);', '}', 'tail();');
  assert.deepEqual(checkCitation(legacy, reindented), { status: 'changed', startLine: 2, endLine: 4 });
  assert.equal(checkCitation(legacy, original).status, 'current');
});

test('a whole-file citation holds through a whitespace-only change', () => {
  const text = lines(...BODY);
  const ref = { path: 'p.js', startLine: null, endLine: null, ...computeAnchors(text, null, null, 'p.js') };
  assert.deepEqual(checkCitation(ref, `${text}\n\n`), { status: 'current', startLine: null, endLine: null, anchor: 'content' });
  assert.equal(checkCitation(ref, `${text}\nmore();`).status, 'changed');
});

test('a spent content budget says the search was only nearby', () => {
  const original = lines(...BODY);
  const ref = pinned(original, 1, 3);
  const far = lines(...Array.from({ length: 400 }, (_, i) => `line${i};`), 'function pick(list) {', '  return list.filter(Boolean).map((x) => x.id); }');
  const nearOnly = checkCitation(ref, far, { contentBudget: 50 });
  assert.equal(nearOnly.status, 'changed');
  assert.equal(nearOnly.searched, 'nearby');
  assert.equal(checkCitation(ref, far).status, 'moved');
});

test('a citation of blank lines never matches by content', () => {
  const text = lines('a();', '', '', 'b();');
  const ref = pinned(text, 2, 3);
  assert.equal(checkCitation(ref, lines('a();', 'b();')).status, 'changed');
});

// ---- lazy backfill during recall ------------------------------------------------------------

function recallClient(refs, calls, { fail = false } = {}) {
  return {
    semanticSearch: async () => ({ items: [{ id: 'doc-1', title: 'Pick rule' }], page: null, index: null, degraded: false, reason: null }),
    getDocument: async () => ({ id: 'doc-1', body: 'pick drops falsy entries', status: 'active' }),
    listCodeRefs: async () => refs,
    backfillCodeRefAnchors: async (...args) => {
      calls.push(args);
      if (fail) throw new Error('offline');
      return { updated: true };
    },
  };
}

test('recall backfills a legacy citation when its line hash proves the pinned content', async () => {
  const text = lines('// header', ...BODY);
  const calls = [];
  const legacy = { id: 'ref-1', path: 'p.js', startLine: 2, endLine: 4, contentHash: hashCitation(lines(...BODY)), normalizedHash: null, symbol: null };
  await recall(recallClient([legacy], calls), { query: 'pick', readFile: () => text });
  assert.equal(calls.length, 1);
  const [documentId, refId, anchors] = calls[0];
  assert.equal(documentId, 'doc-1');
  assert.equal(refId, 'ref-1');
  assert.deepEqual(anchors, computeAnchors(text, 2, 4, 'p.js'));
  assert.equal(anchors.symbol, 'pick');
});

test('recall backfills a line-hash move with the anchors at the new location', async () => {
  const text = lines('// header', '// more', ...BODY);
  const calls = [];
  const legacy = { id: 'ref-1', path: 'p.js', startLine: 2, endLine: 4, contentHash: hashCitation(lines(...BODY)), normalizedHash: null, symbol: null };
  await recall(recallClient([legacy], calls), { query: 'pick', readFile: () => text });
  assert.deepEqual(calls[0][2], computeAnchors(text, 3, 5, 'p.js'));
});

test('no backfill when the content changed, when anchors exist, or from an older server', async () => {
  const text = lines('// header', ...BODY);
  const calls = [];
  const changed = { id: 'r', path: 'p.js', startLine: 2, endLine: 4, contentHash: hashCitation('other'), normalizedHash: null, symbol: null };
  const anchored = { id: 'r', path: 'p.js', startLine: 2, endLine: 4, ...computeAnchors(text, 2, 4, 'p.js') };
  const older = { id: 'r', path: 'p.js', startLine: 2, endLine: 4, contentHash: hashCitation(lines(...BODY)) };
  for (const ref of [changed, anchored, older]) {
    await recall(recallClient([ref], calls), { query: 'pick', readFile: () => text });
  }
  assert.equal(calls.length, 0);
});

test('a failed backfill changes nothing about the recall', async () => {
  const text = lines('// header', ...BODY);
  const calls = [];
  const legacy = { id: 'ref-1', path: 'p.js', startLine: 2, endLine: 4, contentHash: hashCitation(lines(...BODY)), normalizedHash: null, symbol: null };
  const result = await recall(recallClient([legacy], calls, { fail: true }), { query: 'pick', readFile: () => text });
  assert.equal(calls.length, 1);
  assert.deepEqual(result.top.citations.map((c) => c.status), ['current']);
});
