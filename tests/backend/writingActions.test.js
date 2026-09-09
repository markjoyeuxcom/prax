import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';
import { isWritingAction, buildWritingMessages, stripCodeFence, WRITING_ACTIONS } from '../../server/writingActions.js';

// ---- pure ----

test('isWritingAction accepts the four actions, rejects others', () => {
  for (const a of ['draft', 'summarize', 'rewrite', 'checklist']) assert.ok(isWritingAction(a));
  for (const a of ['', 'delete', 'DRAFT', null, 42]) assert.ok(!isWritingAction(a));
});

test('buildWritingMessages: draft works from the title, others from the text', () => {
  const [dSys, dUser] = buildWritingMessages('draft', { title: 'Postgres Failover', documentType: 'runbook' });
  assert.match(dSys.content, /drafting a Markdown document/i);
  assert.match(dSys.content, /Output ONLY the Markdown body/);
  assert.match(dUser.content, /Title: "Postgres Failover" \(a runbook\)/);

  const [rSys, rUser] = buildWritingMessages('rewrite', { text: 'the db is slow' });
  assert.match(rSys.content, /PRESERVING its meaning/);
  assert.match(rSys.content, /do not invent/i);
  assert.match(rUser.content, /Rewrite this Markdown:[\s\S]*the db is slow/);

  const [cSys] = buildWritingMessages('checklist', { text: 'stop writes then promote' });
  assert.match(cSys.content, /- \[ \]/);
  assert.match(cSys.content, /do not invent steps/i);

  const [sSys] = buildWritingMessages('summarize', { text: 'long doc' });
  assert.match(sSys.content, /TL;DR/);
  assert.match(sSys.content, /ONLY information present/);
});

test('buildWritingMessages throws on an unknown action', () => {
  assert.throws(() => buildWritingMessages('nope', {}), /unknown writing action/);
});

test('stripCodeFence removes a single wrapping fence, leaves inner fences alone', () => {
  assert.equal(stripCodeFence('```markdown\n# Hi\n\n```bash\nls\n```\n```'), '# Hi\n\n```bash\nls\n```');
  assert.equal(stripCodeFence('  plain text  '), 'plain text');
  assert.equal(stripCodeFence('```\njust fenced\n```'), 'just fenced');
  assert.equal(stripCodeFence('```md\n# Hi\n```'), '# Hi');
});

test('stripCodeFence preserves a language-tagged block (may be the real output)', () => {
  // A single ```bash/```sql/… block could legitimately be the whole answer, so
  // it must survive intact rather than losing its fence.
  assert.equal(stripCodeFence('```bash\nls -la\n```'), '```bash\nls -la\n```');
  assert.equal(stripCodeFence('```sql\nSELECT 1;\n```'), '```sql\nSELECT 1;\n```');
});

test('WRITING_ACTIONS metadata: draft needs a title, the rest need text', () => {
  assert.equal(WRITING_ACTIONS.draft.input, 'title');
  assert.equal(WRITING_ACTIONS.rewrite.input, 'text');
  assert.equal(WRITING_ACTIONS.summarize.input, 'text');
  assert.equal(WRITING_ACTIONS.checklist.input, 'text');
});

// ---- route ----

function makeApp({ chat } = {}) {
  return buildApp({
    skipDb: true, chat,
    libraryRepository: { listDocuments: async () => [] },
    projectsRepository: { resolveProject: async () => null },
    appSettingsRepository: { async getSetting(_k, fb) { return fb; }, async putSetting() {} },
    documentLinksRepository: { listStaleDocuments: async () => [], listOutboundLinksForDocuments: async () => new Map() },
  });
}
const scripted = { model: 's', backend: 's', async complete() { return { text: '```markdown\n# Drafted\n\n- [ ] step\n```', model: 's' }; }, async isAvailable() { return true; } };
const post = (app, payload) => app.inject({ method: 'POST', url: '/api/library/writing-action', payload });

test('POST writing-action returns cleaned text (outer fence stripped)', async () => {
  const app = await makeApp({ chat: scripted });
  const b = (await post(app, { action: 'draft', title: 'X' })).json();
  assert.equal(b.degraded, false);
  assert.equal(b.text, '# Drafted\n\n- [ ] step'); // fence stripped
  assert.equal(b.model, 's');
  await app.close();
});

test('POST writing-action degrades (200) when no chat model', async () => {
  const app = await makeApp({ chat: null });
  const b = (await post(app, { action: 'rewrite', text: 'x' })).json();
  assert.equal(b.degraded, true);
  assert.equal(b.reason, 'no-chat-model');
  assert.equal(b.text, null);
  await app.close();
});

test('POST writing-action degrades when the model returns nothing usable', async () => {
  const app = await makeApp({ chat: { model: 's', backend: 's', async complete() { return { text: '   ', model: 's' }; }, async isAvailable() { return true; } } });
  const b = (await post(app, { action: 'summarize', text: 'x' })).json();
  assert.equal(b.degraded, true);
  assert.equal(b.reason, 'generation-failed');
  await app.close();
});

test('POST writing-action validates action + required input', async () => {
  const app = await makeApp({ chat: scripted });
  assert.equal((await post(app, { action: 'nope', text: 'x' })).statusCode, 400);
  assert.equal((await post(app, { action: 'draft' })).statusCode, 400);       // no title
  assert.equal((await post(app, { action: 'rewrite', text: '  ' })).statusCode, 400); // blank text
  await app.close();
});
