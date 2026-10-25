import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { findUnescapedInterpolations } from './htmlInterpolationScanner.js';

// Every `${…}` in a template literal that builds HTML must be escaped or
// provably safe. The rules are in htmlInterpolationScanner.js and in
// the Prax Library document "Working on Prax (contributor guide)" ("HTML escaping"). Every module is scanned,
// main.js included: it builds no HTML itself since its controllers and page
// chrome moved into their own modules.

const JS_DIR = new URL('../../public/js/', import.meta.url);
const NOT_SCANNED = new Set();

function scannedModules() {
  return readdirSync(JS_DIR).filter((name) => name.endsWith('.js') && !NOT_SCANNED.has(name)).sort();
}

const scan = (source) => findUnescapedInterpolations(source).map(({ code }) => code);

test('every HTML-building module escapes each interpolated value', () => {
  const failures = [];
  for (const name of scannedModules()) {
    const source = readFileSync(new URL(name, JS_DIR), 'utf8');
    for (const { line, code } of findUnescapedInterpolations(source)) failures.push(`public/js/${name}:${line}  \${${code}}`);
  }
  assert.deepEqual(failures, [], 'Escape these values with escapeHtml/escapeAttr/cssColor from public/js/html.js, '
    + 'or mark a provably safe line with `// html-safe: <reason>`:\n' + failures.join('\n'));
});

test('the scan covers the render modules, the Markdown renderer and the capture bar', () => {
  const names = scannedModules();
  for (const required of ['markdownPreview.js', 'captureBar.js', 'brief.js', 'renderHelpers.js', 'html.js', 'icons.js']) {
    assert.ok(names.includes(required), required);
  }
  assert.ok(names.filter((name) => /^render.+\.js$/.test(name)).length >= 30);
});

// ---- self-tests: the scanner catches what it must --------------------------

test('a deliberately unescaped value is reported, and escaping it clears the report', () => {
  assert.deepEqual(scan('export const row = (task) => `<li>${task.title}</li>`;'), ['task.title']);
  assert.deepEqual(scan('export const row = (task) => `<li>${escapeHtml(task.title)}</li>`;'), []);
  assert.deepEqual(scan('export const row = (task) => `<li data-id="${escapeAttr(task.id)}"></li>`;'), []);
  // A const alias of an escaper is an escaper; an unknown function is not.
  assert.deepEqual(scan('const esc = escapeHtml;\nexport const row = (task) => `<li>${esc(task.title)}</li>`;'), []);
  assert.deepEqual(scan('export const row = (task) => `<li>${esc(task.title)}</li>`;'), ['esc(task.title)']);
});

test('attribute fragments, style colours and nested .map() bodies are HTML too', () => {
  assert.deepEqual(scan('export const attrs = (task) => ` data-kind="${task.kind}"`;'), ['task.kind']);
  assert.deepEqual(scan('export const dot = (task) => `<span style="--dot: ${task.projColor || \'var(--ink3)\'}"></span>`;'),
    ["task.projColor || 'var(--ink3)'"]);
  assert.deepEqual(scan('export const dot = (task) => `<span style="--dot: ${cssColor(task.projColor)}"></span>`;'), []);
  assert.deepEqual(scan('export const list = (items) => `<ul>${items.map((item) => `${item.name}, `).join(\'\')}</ul>`;'), ['item.name']);
  assert.deepEqual(scan('export const list = (items) => `<ul>${items.map((item) => item.name).join(\'\')}</ul>`;'),
    ["items.map((item) => item.name).join('')"]);
  assert.deepEqual(scan('export const list = (items) => `<ul>${items.map((item) => `<li>${escapeHtml(item.name)}</li>`).join(\'\')}</ul>`;'), []);
});

