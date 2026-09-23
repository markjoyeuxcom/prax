// The single-file skill bundles are agent-facing; `prax triage` and the
// verification guard are for people and must never ship inside them
// (docs/superpowers/specs/2026-09-23-triage-tui-design.md). Checked two ways:
// what esbuild would bundle from every skill entry today, and what the
// committed bundles actually contain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EXCLUDED_MODULES = ['cli/lib/triage.js', 'cli/lib/verify.js'];
// Identifiers only those modules define.
const EXCLUDED_MARKERS = ['runTriageSession', 'createTriageClient', 'assertAttendedHuman', 'AGENT_ENV_MARKERS', 'prax-triage'];

const skillEntries = () => readdirSync(join(ROOT, 'skills/src'))
  .filter((name) => name.endsWith('.mjs'))
  .map((name) => `skills/src/${name}`);

const committedBundles = () => readdirSync(join(ROOT, 'skills'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(ROOT, 'skills', entry.name, 'scripts')))
  .flatMap((entry) => readdirSync(join(ROOT, 'skills', entry.name, 'scripts'))
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => `skills/${entry.name}/scripts/${name}`));

test('no skill entry bundles the triage or verification modules', async () => {
  const entries = skillEntries();
  assert.ok(entries.length >= 2, 'the skill entries were found');
  for (const entry of entries) {
    const result = await build({
      entryPoints: [join(ROOT, entry)],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      write: false,
      metafile: true,
      logLevel: 'silent',
      absWorkingDir: ROOT,
    });
    const inputs = Object.keys(result.metafile.inputs);
    assert.ok(inputs.some((path) => path.startsWith('cli/lib/')), `${entry} bundles cli/lib (sanity)`);
    for (const excluded of EXCLUDED_MODULES) {
      assert.ok(!inputs.includes(excluded), `${entry} must not bundle ${excluded}`);
    }
  }
});

test('the committed skill bundles contain no triage or verification code', () => {
  const bundles = committedBundles();
  assert.ok(bundles.length >= 2, 'the committed bundles were found');
  for (const bundle of bundles) {
    const code = readFileSync(join(ROOT, bundle), 'utf8');
    for (const marker of EXCLUDED_MARKERS) {
      assert.ok(!code.includes(marker), `${bundle} contains ${marker}`);
    }
  }
});
