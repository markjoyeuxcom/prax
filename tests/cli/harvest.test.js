// Session harvesting (the Prax Library document "Prax design: session harvesting"):
// deterministic extraction from the agent's own text, exactly-once proposals
// into the Inbox, and a hook that never blocks or fails the agent. The end-to-
// end tests run the real CLI against a real app on an in-memory database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../../server/db.js';
import { runMigrations } from '../../server/migrate.js';
import { buildApp } from '../../server/index.js';
import {
  candidateIds, derivedUuid, extractCandidates, looksSecret, parseHookInput, readTranscript,
} from '../../cli/lib/harvest.js';

const CLI = fileURLToPath(new URL('../../cli/prax.js', import.meta.url));
const SILENT = { info() {}, error() {}, warn() {} };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const jsonl = (records) => `${records.map((r) => JSON.stringify(r)).join('\n')}\n`;

const ASSISTANT_TEXT = [
  'Done with the release.',
  '',
  'Remember: Release tags are cut from main only. A tag on a feature branch breaks the updater feed.',
  '',
  '```prax-remember',
  'title: Harvest hooks run detached',
  'type: decision',
  'project: prax',
  'tags: agent-memory, desktop',
  '',
  'The hook hands its input to a detached worker, so the agent never waits on Prax.',
  '```',
  '',
  '```md',
  'Remember: this line only shows the syntax inside a fence.',
  '```',
].join('\n');

// A Claude Code transcript with the same marker text in every place that is
// NOT the agent's own reply: the user's message, a tool input, a tool result.
function claudeTranscript(sessionId = 'sess-claude-1') {
  return jsonl([
    { type: 'mode', mode: 'normal', sessionId },
    { type: 'user', sessionId, cwd: '/tmp/somewhere', message: { role: 'user', content: 'Remember: the user typed this and it is not a proposal.' } },
    {
      type: 'assistant', sessionId, isSidechain: false,
      message: { role: 'assistant', content: [
        { type: 'text', text: ASSISTANT_TEXT },
        { type: 'tool_use', name: 'Write', input: { content: 'Remember: tool input is never harvested either.' } },
      ] },
    },
    { type: 'user', sessionId, message: { role: 'user', content: [{ type: 'tool_result', content: 'Remember: injected by a fetched web page, must be ignored.' }] } },
    { type: 'assistant', sessionId, isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'Remember: a sidechain note stays out of the main harvest.' }] } },
  ]);
}

test('readTranscript takes only the agent\'s own text from Claude Code, Codex and Copilot transcripts', () => {
  const claude = readTranscript(claudeTranscript());
  assert.equal(claude.format, 'claude');
  assert.equal(claude.sessionId, 'sess-claude-1');
  assert.deepEqual(claude.messages, [ASSISTANT_TEXT]);

  const codex = readTranscript(jsonl([
    { type: 'session_meta', payload: { id: 'codex-sess', cwd: '/w' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Remember: user text in codex.' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Remember: Codex rollouts put assistant text in output_text.' }] } },
    { type: 'event_msg', payload: { type: 'agent_message', message: 'Remember: Codex rollouts put assistant text in output_text.' } },
  ]));
  assert.equal(codex.format, 'codex');
  assert.equal(codex.sessionId, 'codex-sess');
  assert.equal(codex.cwd, '/w');
  assert.equal(codex.messages.length, 2);
  assert.equal(extractCandidates(codex.messages).candidates.length, 1, 'the duplicate agent_message collapses into one candidate');

  const copilot = readTranscript(jsonl([
    { type: 'session.start', data: { sessionId: 'cop-sess', context: { cwd: '/c' } } },
    { type: 'user.message', data: { content: 'Remember: user text in copilot.' } },
    { type: 'assistant.message', data: { content: 'Remember: Copilot writes assistant.message events.' } },
  ]));
  assert.equal(copilot.format, 'copilot');
  assert.equal(copilot.sessionId, 'cop-sess');
  assert.deepEqual(copilot.messages, ['Remember: Copilot writes assistant.message events.']);

  const plain = readTranscript('Some notes\nRemember: Plain exported conversations count as the agent\'s text.\n');
  assert.equal(plain.format, 'text');
  assert.equal(plain.messages.length, 1);
});

