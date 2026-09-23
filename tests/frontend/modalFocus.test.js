import test from 'node:test';
import assert from 'node:assert/strict';
import { syncModalInert, topmostModal, trapModalTab } from '../../public/js/modalFocus.js';

// A minimal element tree: enough structure for the layer and focus rules.
class Node {
  constructor(name, attrs = {}, children = []) {
    this.name = name; this.attrs = attrs; this.children = []; this.parentElement = null; this.inert = false;
    children.forEach(child => this.append(child));
  }
  append(child) { child.parentElement = this; this.children.push(child); return this; }
  get previousElementSibling() { const siblings = this.parentElement?.children || []; return siblings[siblings.indexOf(this) - 1] || null; }
  hasAttribute(name) { return name in this.attrs; }
  setAttribute(name, value) { this.attrs[name] = value; }
  matches(selector) { return selector === '.scrim' ? this.attrs.class === 'scrim' : false; }
  contains(node) { for (let n = node; n; n = n.parentElement) if (n === this) return true; return false; }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  closest(selector) {
    for (let n = this; n; n = n.parentElement) if (selector === '[inert]' && n.inert) return n;
    return null;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const all = this.descendants();
    if (selector === '[data-overlay-root]') return all.filter(n => 'data-overlay-root' in n.attrs);
    if (selector === '[data-overlay-root] [aria-modal="true"]') {
      return all.filter(n => n.attrs['aria-modal'] === 'true' && all.some(r => 'data-overlay-root' in r.attrs && r.contains(n)));
    }
    return all.filter(n => n.name === 'button' || n.name === 'input'); // the focusable set
  }
  focus() { focused = this; }
}
let focused = null;

function app({ drawer = true, confirm = false } = {}) {
  const desk = new Node('div', { class: 'desk' }, [new Node('button', {})]);
  const scrim = new Node('div', { class: 'scrim' });
  const drawerEl = new Node('aside', { 'aria-modal': 'true' }, [new Node('input', {}), new Node('button', {})]);
  const confirmEl = new Node('div', { 'aria-modal': 'true' }, [new Node('button', {}), new Node('button', {})]);
  const confirmLayer = new Node('div', { class: 'overlay-center' }, [confirmEl]);
  const assistant = new Node('div', { class: 'assistant' }, [new Node('input', {})]);
  const toast = new Node('div', { 'data-toast-root': '' });
  const overlays = new Node('div', { 'data-overlay-root': '' }, [
    ...(drawer ? [scrim, drawerEl] : []), ...(confirm ? [confirmLayer] : []), assistant, toast,
  ]);
  const root = new Node('div', { id: 'app' }, [desk, overlays]);
  return { root, desk, scrim, drawerEl, confirmEl, confirmLayer, assistant, toast };
}

test('the topmost modal leaves the workspace and every layer beneath it inert', () => {
  const only = app();
  assert.equal(syncModalInert(only.root), only.drawerEl);
  assert.equal(only.desk.inert, true);
  assert.equal(only.scrim.inert, false, 'the drawer scrim still closes it');
  assert.equal(only.drawerEl.inert, false);
  assert.equal(only.assistant.inert, false, 'a panel above the modal stays live');
  assert.equal(only.toast.inert, false);

  const stacked = app({ confirm: true });
  assert.equal(topmostModal(stacked.root), stacked.confirmEl);
  syncModalInert(stacked.root);
  assert.equal(stacked.drawerEl.inert, true, 'a drawer beneath a confirm is inert');
  assert.equal(stacked.scrim.inert, true);
  assert.equal(stacked.confirmLayer.inert, false);

  const none = app({ drawer: false });
  syncModalInert(none.root);
  assert.equal(none.desk.inert, false, 'closing the last modal restores the workspace');
});

test('Tab wraps at the modal edges and pulls focus back in; a live layer above keeps its own Tab', () => {
  const { root, drawerEl, desk, assistant } = app();
  syncModalInert(root);
  const [first, last] = drawerEl.children;
  const tab = (active, shiftKey = false) => {
    const event = { key: 'Tab', shiftKey, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    focused = null;
    return { handled: trapModalTab(event, root, active), event };
  };
  assert.equal(tab(last).handled, true); assert.equal(focused, first);
  assert.equal(tab(first, true).handled, true); assert.equal(focused, last);
  assert.equal(tab(first).handled, false, 'inside the modal the browser order applies');
  assert.equal(tab(desk.children[0]).handled, true); assert.equal(focused, first);
  assert.equal(tab(null, true).handled, true); assert.equal(focused, last);
  assert.equal(tab(assistant.children[0]).handled, false);
});
