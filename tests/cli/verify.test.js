import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import {
  AGENT_ENV_MARKERS, agentEnvironment, assertAttendedHuman, confirmDocumentVerification, verificationPhrase,
} from '../../cli/lib/verify.js';
import { detectAgent } from '../../server/instanceDiscovery.js';

const DOC = { id: '12345678-1234-4234-8234-123456789012', title: 'Reviewed' };

test('verification phrase is bound to the document id', () => {
  assert.equal(verificationPhrase(DOC.id), 'VERIFY 12345678');
});

test('verification refuses non-interactive streams and missing attribution', async () => {
  await assert.rejects(() => confirmDocumentVerification({
    document: DOC, actor: 'Maya', input: new PassThrough(), output: new PassThrough(),
  }), /attended interactive terminal/);

  const input = new PassThrough(); input.isTTY = true;
  const output = new PassThrough(); output.isTTY = true;
  await assert.rejects(() => confirmDocumentVerification({
    document: DOC, actor: '', input, output,
  }), /requires --as/);
});

test('verification requires the exact document-specific phrase', async () => {
  const input = new PassThrough(); input.isTTY = true;
  const output = new PassThrough(); output.isTTY = true;
  input.end('VERIFY 12345678\n');
  await confirmDocumentVerification({ document: DOC, actor: 'Maya', input, output });

  const wrong = new PassThrough(); wrong.isTTY = true;
  const output2 = new PassThrough(); output2.isTTY = true;
  wrong.end('verify\n');
  await assert.rejects(() => confirmDocumentVerification({
    document: DOC, actor: 'Maya', input: wrong, output: output2,
  }), /verification cancelled/);
});

// The attended-human guard (docs/superpowers/specs/2026-09-23-triage-tui-design.md):
// shared by `prax verify` and `prax triage`, run before any request.
const tty = () => { const s = new PassThrough(); s.isTTY = true; s.setRawMode = () => s; return s; };

test('the guard knows every agent environment detectAgent knows, and nothing else', () => {
  assert.equal(agentEnvironment({}), null);
  assert.equal(detectAgent({}), null);
  for (const { variable, agent } of AGENT_ENV_MARKERS) {
    const env = { [variable]: variable === 'PRAX_AGENT' ? 'gemini' : '1' };
    const found = agentEnvironment(env);
    assert.deepEqual(found.variables, [variable]);
    assert.equal(found.agent, agent ?? 'gemini');
    assert.equal(detectAgent(env), found.agent, `${variable}: guard and detectAgent agree`);
  }
  // Every variable detectAgent reads is in the guard's list, so a marker
  // added there fails this test until the guard learns it too.
  const read = [...detectAgent.toString().matchAll(/env\.([A-Z_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(read)].sort(), AGENT_ENV_MARKERS.map((m) => m.variable).sort());
});

test('an agent environment is refused even on a real terminal, naming the variables and no bypass', () => {
  assert.throws(
    () => assertAttendedHuman({ input: tty(), output: tty(), env: { CLAUDECODE: '1', PRAX_AGENT: 'claude' } }),
    (err) => {
      assert.equal(err.reason, 'agent-environment');
      assert.match(err.message, /verify is for a person, and this shell belongs to an agent CLI \(claude: PRAX_AGENT, CLAUDECODE set\)/);
      assert.match(err.message, /Library review queue/);
      assert.doesNotMatch(err.message, /unset|--i-am-human|override/);
      return true;
    },
  );
  // An empty marker counts as unset, as detectAgent reads it.
  assert.doesNotThrow(() => assertAttendedHuman({ input: tty(), output: tty(), env: { CLAUDECODE: '' } }));
});

test('without a terminal (or raw mode, when required) the guard refuses', () => {
  assert.throws(() => assertAttendedHuman({ input: new PassThrough(), output: tty(), env: {} }), /verify requires an attended interactive terminal/);
  assert.throws(() => assertAttendedHuman({ input: tty(), output: new PassThrough(), env: {} }), (err) => err.reason === 'not-a-terminal');
  const cooked = new PassThrough(); cooked.isTTY = true;
  assert.doesNotThrow(() => assertAttendedHuman({ input: cooked, output: tty(), env: {} }));
  assert.throws(() => assertAttendedHuman({ input: cooked, output: tty(), env: {}, raw: true, command: 'triage' }), /triage requires/);
});
