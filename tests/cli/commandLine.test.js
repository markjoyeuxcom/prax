// The prax CLI's declared flag grammar, end to end (QINV-01): nothing the
// caller typed is silently discarded. Refusals run against an address nothing
// listens on, so each must happen before the first request; the parsing that
// succeeds is observed through a throwaway in-process server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { parseArgs, checkCommandArgs, positiveIntFlag, CliUsageError } from '../../cli/lib/cliArgs.js';

const CLI = fileURLToPath(new URL('../../cli/prax.js', import.meta.url));
const UNREACHABLE = 'http://127.0.0.1:9';

function run(args, env = {}) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PRAX_API_URL: UNREACHABLE, PRAX_PROJECT: 'demo', ...env },
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

function refused(args, pattern) {
  const { code, stderr } = run(args);
  assert.notEqual(code, 0, args.join(' '));
  assert.match(stderr, pattern, args.join(' '));
  assert.doesNotMatch(stderr, /not reachable/, `${args.join(' ')} reached the network`);
  return stderr;
}

test('an unknown or mistyped flag is refused with a suggestion and the usage line', () => {
  const stderr = refused(
    ['remember', 'Typo flags', '--project', 'demo', '--body', 'hello', '--tpye', 'decision'],
    /Unknown flag --tpye \(did you mean --type\?\)/,
  );
  assert.match(stderr, /Usage: prax remember/);
  refused(['remember', 'T', '--body', 'B', '--cites', 'cli/prax.js:1'], /Unknown flag --cites \(did you mean --cite\?\)/);
  refused(['search', 'x', '--frobnicate'], /Unknown flag --frobnicate/);
});

test('a flag that belongs to another command is refused, not ignored', () => {
  refused(['remember', 'T', '--body', 'B', '--all'], /remember does not take --all/);
  refused(['task', 'list', '--body', 'x'], /task list does not take --body/);
  refused(['get', 'x', '--limit', '3'], /get does not take --limit/);
});

test('surplus words are refused: an unquoted remember title keeps no silent first word', () => {
  refused(['remember', 'Postgres', 'restore', 'runbook', '--body', 'x'],
    /remember: unexpected arguments "restore" "runbook" — quote a value that contains spaces/);
  refused(['get', 'a', 'b'], /get: unexpected argument "b"/);
  refused(['task', 'list', 'extra'], /task list: unexpected argument "extra"/);
  refused(['task', 'update', '2234a575-027e-4218-892a-b74d2b5c7f8c', 'oops', '--title', 'x'], /task update: unexpected argument "oops"/);
});

test('--tags is accepted as the skill spelling of --tag, and both at once are refused', () => {
  // Accepted: the run gets as far as the (unreachable) server.
  const { stderr } = run(['remember', 'T', '--body', 'B', '--tags', 'a,b']);
  assert.match(stderr, /not reachable/);
  refused(['remember', 'T', '--body', 'B', '--tags', 'a', '--tag', 'b'], /--tags and --tag are the same flag; give it once/);
});

test('--limit and --recent counts must be positive integers', () => {
  for (const bad of ['0', '-1', '2.5', 'ten']) {
    refused(['recall', 'postgres', `--limit=${bad}`], /--limit must be a positive integer/);
  }
  refused(['context', 'x', '--limit', '0'], /--limit must be a positive integer/);
  refused(['recall', '--recent', '0'], /--recent must be a positive integer/);
  refused(['recall', '--recent', '3', '--limit', '4'], /give the count once/);
});

test('recall --recent with a query is refused rather than ignoring the query', () => {
  refused(['recall', '--recent', 'postgres'], /--recent lists the newest documents and takes no query/);
});

test('an invalid --agent is refused instead of silently writing anonymously', () => {
  refused(['remember', 'T', '--body', 'B', '--agent', 'Not An Id'], /--agent must be a short id/);
});

test('a boolean flag given a value, and a value flag given none, are refused', () => {
  refused(['search', 'x', '--json=yes'], /--json takes no value/);
  refused(['task', 'list', '--status'], /--status needs a value/);
  refused(['supersede', 'a', '--with'], /--with needs a value/);
});

// A throwaway server that records what the CLI asked for.
async function withServer(handler, fn) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(new URL(req.url, 'http://x'));
    const body = handler(req);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(url, seen);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function runAsync(args, url) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], {
      encoding: 'utf8', env: { ...process.env, PRAX_API_URL: url, PRAX_PROJECT: 'demo' },
    }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
  });
}

