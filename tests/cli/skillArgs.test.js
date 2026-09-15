import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecallArgs, parseRememberArgs, UsageError } from '../../cli/lib/skillArgs.js';

test('recall: positional words join into the query and options parse', () => {
  const a = parseRecallArgs(['how', 'do', 'we', 'restore', '--project', 'memory', '--limit', '3']);
  assert.deepEqual(a, { query: 'how do we restore', project: 'memory', limit: 3, recent: false, agent: undefined });
});

test('recall: --recent takes an optional count and needs no query', () => {
  assert.equal(parseRecallArgs(['--recent']).recent, true);
  assert.equal(parseRecallArgs(['--recent']).limit, 5);
  assert.equal(parseRecallArgs(['--recent', '7']).limit, 7);
  assert.equal(parseRecallArgs(['--recent', '--project', 'memory']).project, 'memory');
});

test('recall: an unknown option is an error, not silently ignored', () => {
  assert.throws(() => parseRecallArgs(['q', '--nope']), (err) => err instanceof UsageError && /Unknown option "--nope"/.test(err.message));
});

test('recall: a query or --recent is required; --limit must be a positive integer', () => {
  assert.throws(() => parseRecallArgs([]), /query/);
  assert.throws(() => parseRecallArgs(['q', '--limit', 'x']), /--limit/);
  assert.throws(() => parseRecallArgs(['q', '--limit']), /--limit needs a value/);
});

test('remember: title, body and every option parse, including --ref, --cite and --agent', () => {
  const a = parseRememberArgs(['T', 'B', '--tags', 'a, b,,c', '--type', 'decision', '--project', 'homelab', '--ref', 'https://x/pr/1', '--cite', 'server/config.js:12-36', '--agent', 'Codex']);
  assert.deepEqual(a, { title: 'T', body: 'B', tags: ['a', 'b', 'c'], type: 'decision', project: 'homelab', projectExplicit: true, id: undefined, ref: 'https://x/pr/1', cite: 'server/config.js:12-36', agent: 'codex' });
});

test('remember: --project marks the project as chosen; its absence leaves it defaulted', () => {
  assert.equal(parseRememberArgs(['T', 'B']).projectExplicit, false);
  assert.equal(parseRememberArgs(['T', 'B', '--project', 'memory']).projectExplicit, true, 'saying "memory" out loud is a choice, not a default');
});

test('remember: --id takes a document uuid, normalised to lowercase, and rejects anything else', () => {
  const id = '1A9C8523-0D5F-4425-847D-B32EED8CE708';
  assert.equal(parseRememberArgs(['T', 'B', '--id', id]).id, id.toLowerCase());
  assert.throws(() => parseRememberArgs(['T', 'B', '--id', 'not-a-uuid']), /--id must be a document uuid/);
  assert.throws(() => parseRememberArgs(['T', 'B', '--id']), /--id needs a value/);
});

test('remember: --cite is optional and absent by default', () => {
  assert.equal(parseRememberArgs(['T', 'B']).cite, undefined);
});

test('remember: defaults keep the stored type (undefined) and the memory project', () => {
  const a = parseRememberArgs(['T', 'B']);
  assert.equal(a.type, undefined);
  assert.equal(a.project, 'memory');
  assert.deepEqual(a.tags, []);
});

test('remember: --ref must be an http(s) URL and unknown options are rejected', () => {
  assert.throws(() => parseRememberArgs(['T', 'B', '--ref', 'notaurl']), /--ref must be an http/);
  assert.throws(() => parseRememberArgs(['T', 'B', '--reff', 'https://x']), /Unknown option "--reff"/);
});

test('remember: an invalid --type lists the vocabulary; a bad --agent id is rejected', () => {
  assert.throws(() => parseRememberArgs(['T', 'B', '--type', 'wiki']), /Unknown --type "wiki"\. Types: runbook, note/);
  assert.throws(() => parseRememberArgs(['T', 'B', '--agent', 'not valid!']), /--agent/);
});

test('remember: title and body are required and a third positional is an error', () => {
  assert.throws(() => parseRememberArgs(['T']), /title and a body/);
  assert.throws(() => parseRememberArgs(['T', 'B', 'stray']), /Unexpected argument "stray"/);
});
