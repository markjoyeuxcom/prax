import test from 'node:test';
import assert from 'node:assert/strict';
import { externalLinkUrl, openExternalUrl } from '../../public/js/externalLinks.js';

const PAGE = 'http://127.0.0.1:43127/?shell=desktop';
function anchor(href, attrs = {}) {
  const all = { href, ...attrs };
  return { getAttribute: name => all[name] ?? null, hasAttribute: name => name in all && all[name] !== undefined };
}

test('web links resolve to absolute http(s) URLs; in-page, action and non-web links do not', () => {
  assert.equal(externalLinkUrl(anchor('https://example.com/a?b=1'), PAGE), 'https://example.com/a?b=1');
  assert.equal(externalLinkUrl(anchor('http://intranet.local/x'), PAGE), 'http://intranet.local/x');
  // A root-relative link would navigate the desktop window itself away.
  assert.equal(externalLinkUrl(anchor('/api/tasks'), PAGE), 'http://127.0.0.1:43127/api/tasks');
  assert.equal(externalLinkUrl(anchor('#inbox-process'), PAGE), null);
  assert.equal(externalLinkUrl(anchor('#', { 'data-action': 'open-doc' }), PAGE), null);
  assert.equal(externalLinkUrl(anchor('https://example.com', { 'data-action': 'x' }), PAGE), null);
  assert.equal(externalLinkUrl(anchor('blob:http://127.0.0.1/abc', { download: 'a.zip' }), PAGE), null);
  assert.equal(externalLinkUrl(anchor('mailto:someone@example.com'), PAGE), null);
  assert.equal(externalLinkUrl(anchor('javascript:alert(1)'), PAGE), null);
  assert.equal(externalLinkUrl(anchor(''), PAGE), null);
  assert.equal(externalLinkUrl(null, PAGE), null);
});

test('the desktop hands the URL to the shell plugin; the browser opens a new tab without an opener', async () => {
  const invoked = [];
  const desktop = { __TAURI__: { core: { invoke: async (command, args) => { invoked.push([command, args]); } } } };
  assert.equal(await openExternalUrl('https://example.com/', { desktopShell: true, globalRef: desktop }), true);
  assert.deepEqual(invoked, [['plugin:shell|open', { path: 'https://example.com/' }]]);
  assert.equal(await openExternalUrl('https://example.com/', { desktopShell: true, globalRef: {} }), false, 'no IPC, no pretend success');
  await assert.rejects(openExternalUrl('https://example.com/', {
    desktopShell: true, globalRef: { __TAURI__: { core: { invoke: async () => { throw new Error('denied'); } } } },
  }), /denied/);

  const opened = [];
  const browser = { open: (...args) => { opened.push(args); return null; } };
  assert.equal(await openExternalUrl('https://example.com/', { globalRef: browser }), true);
  assert.deepEqual(opened, [['https://example.com/', '_blank', 'noopener,noreferrer']]);
});