test('a boolean flag never swallows the next word: search --json postgres backup searches both', async () => {
  await withServer(() => ({ items: [], page: null, index: null, degraded: false, reason: null }), async (url, seen) => {
    const { code, stdout } = await runAsync(['search', '--json', 'postgres', 'backup'], url);
    assert.equal(code, 0);
    assert.equal(JSON.parse(stdout).schemaVersion, 1);
    const search = seen.find((u) => u.pathname.endsWith('/semantic-search'));
    assert.equal(search.searchParams.get('q'), 'postgres backup');
  });
});

test('--include-harvested reaches the server on recall, search and context; without it nothing is sent', async () => {
  const body = {
    items: [], page: null, index: null, degraded: false, reason: null, hiddenHarvested: 2,
  };
  await withServer(() => body, async (url, seen) => {
    const plain = await runAsync(['search', 'tunnel'], url);
    assert.equal(plain.code, 0);
    assert.match(plain.stdout, /Note: 2 unreviewed harvested candidates hidden until a person triages them; --include-harvested to show\./);
    assert.equal(seen.find((u) => u.pathname.endsWith('/semantic-search')).searchParams.get('includeHarvested'), null);

    seen.length = 0;
    assert.equal((await runAsync(['search', 'tunnel', '--include-harvested'], url)).code, 0);
    assert.equal(seen.find((u) => u.pathname.endsWith('/semantic-search')).searchParams.get('includeHarvested'), 'true');

    seen.length = 0;
    const recall = await runAsync(['recall', 'tunnel', '--include-harvested'], url);
    assert.equal(recall.code, 0, recall.stderr);
    assert.equal(seen.find((u) => u.pathname.endsWith('/semantic-search')).searchParams.get('includeHarvested'), 'true');

    seen.length = 0;
    await runAsync(['context', 'tunnel', '--include-harvested'], url);
    assert.equal(seen.find((u) => u.pathname.endsWith('/context-pack')).searchParams.get('includeHarvested'), 'true');
  });
  refused(['recall', 'x', '--include-harvested=yes'], /--include-harvested takes no value/);
  refused(['remember', 'T', '--body', 'B', '--include-harvested'], /remember does not take --include-harvested/);
});

test('task list shows open tasks by default; --all and --status include completed ones', async () => {
  const tasks = [
    { id: 'a', title: 'Open one', status: 'planned', priority: 'medium' },
    { id: 'b', title: 'Done one', status: 'completed', priority: 'medium' },
  ];
  await withServer(() => tasks, async (url) => {
    const open = await runAsync(['task', 'list', '--json'], url);
    assert.deepEqual(JSON.parse(open.stdout).map((t) => t.id), ['a']);
    const all = await runAsync(['task', 'list', '--all', '--json'], url);
    assert.deepEqual(JSON.parse(all.stdout).map((t) => t.id), ['a', 'b']);
  });
});

// People only (docs/design/triage-tui.md): verify
// and triage refuse in an agent CLI's shell, with --agent, and without a
// terminal, before any request. spawnSync gives the child no TTY.
const NO_AGENT = {
  PRAX_AGENT: '', CLAUDECODE: '', CODEX_THREAD_ID: '', CODEX_SESSION_ID: '', COPILOT_CLI: '',
  COPILOT_AGENT_SESSION_ID: '', ANTIGRAVITY_AGENT: '', ANTIGRAVITY_CONVERSATION_ID: '',
};
const DOC_ID = '12345678-1234-4234-8234-123456789012';

test('verify and triage refuse an agent environment or --agent before any request', () => {
  for (const [args, env] of [
    [['verify', DOC_ID, '--as', 'Mark'], { ...NO_AGENT, CLAUDECODE: '1' }],
    [['verify', DOC_ID, '--as', 'Mark'], { ...NO_AGENT, CODEX_THREAD_ID: 't-1' }],
    [['verify', DOC_ID, '--as', 'Mark', '--agent', 'codex'], NO_AGENT],
    [['triage', '--as', 'Mark'], { ...NO_AGENT, PRAX_AGENT: 'antigravity' }],
    [['triage'], { ...NO_AGENT, COPILOT_CLI: '1' }],
  ]) {
    const { code, stderr } = run(args, env);
    assert.notEqual(code, 0, args.join(' '));
    assert.match(stderr, /is for a person, and this shell belongs to an agent CLI/, args.join(' '));
    assert.doesNotMatch(stderr, /not reachable/, `${args.join(' ')} reached the network`);
  }
});

