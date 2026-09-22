import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, repeatedValues } from '../../cli/lib/cliArgs.js';

test('parseArgs: spaced and = forms are equivalent; repeatable flags accumulate', () => {
  const { positionals, flags } = parseArgs(
    ['task', 'add', 'T', '--priority', 'high', '--label=a,b', '--check', 'one', '--check=two', '--json'],
    { repeatable: ['check'] },
  );
  assert.deepEqual(positionals, ['task', 'add', 'T']);
  assert.equal(flags.priority, 'high');
  assert.equal(flags.label, 'a,b');
  assert.deepEqual(flags.check, ['one', 'two']);
  assert.equal(flags.json, true);
});

test('parseArgs: a value that starts with -- must use the = form', () => {
  // Spaced: the value is read as the next flag (documented limitation).
  const spaced = parseArgs(['--check', '--json output'], { repeatable: ['check'] });
  assert.deepEqual(spaced.flags.check, [true]);
  assert.throws(() => repeatedValues(spaced.flags, 'check'), /--check needs a value; for text that starts with "--" write --check="<text>"/);
  // = form carries it intact, including further = signs.
  const eq = parseArgs(['--check=--json output', '--tag=a=b'], { repeatable: ['check'] });
  assert.deepEqual(eq.flags.check, ['--json output']);
  assert.equal(eq.flags.tag, 'a=b');
});

test('parseArgs: last-wins for ordinary flags and a bare flag is true', () => {
  const { flags } = parseArgs(['--tag', 'a', '--tag', 'b', '--recent']);
  assert.equal(flags.tag, 'b');
  assert.equal(flags.recent, true);
  assert.deepEqual(repeatedValues(flags, 'check'), []);
});
