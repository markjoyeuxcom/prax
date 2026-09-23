import test from 'node:test';
import assert from 'node:assert/strict';
import { cssColor, escapeAttr, escapeHtml, isSafeHttpUrl } from '../../public/js/html.js';
import * as helpers from '../../public/js/renderHelpers.js';
import { isSafeHttpUrl as refKindIsSafeHttpUrl } from '../../public/js/externalRefKind.js';

test('escapeHtml escapes the five HTML metacharacters and nothing else', () => {
  assert.equal(escapeHtml(`<a href="x" title='y'>&amp;</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;amp;&lt;/a&gt;');
  assert.equal(escapeHtml('plain — ✓ text'), 'plain — ✓ text');
  assert.equal(escapeHtml('$& $1 $$'), '$&amp; $1 $$');
});

test('escapeHtml stringifies numbers and booleans and blanks null and undefined', () => {
  assert.equal(escapeHtml(42), '42');
  assert.equal(escapeHtml(0), '0');
  assert.equal(escapeHtml(true), 'true');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('escapeAttr escapes both quote characters for attribute values', () => {
  assert.equal(escapeAttr(`" onmouseover="x' y`), '&quot; onmouseover=&quot;x&#39; y');
  assert.equal(escapeAttr('a<b>&c'), escapeHtml('a<b>&c'));
});

test('renderHelpers re-exports the same escapeHtml, and html.js re-exports isSafeHttpUrl', () => {
  assert.equal(helpers.escapeHtml, escapeHtml);
  assert.equal(isSafeHttpUrl, refKindIsSafeHttpUrl);
});

test('cssColor passes colours and replaces anything that could leave the declaration', () => {
  for (const color of ['#fff', '#12ab34', '#12ab34cc', 'red', 'transparent', 'currentColor', 'var(--ink3)', 'var(--accent)',
    'oklch(0.62 0.11 145)', 'rgb(1, 2, 3)', 'rgba(1 2 3 / 50%)', 'hsl(120deg 50% 50%)']) {
    assert.equal(cssColor(color), color, color);
  }
  assert.equal(cssColor('  #abc  '), '#abc');
  for (const hostile of ['red; background: url(https://evil.example/x)', 'url(https://evil.example/x)', 'red" onmouseover="x',
    'var(--a) , url(x)', 'rgb(1,2,3) url(x)', 'expression(alert(1))', '', null, undefined, '#ff', 'calc(1px + 2px)']) {
    assert.equal(cssColor(hostile), 'var(--ink3)', String(hostile));
  }
  assert.equal(cssColor('nope;', 'var(--accent)'), 'var(--accent)');
});

test('chip and prioDotClass escape their class fragments', () => {
  assert.equal(helpers.chip('Label', 'tag'), '<span class="chip chip--tag">Label</span>');
  assert.equal(helpers.chip('<b>', 'x" onclick="y'), '<span class="chip chip--x&quot; onclick=&quot;y">&lt;b&gt;</span>');
  assert.equal(helpers.prioDotClass('high'), 'prio-dot prio-dot--high');
  assert.equal(helpers.prioDotClass('medium'), 'prio-dot prio-dot--med');
  assert.equal(helpers.prioDotClass('"><img>'), 'prio-dot prio-dot--&quot;&gt;&lt;img&gt;');
});