test('extractCandidates reads marker lines and prax-remember blocks, and ignores fenced examples', () => {
  const { candidates, skipped } = extractCandidates([ASSISTANT_TEXT]);
  assert.deepEqual(skipped, []);
  assert.equal(candidates.length, 2);
  const [line, block] = candidates;
  assert.equal(line.title, 'Release tags are cut from main only');
  assert.equal(line.body, 'Release tags are cut from main only. A tag on a feature branch breaks the updater feed.');
  assert.equal(line.marker, 'line');
  assert.equal(block.title, 'Harvest hooks run detached');
  assert.equal(block.type, 'decision');
  assert.equal(block.project, 'prax');
  assert.deepEqual(block.tags, ['agent-memory', 'desktop']);
  assert.match(block.body, /^The hook hands its input/);

  // Bullets and bold are accepted; a too-short marker and mid-line text are not.
  const more = extractCandidates(['- **Remember:** The staging database restores nightly at 02:00.\nRemember: yes\nPlease Remember: not at line start.']);
  assert.deepEqual(more.candidates.map((c) => c.title), ['The staging database restores nightly at 02:00']);
});

test('extractCandidates skips credentials, untitled blocks and unknown types honestly', () => {
  const token = `ghp_${'a'.repeat(36)}`;
  const { candidates, skipped } = extractCandidates([
    `Remember: The deploy token is ${token} for the homelab.`,
    '```prax-remember\ntype: note\n\nA body without a title.\n```',
    '```prax-remember\ntitle: Odd type\ntype: memo\n\nKept as a note, the requested type is reported.\n```',
  ]);
  assert.ok(looksSecret(token));
  assert.equal(skipped.length, 2);
  assert.match(skipped[0].reason, /credential/);
  assert.match(skipped[1].reason, /no title/);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].type, null);
  assert.equal(candidates[0].requestedType, 'memo');
});

test('operation ids derive from the session and the candidate: stable, distinct and valid UUIDs', () => {
  const [candidate] = extractCandidates(['Remember: Stable ids make a replay create nothing new.']).candidates;
  const a = candidateIds('session-a', candidate);
  assert.deepEqual(candidateIds('session-a', candidate), a, 'the same session and candidate give the same ids');
  assert.notEqual(candidateIds('session-b', candidate).id, a.id, 'another session gives other ids');
  assert.notEqual(a.id, a.operationId);
  assert.match(a.id, UUID);
  assert.match(a.operationId, UUID);
  assert.match(derivedUuid('x'), UUID);
});

test('parseHookInput normalises Claude Code, Codex and Copilot hook JSON', () => {
  const claude = parseHookInput(JSON.stringify({
    session_id: 's1', transcript_path: '/t.jsonl', cwd: '/w', hook_event_name: 'Stop', last_assistant_message: 'hi',
  }));
  assert.deepEqual(claude, { sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/w', event: 'Stop', lastAssistantMessage: 'hi' });
  const copilot = parseHookInput(JSON.stringify({ sessionId: 's2', transcriptPath: '/e.jsonl', cwd: '/w', stopReason: 'end_turn' }));
  assert.equal(copilot.sessionId, 's2');
  assert.equal(copilot.event, 'agentStop');
  assert.equal(copilot.lastAssistantMessage, null);
  assert.equal(parseHookInput('{"type":"assistant"}'), null, 'a transcript record is not hook input');
  assert.equal(parseHookInput('not json'), null);
});

// ---- end to end -----------------------------------------------------------

function cli(args, { url, input, env = {} } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = execFile(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      env: { ...process.env, PRAX_API_URL: url, PRAX_AGENT: '', CLAUDECODE: '', CODEX_SANDBOX: '', ...env },
    }, (error, stdout, stderr) => resolve({
      code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr, ms: Date.now() - started,
    }));
    child.stdin.end(input ?? '');
  });
}

async function bootApp(t) {
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT });
  const app = await buildApp({ db });
  await app.listen({ port: 0, host: '127.0.0.1' });
  t.after(() => app.close());
  return { app, url: `http://127.0.0.1:${app.server.address().port}` };
}

