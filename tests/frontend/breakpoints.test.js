import { test } from 'node:test';
import assert from 'node:assert/strict';

// Set up a minimal matchMedia mock before importing the module
const listeners = new Map();
let currentWidth = 1200;

globalThis.window = {
  matchMedia(query) {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
    const obj = {
      matches: currentWidth >= min,
      addEventListener(_event, cb) { listeners.set(query, cb); },
      removeEventListener() {},
    };
    return obj;
  },
};

const { isMobile, isTablet, isDesktop, onBreakpointChange } = await import('../../public/js/breakpoints.js');

test('isDesktop true above 1024px', () => {
  currentWidth = 1200;
  assert.equal(isDesktop(), true);
  assert.equal(isTablet(), false);
  assert.equal(isMobile(), false);
});

test('isTablet true between 768 and 1023', () => {
  currentWidth = 900;
  assert.equal(isDesktop(), false);
  assert.equal(isTablet(), true);
  assert.equal(isMobile(), false);
});

test('isMobile true below 768', () => {
  currentWidth = 360;
  assert.equal(isDesktop(), false);
  assert.equal(isTablet(), false);
  assert.equal(isMobile(), true);
});

test('onBreakpointChange invokes callback when band changes', () => {
  currentWidth = 1200;
  const calls = [];
  const stop = onBreakpointChange(band => calls.push(band));
  currentWidth = 800;
  listeners.get('(min-width: 1024px)')({ matches: false });
  assert.deepEqual(calls.at(-1), 'tablet');
  currentWidth = 360;
  listeners.get('(min-width: 768px)')({ matches: false });
  assert.deepEqual(calls.at(-1), 'mobile');
  stop();
});