test('a line marked html-safe is accepted, and literals, numbers and constants pass', () => {
  assert.deepEqual(scan('export const a = (x) => `<b>${x}</b>`; // html-safe: x is built by the caller'), []);
  assert.deepEqual(scan('export const a = (x) => `<b>${x /* html-safe: caller-built HTML */}</b>`;'), []);
  assert.deepEqual(scan([
    'const LABELS = { a: "A" };',
    'export const a = (items, on) => `<b data-n="${items.length}" aria-pressed="${on === true}">'
      + '${LABELS[on]}${1 + 2}${on ? \'yes\' : \'no\'}${Math.round(items.length / 2)}</b>`;',
  ].join('\n')), []);
  // A CSS selector is not HTML.
  assert.deepEqual(scan('const selector = (name) => `input[name="${CSS.escape(name)}"]`;'), []);
});

test('local names are followed through every binding, per scope', () => {
  // Every binding must pass: one unescaped assignment taints the name.
  assert.deepEqual(scan('export function a(task) { let label = escapeHtml(task.title); if (task.x) label = task.x; return `<b>${label}</b>`; }'), ['label']);
  assert.deepEqual(scan('export function a(task) { const label = escapeHtml(task.title); return `<b>${label}</b>`; }'), []);
  // A callback parameter shadows a safe outer name.
  assert.deepEqual(scan([
    'export function a(items) {',
    '  const label = escapeHtml("x");',
    '  return `<p>${label}</p>` + items.map((label) => `<i>${label}</i>`).join("");',
    '}',
  ].join('\n')), ['label']);
  // Pushed list items must pass.
  assert.deepEqual(scan('export function a(task) { const parts = []; parts.push(task.title); return `<p>${parts.join("")}</p>`; }'), ['parts.join("")']);
  assert.deepEqual(scan('export function a(task) { const parts = []; parts.push(escapeHtml(task.title)); return `<p>${parts.join("")}</p>`; }'), []);
});

test('a helper parameter passes only when every call passes a safe argument', () => {
  const helper = 'function badge(text) { return `<span>${text}</span>`; }\n';
  assert.deepEqual(scan(`${helper}export const a = () => badge('New');`), []);
  assert.deepEqual(scan(`${helper}export const a = (task) => badge('New') + badge(task.title);`), ['text']);
  // Passed as a value, its arguments are unknown.
  assert.deepEqual(scan(`${helper}export const a = (items) => items.map(badge).join('');`), ['text']);
  // An exported helper can be called from anywhere.
  assert.deepEqual(scan('export function badge(text) { return `<span>${text}</span>`; }'), ['text']);
  // A constant table's rows are constants.
  assert.deepEqual(scan('const ROWS = [{ key: "a", label: "A" }];\nexport const a = () => ROWS.map(({ key, label }) => `<b data-k="${key}">${label}</b>`).join("");'), []);
});

test('a builder’s raw-HTML argument must pass', () => {
  assert.deepEqual(scan('export const a = (task) => `<p>${chip(task.title, "tag")}</p>`;'), []);
  assert.deepEqual(scan('export const a = (task, attrs) => `<p>${chip(task.title, "tag", attrs)}</p>`;'), ['chip(task.title, "tag", attrs)']);
});

test('removing an escaper from a real module is caught', () => {
  const shell = readFileSync(new URL('renderShell.js', JS_DIR), 'utf8');
  const colour = shell.replace('${cssColor(task.projColor)}', "${task.projColor || 'var(--ink3)'}");
  assert.notEqual(colour, shell, 'the fixture edit must apply');
  assert.deepEqual(findUnescapedInterpolations(colour).map(({ code }) => code), ["task.projColor || 'var(--ink3)'"]);

  const inbox = readFileSync(new URL('renderInbox.js', JS_DIR), 'utf8');
  const title = inbox.replace('Last decision: ${esc(inbox.undo.title)}', 'Last decision: ${inbox.undo.title}');
  assert.notEqual(title, inbox, 'the fixture edit must apply');
  assert.deepEqual(findUnescapedInterpolations(title).map(({ code }) => code), ['inbox.undo.title']);
});
