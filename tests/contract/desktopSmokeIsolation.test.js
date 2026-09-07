import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The packaged-runtime smoke (scripts/verify-desktop-runtime.mjs) launches the
// built app with `--desktop-smoke <dir>`, an isolated app-data directory. The
// single-instance plugin keys its socket on the app identifier alone, so a
// smoke launch that registered it on a machine where an installed Prax is
// running (the self-hosted macOS runner is such a machine) would surface that
// app's window and exit without starting its own sidecar. The smoke launch
// therefore skips the plugin; a normal launch keeps it, since two processes
// over the same database is exactly what it prevents.

const rust = readFileSync(new URL('../../src-tauri/src/lib.rs', import.meta.url), 'utf8');

test('a normal launch registers the single-instance plugin and a smoke launch does not', () => {
  assert.match(rust, /let smoke_data_dir = smoke_data_dir_from_args\(std::env::args\(\)\)/, 'the smoke directory is parsed before the builder exists');
  assert.match(
    rust,
    /let builder = if smoke_data_dir\.is_none\(\) \{\n\s*builder\.plugin\(tauri_plugin_single_instance::init\(/,
    'the single-instance plugin is registered only when no isolated smoke directory was given',
  );
  assert.equal((rust.match(/tauri_plugin_single_instance::init\(/g) || []).length, 1, 'the plugin is registered in exactly one place');
  const smoke = readFileSync(new URL('../../scripts/verify-desktop-runtime.mjs', import.meta.url), 'utf8');
  assert.match(smoke, /\['--desktop-smoke', dataDir\]/, 'the smoke passes its isolated directory as the launch argument');
});
