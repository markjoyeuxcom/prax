import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSISTANT_MIN_WIDTH, ASSISTANT_WIDTH_KEY, clampAssistantWidth, loadAssistantWidth, maxAssistantWidth, saveAssistantWidth,
} from '../../public/js/assistantWidth.js';
import { renderAssistantHtml } from '../../public/js/renderAssistant.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    data,
  };
}

test('clampAssistantWidth keeps the panel between its minimum and a strip of backdrop', () => {
  assert.equal(clampAssistantWidth(200, 1600), ASSISTANT_MIN_WIDTH);
  assert.equal(clampAssistantWidth(900.4, 1600), 900);
  assert.equal(clampAssistantWidth(3000, 1600), 1480);          // 120px of backdrop stays clickable
  assert.equal(clampAssistantWidth(500, 400), ASSISTANT_MIN_WIDTH); // a tiny window never goes below the minimum
  assert.equal(clampAssistantWidth(null, 1600), null);
  assert.equal(clampAssistantWidth('wide', 1600), null);
  assert.equal(maxAssistantWidth(1600), 1480);
});

test('the width is a per-device preference that survives bad storage', () => {
  const storage = memoryStorage();
  assert.equal(loadAssistantWidth(storage), null);
  assert.equal(saveAssistantWidth(720.6, storage), 721);
  assert.equal(storage.data.get(ASSISTANT_WIDTH_KEY), '721');
  assert.equal(loadAssistantWidth(storage), 721);
  assert.equal(saveAssistantWidth(null, storage), null);           // reset removes it
  assert.equal(storage.data.has(ASSISTANT_WIDTH_KEY), false);
  assert.equal(loadAssistantWidth(memoryStorage({ [ASSISTANT_WIDTH_KEY]: '12' })), null);
  assert.equal(loadAssistantWidth({ getItem() { throw new Error('denied'); } }), null);
});

test('the panel renders a resize separator and applies a saved width within the window', () => {
  const base = { assistantMessages: [], assistantStatus: { available: true, supportsTools: true, model: 'm', toolCount: 3 }, winW: 1600 };
  const fresh = renderAssistantHtml({ ...base, assistantWidth: null });
  assert.match(fresh, /role="separator"[^>]*aria-orientation="vertical"/);
  assert.match(fresh, /data-assistant-resize/);
  assert.doesNotMatch(fresh, /--asst-width/);                      // the stylesheet default
  const wide = renderAssistantHtml({ ...base, assistantWidth: 900 });
  assert.match(wide, /<aside class="asst"[^>]*style="--asst-width: 900px"/);
  assert.match(wide, /aria-valuenow="900"/);
  const shrunk = renderAssistantHtml({ ...base, assistantWidth: 1500, winW: 1000 });
  assert.match(shrunk, /--asst-width: 880px/);                     // a smaller window clamps it
});
