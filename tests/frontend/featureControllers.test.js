import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// The feature controllers main.js wires (inboxController.js pattern): each is a
// factory over injected dependencies that returns its data-action handlers.
// handleAction consults their merged map before its own switch, so an action
// must belong to exactly one owner.

const JS_DIR = new URL('../../public/js/', import.meta.url);
const CONTROLLERS = readdirSync(JS_DIR).filter(name => name.endsWith('Controller.js') && name !== 'inboxController.js');

// Every dependency is a harmless no-op; state is an empty object.
function fakeDeps() {
  const state = {};
  return new Proxy({}, {
    get(_target, key) {
      if (key === 'getState') return () => state;
      return () => undefined;
    },
    has: () => true,
  });
}

async function loadControllers() {
  const built = [];
  for (const name of CONTROLLERS) {
    const module = await import(new URL(name, JS_DIR));
    const factories = Object.entries(module).filter(([exported, value]) => /^create\w+Controller$/.test(exported) && typeof value === 'function');
    assert.equal(factories.length, 1, `${name} exports one controller factory`);
    built.push({ name, controller: factories[0][1](fakeDeps()) });
  }
  return built;
}

test('every feature controller builds from injected dependencies and exposes its data-actions', async () => {
  const built = await loadControllers();
  assert.ok(built.length >= 12, `found ${built.length} controllers`);
  for (const { name, controller } of built) {
    assert.equal(typeof controller.actions, 'object', `${name} exposes actions`);
    for (const [action, handler] of Object.entries(controller.actions)) {
      assert.equal(typeof handler, 'function', `${name}: ${action} is a handler`);
    }
  }
});

test('each data-action has exactly one owner: one controller, or main.js\'s own switch', async () => {
  const built = await loadControllers();
  const owners = new Map();
  for (const { name, controller } of built) {
    for (const action of Object.keys(controller.actions)) {
      assert.ok(!owners.has(action), `${action} is claimed by ${owners.get(action)} and ${name}`);
      owners.set(action, name);
    }
  }
  const main = readFileSync(new URL('main.js', JS_DIR), 'utf8');
  const switchCases = [...main.matchAll(/case '([\w-]+)':/g)].map(m => m[1]);
  const doubled = switchCases.filter(action => owners.has(action));
  assert.deepEqual(doubled, [], 'a controller-owned action is not also a main.js case');
});

test('every controller action is reachable from a rendered control, a confirm dialog or a palette command', async () => {
  const built = await loadControllers();
  // Render modules (and main.js's inline controls) name the actions they
  // render; confirm dialogs and the palette name the action they re-dispatch.
  const renderers = readdirSync(JS_DIR).filter(name => name.endsWith('.js') && !name.endsWith('Controller.js'))
    .map(name => readFileSync(new URL(name, JS_DIR), 'utf8')).join('\n');
  const controllers = CONTROLLERS.map(name => readFileSync(new URL(name, JS_DIR), 'utf8')).join('\n');
  for (const { name, controller } of built) {
    for (const action of Object.keys(controller.actions)) {
      const reachable = renderers.includes(`data-action="${action}"`)
        || renderers.includes(`'${action}'`) || renderers.includes(`"${action}"`)
        || controllers.includes(`action: '${action}'`);
      assert.ok(reachable, `${name}: nothing renders or dispatches ${action}`);
    }
  }
});
