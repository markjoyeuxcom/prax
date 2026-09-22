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