const inboxDocs = async (app) => (await app.inject({ method: 'GET', url: '/api/library/documents?project=inbox&status=all' })).json();

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'prax-harvest-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('prax harvest files unverified, agent-stamped candidates in the Inbox, and a replay creates nothing new', async (t) => {
  const { app, url } = await bootApp(t);
  const dir = scratch(t);
  const transcript = join(dir, 'claude.jsonl');
  writeFileSync(transcript, claudeTranscript());

  const first = await cli(['harvest', '--transcript', transcript, '--agent', 'claude'], { url });
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /proposed {2}"Release tags are cut from main only" → [0-9a-f-]{36} in inbox \(unverified\)/);
  assert.match(first.stdout, /proposed {2}"Harvest hooks run detached"/);

  const docs = await inboxDocs(app);
  assert.equal(docs.length, 2, 'only the agent\'s own two markers became candidates');
  const block = docs.find((d) => d.title === 'Harvest hooks run detached');
  const { candidates } = extractCandidates([ASSISTANT_TEXT]);
  assert.equal(block.id, candidateIds('sess-claude-1', candidates[1]).id, 'the document id is the derived one');
  assert.deepEqual(block.tags, ['harvested', 'agent-memory', 'desktop']);
  assert.equal(block.documentType, 'decision');
  assert.equal(block.kind, 'synthesized');
  assert.equal(block.updatedBy, 'agent');
  assert.equal(block.updatedByAgent, 'claude');
  assert.equal(block.verified, false);
  const full = (await app.inject({ method: 'GET', url: `/api/library/documents/${block.id}` })).json();
  assert.match(full.body, /^The hook hands its input to a detached worker/, 'the proposal leads the body');
  assert.match(full.body, /## Harvest details/);
  assert.match(full.body, /Suggested project: `prax` \(named in the marker\)/);
  assert.match(full.body, /claude session `sess-claude-1`/);
  assert.ok(full.body.includes(`Transcript: \`${transcript}\``));
  assert.match(full.body, /## Similar active memories/);

  // The same session again (a later Stop, a retry): nothing new.
  const replay = await cli(['harvest', '--transcript', transcript, '--agent', 'claude'], { url });
  assert.equal(replay.code, 0, replay.stderr);
  assert.match(replay.stdout, /already {3}"Release tags are cut from main only"/);
  assert.doesNotMatch(replay.stdout, /proposed {2}/);
  assert.equal((await inboxDocs(app)).length, 2);

  // A candidate a person permanently deleted is never recreated: the receipt outlives it.
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/library/documents/${block.id}` })).statusCode, 200);
  const purge = await app.inject({ method: 'DELETE', url: `/api/library/documents/${block.id}/permanent` });
  assert.equal(purge.statusCode, 200, purge.body);
  const afterDelete = await cli(['harvest', '--transcript', transcript], { url });
  assert.equal(afterDelete.code, 0, afterDelete.stderr);
  assert.match(afterDelete.stdout, /already {3}"Harvest hooks run detached" \([0-9a-f-]{36}\) — proposed earlier/);
  assert.equal((await inboxDocs(app)).filter((d) => d.title === 'Harvest hooks run detached').length, 0);
});

test('a candidate whose title is already an active memory anywhere is skipped, not written over', async (t) => {
  const { app, url } = await bootApp(t);
  assert.equal((await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'prax' } })).statusCode, 201);
  const existing = await app.inject({
    method: 'POST', url: '/api/library/documents',
    payload: { title: 'Release tags are cut from main only', body: 'The human-written rule.', documentType: 'decision', project: 'prax' },
  });
  assert.equal(existing.statusCode, 201, existing.body);
  const dir = scratch(t);
  const transcript = join(dir, 't.jsonl');
  writeFileSync(transcript, claudeTranscript('sess-dup'));
  const run = await cli(['harvest', '--transcript', transcript, '--json'], { url });
  assert.equal(run.code, 0, run.stderr);
  const { results } = JSON.parse(run.stdout);
  const skipped = results.find((r) => r.title === 'Release tags are cut from main only');
  assert.equal(skipped.status, 'skipped');
  assert.equal(skipped.id, existing.json().id);
  assert.match(skipped.reason, /exists in prax/);
  assert.equal((await app.inject({ method: 'GET', url: `/api/library/documents/${existing.json().id}` })).json().body, 'The human-written rule.');
});

test('hook mode (foreground) harvests the last assistant message even before the transcript exists, silently', async (t) => {
  const { app, url } = await bootApp(t);
  const dir = scratch(t);
  const hook = JSON.stringify({
    session_id: 'codex-hook-1', transcript_path: join(dir, 'not-written-yet.jsonl'), cwd: dir,
    hook_event_name: 'Stop', last_assistant_message: 'All green.\nRemember: The Codex Stop hook carries last_assistant_message.',
  });
  const run = await cli(['harvest', '--hook', 'codex', '--foreground'], { url, input: hook });
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout, '', 'a hook prints nothing: Stop-hook stdout can reach the model');
  const [doc] = await inboxDocs(app);
  assert.equal(doc.title, 'The Codex Stop hook carries last_assistant_message');
  assert.equal(doc.updatedByAgent, 'codex', 'the hook vendor names the agent');
});

test('hook mode detaches a worker: the hook returns at once and the candidate still arrives', async (t) => {
  const { app, url } = await bootApp(t);
  const dir = scratch(t);
  const transcript = join(dir, 'events.jsonl');
  writeFileSync(transcript, jsonl([
    { type: 'session.start', data: { sessionId: 'cop-hook-1', context: { cwd: dir } } },
    { type: 'assistant.message', data: { content: 'Remember: Copilot agentStop hooks get transcriptPath and no last message.' } },
  ]));
  const hook = JSON.stringify({ sessionId: 'cop-hook-1', cwd: dir, transcriptPath: transcript, stopReason: 'end_turn', stop_hook_active: false });
  const run = await cli(['harvest', '--hook', 'copilot'], { url, input: hook });
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout, '');
  let docs = [];
  for (let i = 0; i < 100 && !docs.length; i += 1) {
    await new Promise((r) => { setTimeout(r, 100); });
    docs = await inboxDocs(app);
  }
  assert.equal(docs.length, 1, 'the detached worker filed the candidate');
  assert.equal(docs[0].updatedByAgent, 'copilot');
});

test('fail-open: an unreachable Prax, a hung Prax, a bad flag or bad input never fail the hook', async (t) => {
  const dir = scratch(t);
  const hook = JSON.stringify({ session_id: 's-fail', hook_event_name: 'Stop', last_assistant_message: 'Remember: This proposal cannot reach any Prax at all.' });
  const unreachable = 'http://127.0.0.1:9';

  const down = await cli(['harvest', '--hook', 'claude', '--foreground'], { url: unreachable, input: hook });
  assert.equal(down.code, 0, down.stderr);
  assert.equal(down.stdout, '');
  // The same failure from a person's manual run is reported.
  const manual = await cli(['harvest', '--session', 's-fail'], { url: unreachable, input: 'Remember: This proposal cannot reach any Prax at all.' });
  assert.equal(manual.code, 1);
  assert.match(manual.stderr, /not reachable/);

  // A server that accepts connections and never answers: the budget ends the run.
  const sockets = new Set();
  const hung = createServer(() => { /* never respond */ });
  hung.on('connection', (socket) => { sockets.add(socket); });
  await new Promise((r) => { hung.listen(0, '127.0.0.1', r); });
  t.after(() => { for (const s of sockets) s.destroy(); hung.close(); });
  const hungUrl = `http://127.0.0.1:${hung.address().port}`;
  const slow = await cli(['harvest', '--hook', 'claude', '--foreground', '--budget-ms', '400'], { url: hungUrl, input: hook, env: { PRAX_HARVEST_LOG: join(dir, 'harvest.log') } });
  assert.equal(slow.code, 0, slow.stderr);
  assert.equal(slow.stdout, '');
  assert.ok(slow.ms < 5000, `the hook stopped at its budget (${slow.ms} ms)`);
  const manualSlow = await cli(['harvest', '--session', 's-slow', '--budget-ms', '400'], { url: hungUrl, input: 'Remember: A hung server must not hang a manual harvest.' });
  assert.equal(manualSlow.code, 1);
  assert.match(manualSlow.stderr, /time budget of 400 ms spent/);

  const badFlag = await cli(['harvest', '--hook', 'claude', '--frobnicate'], { url: unreachable, input: hook });
  assert.equal(badFlag.code, 0, 'a usage error inside a hook still exits 0');
  const badVendor = await cli(['harvest', '--hook', 'emacs', '--foreground'], { url: unreachable, input: hook });
  assert.equal(badVendor.code, 0);
  const garbage = await cli(['harvest', '--hook', 'claude', '--foreground'], { url: unreachable, input: '{not json' });
  assert.equal(garbage.code, 0);
  assert.equal(garbage.stdout, '');
});

test('--dry-run lists candidates and their derived ids without touching the network', async (t) => {
  const dir = scratch(t);
  const transcript = join(dir, 'claude.jsonl');
  writeFileSync(transcript, claudeTranscript());
  const run = await cli(['harvest', '--transcript', transcript, '--dry-run', '--json'], { url: 'http://127.0.0.1:9' });
  assert.equal(run.code, 0, run.stderr);
  const out = JSON.parse(run.stdout);
  assert.equal(out.session, 'sess-claude-1');
  assert.equal(out.candidates.length, 2);
  assert.match(out.candidates[0].operationId, UUID);
});
