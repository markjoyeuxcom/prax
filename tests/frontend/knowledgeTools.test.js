import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeToolsController } from '../../public/js/knowledgeToolsController.js';

function deferred() {
  let resolve; let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

// ---- Ask Prax: a stale or dismissed answer never installs --------------------

function askFor(state, askPrax) {
  const announced = [];
  const controller = createKnowledgeToolsController({
    getState: () => state, setState: patch => Object.assign(state, patch), renderApp: () => {}, showToast: () => {},
    announce: message => announced.push(message), getRoot: () => ({ querySelector: () => null }), askPrax,
  });
  return { controller, announced };
}

test('Ask Prax: an answer to a closed dialog or an edited question is dropped', async () => {
  const state = { askPraxOpen: true, askPraxQuery: '' };
  const first = deferred();
  const { controller, announced } = askFor(state, () => first.promise);
  const asking = controller.runAskPrax('  how do I rotate keys?  ');
  assert.equal(state.askPraxQuery, 'how do I rotate keys?');
  assert.equal(state.askPraxLoading, true);
  controller.closeAskPrax();
  first.resolve({ answer: 'stale' });
  await asking;
  assert.equal(state.askPraxResult, null);
  assert.deepEqual(announced, []);

  controller.openAskPrax();
  const second = deferred();
  const typed = askFor(state, () => second.promise);
  const again = typed.controller.runAskPrax('first question');
  // Typing while loading cancels the request (the input handler).
  assert.equal(typed.controller.input({ matches: selector => selector === '[data-ask-prax-input]', value: 'second question' }), true);
  assert.equal(state.askPraxLoading, false);
  second.resolve({ answer: 'stale' });
  await again;
  assert.equal(state.askPraxResult, null);
  assert.equal(state.askPraxQuery, 'second question');
});

test('Ask Prax: a current answer installs and is announced', async () => {
  const state = { askPraxOpen: true, askPraxQuery: '' };
  const { controller, announced } = askFor(state, async () => ({ answer: 'Rotate with the runbook.' }));
  await controller.runAskPrax('how?');
  assert.deepEqual(state.askPraxResult, { answer: 'Rotate with the runbook.' });
  assert.deepEqual(announced, ['Answer ready.']);
});
