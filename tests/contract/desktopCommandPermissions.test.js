import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const COMMAND = 'save_library_export';
const PERMISSION = `allow-${COMMAND.replaceAll('_', '-')}`;
const RESTART_COMMAND = 'restart_prax';
const RESTART_PERMISSION = `allow-${RESTART_COMMAND.replaceAll('_', '-')}`;
const CAPTURE_COMMAND = 'hide_capture_window';
const CAPTURE_PERMISSION = `allow-${CAPTURE_COMMAND.replaceAll('_', '-')}`;

test('the localhost desktop webview has an explicit grant for every exported Library save command', () => {
  const rust = readFileSync(new URL('../../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  const build = readFileSync(new URL('../../src-tauri/build.rs', import.meta.url), 'utf8');
  const capability = JSON.parse(readFileSync(
    new URL('../../src-tauri/capabilities/remote.json', import.meta.url),
    'utf8',
  ));
  const localCapability = JSON.parse(readFileSync(
    new URL('../../src-tauri/capabilities/default.json', import.meta.url),
    'utf8',
  ));

  const captureCapability = JSON.parse(readFileSync(
    new URL('../../src-tauri/capabilities/capture.json', import.meta.url),
    'utf8',
  ));

  assert.match(rust, new RegExp(`#\\[tauri::command\\][\\s\\S]*?async fn ${COMMAND}\\b`));
  assert.doesNotMatch(rust, /blocking_save_file/);
  assert.match(rust, /dialog\.save_file\(move \|selected\|/);
  assert.match(rust, /spawn_blocking\(move \|\| receiver\.recv\(\)\)/);
  // The IPC surface is pinned command-by-command: growing it must update this
  // list consciously. (Pin updated for the system-wide capture bar's
  // hide_capture_window — its ONLY IPC.)
  assert.match(build, new RegExp(
    `AppManifest::new\\(\\)\\.commands\\(&\\[\\s*"${COMMAND}",\\s*"${RESTART_COMMAND}",\\s*"${CAPTURE_COMMAND}",\\s*\\]\\)`,
  ));
  assert.ok(capability.remote.urls.includes('http://127.0.0.1:*'));
  assert.ok(capability.permissions.includes(PERMISSION));
  assert.deepEqual(
    capability.permissions.filter(permission => !permission.startsWith('core:')),
    [PERMISSION],
  );
  assert.ok(localCapability.permissions.includes(RESTART_PERMISSION));
  assert.ok(!capability.permissions.includes(RESTART_PERMISSION));

  // The capture bar window gets exactly one permission (hide itself) and the
  // main-window capabilities never gain it.
  assert.deepEqual(captureCapability.windows, ['capture']);
  assert.ok(captureCapability.remote.urls.includes('http://127.0.0.1:*'));
  assert.deepEqual(captureCapability.permissions, [CAPTURE_PERMISSION]);
  assert.ok(!capability.permissions.includes(CAPTURE_PERMISSION));
  assert.ok(!localCapability.permissions.includes(CAPTURE_PERMISSION));
});

test('desktop sidecar owns its ephemeral bind and supports bounded graceful recovery', () => {
  const rust = readFileSync(new URL('../../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../../server/index.js', import.meta.url), 'utf8');
  const splash = readFileSync(new URL('../../src-tauri/splash/index.html', import.meta.url), 'utf8');
  const tauriConfig = JSON.parse(readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));

  assert.match(rust, /envs\.insert\("PORT"\.into\(\), "0"\.into\(\)\)/);
  assert.doesNotMatch(rust, /TcpListener|fn free_port/);
  assert.match(rust, /navigation_allowed\(url, sidecar_port\)/);
  assert.match(rust, /child\.write\(b"shutdown\\n"\)/);
  assert.match(rust, /wait_for_termination\(SHUTDOWN_TIMEOUT\)/);
  assert.match(rust, /server-exit code=\{code\} signal=\{signal\}/);
  assert.match(rust, /AfterShutdown::Restart => app\.restart\(\)/);
  assert.match(server, /PRAX_DESKTOP_CONTROL === 'stdio'/);
  assert.match(server, /announceDesktopReady\(process\.stdout, address\)/);
  assert.match(tauriConfig.app.security.csp, /script-src 'self'/);
  assert.doesNotMatch(tauriConfig.app.security.csp, /script-src[^;]*'unsafe-inline'/);
  assert.match(splash, /id="detail" role="status" aria-live="polite"/);
  assert.match(splash, /id="restart"[^>]*>Restart Prax</);
});