test('verify and triage refuse without a terminal, and triage refuses --json and stray words', () => {
  refusedWith(['verify', DOC_ID, '--as', 'Mark'], NO_AGENT, /verify requires an attended interactive terminal/);
  refusedWith(['triage'], NO_AGENT, /triage requires an attended interactive terminal/);
  refusedWith(['triage', '--json'], NO_AGENT, /triage is interactive and does not support --json/);
  refusedWith(['triage', 'extra'], NO_AGENT, /triage: unexpected argument "extra"/);
  refusedWith(['triage', '--all'], NO_AGENT, /triage does not take --all/);
});

function refusedWith(args, env, pattern) {
  const { code, stderr } = run(args, env);
  assert.notEqual(code, 0, args.join(' '));
  assert.match(stderr, pattern, args.join(' '));
  assert.doesNotMatch(stderr, /not reachable/, `${args.join(' ')} reached the network`);
}

test('parseArgs: a strict spec refuses unknown flags; the optional flag takes only a matching value', () => {
  const spec = { boolean: ['json'], optional: { recent: (v) => /^\d+$/.test(v) }, known: ['limit'] };
  assert.throws(() => parseArgs(['--nope'], spec), CliUsageError);
  assert.deepEqual(parseArgs(['--recent', '5', 'q'], spec), { positionals: ['q'], flags: { recent: '5' } });
  assert.deepEqual(parseArgs(['--recent', 'q'], spec), { positionals: ['q'], flags: { recent: true } });
  assert.deepEqual(parseArgs(['--json', 'q', '--', '--limit'], spec), { positionals: ['q', '--limit'], flags: { json: true } });
  assert.throws(() => parseArgs(['--limit'], spec), /--limit needs a value/);
});

test('checkCommandArgs and positiveIntFlag', () => {
  assert.throws(() => checkCommandArgs('get', { flags: { x: '1' }, positionals: [] }, { allowed: [] }), /get does not take --x/);
  assert.throws(() => checkCommandArgs('get', { flags: {}, positionals: ['a', 'b'] }, { allowed: [], max: 1 }), /unexpected argument "b"/);
  assert.equal(positiveIntFlag({ limit: '7' }, 'limit'), 7);
  assert.equal(positiveIntFlag({}, 'limit'), undefined);
  assert.throws(() => positiveIntFlag({ limit: '0' }, 'limit'), /positive integer/);
});

test('budget, delta and brief flags are declared and their misuse is refused before any request', () => {
  refused(['recall', 'postgres', '--budget', '0'], /--budget must be a positive integer/);
  refused(['recall', '--recent', '--budget', '100'], /--budget does not apply to --recent/);
  refused(['recall', '--since-last-session', 'postgres'], /takes no query/);
  refused(['recall', '--since-last-session', '--since', '2026-09-20'], /give one of --since <iso> or --since-last-session/);
  refused(['recall', '--since', 'last week'], /--since must be an ISO-8601 date/);
  refused(['recall', '--since-last-session', '--recent'], /different lists/);
  refused(['recall', '--since-last-session=yes'], /since-last-session/);
  refused(['context', '--budget', 'lots'], /--budget must be a positive integer/);
  refused(['search', 'x', '--budget', '10'], /search does not take --budget/);
  refused(['brief', 'not-a-uuid'], /brief requires a task uuid/);
  refused(['brief', '11111111-1111-4111-8111-111111111111', '--limit', '3'], /brief does not take --limit/);
});

test('--since-last-session needs an agent id and says how to give one', () => {
  const noAgent = {
    PRAX_AGENT: '', CLAUDECODE: '', CODEX_THREAD_ID: '', CODEX_SESSION_ID: '', COPILOT_CLI: '',
    COPILOT_AGENT_SESSION_ID: '', ANTIGRAVITY_AGENT: '', ANTIGRAVITY_CONVERSATION_ID: '',
  };
  const { code, stderr } = run(['recall', '--since-last-session'], noAgent);
  assert.notEqual(code, 0);
  assert.match(stderr, /--since-last-session needs an agent id: pass --agent <id> or set PRAX_AGENT/);
  assert.doesNotMatch(stderr, /not reachable/);
});
